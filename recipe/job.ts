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
import { ensureDefined } from "../utils";

const RecipePipeline: PipelineStep[] = [transcriptStep, recipeStep, saveStep];

async function transcriptStep(
  ctx: PipelineContext,
): Promise<TranscriptGenerated | TranscriptGenerationFailed> {
  const { recipeSource, db, logger } = ctx;
  const videoId = recipeSource.external_id;

  const event = await YoutubeService.getTranscript(videoId)
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
  startFrom: number = 0,
): AsyncGenerator<RecipePipelineEventType> {
  const scopedLogger = logger.child({
    scope: "recipe-pipeline",
    videoId: recipeSource.external_id,
  });
  const ctx: PipelineContext = { recipeSource, db, logger: scopedLogger };

  for (const step of RecipePipeline.slice(startFrom)) {
    const event = await step(ctx);
    yield event;

    if (event.type in RecipePipelineErrors) {
      return;
    }
  }
}
