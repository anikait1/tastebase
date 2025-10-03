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
} from "./type";
import * as YoutubeService from "../youtube/service";
import { ensureDefined } from "../utils";

export async function* parseRecipePipeline(
  recipeSource: RecipeSource,
  db: Database,
  logger: AppLogger,
): AsyncGenerator<RecipePipelineEventType> {
  const videoId = recipeSource.external_id;
  const scopedLogger = logger.child({
    scope: "recipe-pipeline",
    videoId,
  });

  const transcriptEvent = await YoutubeService.getTranscript(videoId)
    .then((transcript) => new TranscriptGenerated(transcript))
    .catch(
      (error) =>
        new TranscriptGenerationFailed({
          options: { cause: Error.isError(error) ? error : `${error}` },
        }),
    );

  scopedLogger.info(
    { type: transcriptEvent.type },
    "Completed transcript generation",
  );
  if (
    RecipePipelineErrors.transcriptGenerationFailed === transcriptEvent.type
  ) {
    yield transcriptEvent;
    return;
  }

  db.insert(content_item_schema)
    .values({
      recipe_source_id: recipeSource.id,
      pipeline_step: transcriptEvent.type,
      data: { type: "string", content: transcriptEvent.data },
    })
    .catch((error) => {
      logger.error("Failed to save generated transctipt");
    });

  yield transcriptEvent;

  const generatedRecipeEvent = await LlmService.parseRecipe(
    transcriptEvent.data,
  )
    .then((generatedRecipe) => new RecipeGenerated(generatedRecipe))
    .catch(
      (error) =>
        new RecipeGenerationFailed({
          options: { cause: Error.isError(error) ? error : `${error}` },
        }),
    );

  scopedLogger.info(
    { type: generatedRecipeEvent.type },
    "Completed recipe generation",
  );
  if (
    RecipePipelineErrors.recipeGenerationFailed === generatedRecipeEvent.type
  ) {
    yield generatedRecipeEvent;
    return;
  }

  yield generatedRecipeEvent;

  const generatedRecipe = generatedRecipeEvent.data;
  const recipeSavedEvent = await LlmService.generateRecipeEmbedding(generatedRecipe)
    .then((emdeddings) =>
      db.transaction(async (txn) => {
        const [recipe] = await txn
          .insert(recipe_schema)
          .values({
            recipe_source_id: recipeSource.id,
            name: generatedRecipe.name,
            instructions: generatedRecipe.instructions,
            ingredients: generatedRecipe.ingredients,
            tags: generatedRecipe.tags,
          })
          .returning();
        ensureDefined(recipe, "Failed to persist recipe");

        await txn.insert(embedding_schema).values({
          recipe_id: recipe.id,
          type: "text",
          data: emdeddings,
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

    scopedLogger.info({
      type: recipeSavedEvent.type
    }, "Completed recipe persistence in database")
  
    yield recipeSavedEvent;
    return;
}
