/**
 * Few notes on how the recipe pipeline is structured and supposed to work
 * 1. Each recipe originates from a recipe_source
 * 2. The database does not allow duplicate entry for recipe_source (type, external_id)
 * 3. During the processing of a recipe source, multiple artifacts can be created.
 * 4. The final artifacts which are concerned with application behaviour are
 *   a. recipes - llm parsed objects used to model a recipe in the system
 *   b. embeddings - embeddings used to provide semantic search to users and additional
 *   context to Llms integration for searching and experimenting with recipes
 * 5. Besides final artifacts, system can also create artifacts which may or may not be
 * exposed to the user but are produced during a recipe pipeline. Such artifacts are
 * stored in content_items. For now only the video transcript is stored in it. However
 * the goal here is, in future for videos which don't provide transcript or in general
 * to add more context for LLM we could start extracting out images from shorts and
 * create embeddings for them. The links to these images would be stored in content_items
 */

import type { Database } from "../db";
import {
  content_item_schema,
  embedding_schema,
  recipe_schema,
} from "../db/schema";
import type { AppLogger } from "../logger";
import * as LlmService from "../llm/service";
import {
  RecipeGenerated,
  RecipeGenerationFailed,
  RecipePipelineErrors,
  RecipeSaved,
  RecipeSavingFailed,
} from "./type";
import {
  TranscriptGenerated,
  TranscriptGenerationFailed,
  type RecipePipelineEventType,
  type RecipeSource,
  type PipelineContext,
  type PipelineStep,
} from "./type";
import * as YoutubeService from "../youtube/service";
import type { InnertubeVideoInfo } from "../youtube/service";
import { ensureDefined } from "../utils";

/**
 * Pipeline contract: executes steps in order with a shared context.
 * Each step returns a success or error event; on first error the pipeline stops.
 */
const RecipePipeline: PipelineStep[] = [transcriptStep, recipeStep, saveStep];

/** Extracts transcript from YouTube and persists it as a content_item. */
async function transcriptStep(
  ctx: PipelineContext,
): Promise<TranscriptGenerated | TranscriptGenerationFailed> {
  const { recipeSource, db, logger, videoInfo } = ctx;

  const event = await YoutubeService.getTranscript(videoInfo)
    .then((transcript) => {
      ctx.transcript = transcript;
      return new TranscriptGenerated(transcript);
    })
    .catch(
      (error) =>
        new TranscriptGenerationFailed({
          options: { cause: Error.isError(error) ? error : `${error}` },
        }),
    );

  if (event.type === RecipePipelineErrors.transcriptGenerationFailed)
    return event;

  await db
    .insert(content_item_schema)
    .values({
      recipe_source_id: recipeSource.id,
      pipeline_step: event.type,
      data: { type: "string", content: ctx.transcript! },
    })
    .catch((error) => {
      logger.error({ error }, "Failed to save transcript");
    });

  return event;
}

/** Invokes the LLM to parse transcript into a structured recipe. */
async function recipeStep(
  ctx: PipelineContext,
): Promise<RecipeGenerated | RecipeGenerationFailed> {
  const { logger } = ctx;

  const event = await LlmService.parseRecipe(ctx.transcript!)
    .then((recipe) => {
      ctx.recipe = recipe;
      return new RecipeGenerated(recipe);
    })
    .catch(
      (error) =>
        new RecipeGenerationFailed({
          options: { cause: Error.isError(error) ? error : `${error}` },
        }),
    );

  logger.info({ type: event.type }, "Completed recipe generation");
  return event;
}

/**
 * Generates embedding and stores recipe + embedding in a single transaction.
 * Fails atomically if any DB operation fails.
 */
async function saveStep(
  ctx: PipelineContext,
): Promise<RecipeSaved | RecipeSavingFailed> {
  const { recipeSource, db, logger } = ctx;

  ensureDefined(ctx.recipe);
  const event = await LlmService.generateRecipeEmbedding(ctx.recipe)
    .then((embeddings) =>
      db.transaction(async (txn) => {
        const [recipe] = await txn
          .insert(recipe_schema)
          .values({
            recipe_source_id: recipeSource.id,
            name: ctx.recipe!.name,
            instructions: ctx.recipe!.instructions,
            ingredients: ctx.recipe!.ingredients,
            tags: ctx.recipe!.tags,
          })
          .returning();
        ensureDefined(recipe, "Failed to persist recipe");

        await txn.insert(embedding_schema).values({
          recipe_id: recipe.id,
          type: "text",
          data: embeddings,
        });

        return new RecipeSaved(recipe.id);
      }),
    )
    .catch(
      (error) =>
        new RecipeSavingFailed({
          options: { cause: Error.isError(error) ? error : `${error}` },
        }),
    );

  logger.info({ type: event.type }, "Completed recipe persistence");
  return event;
}

export async function* processRecipePipeline(
  recipeSource: RecipeSource,
  db: Database,
  logger: AppLogger,
  videoInfo: InnertubeVideoInfo,
  startFrom: number = 0,
): AsyncGenerator<RecipePipelineEventType> {
  const scopedLogger = logger.child({
    scope: "recipe-pipeline",
    videoId: recipeSource.external_id,
  });
  const ctx: PipelineContext = {
    recipeSource,
    db,
    logger: scopedLogger,
    videoInfo,
  };

  for (const step of RecipePipeline.slice(startFrom)) {
    const event = await step(ctx);
    yield event;

    if (event.type in RecipePipelineErrors) {
      // Early exit on first error event
      return;
    }
  }
}
