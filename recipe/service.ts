import { youtubeShortsRecipeSchema, type InputRecipeSchema } from "./schema";
import { eq, and } from "drizzle-orm";
import {
  recipe_source_schema,
  recipe_schema,
  embedding_schema,
  recipe_job_schema,
} from "../db/schema";

import { strict as assert } from "node:assert";

import type { Database } from "../db";

import * as RecipeJobService from "./job";
import type { ZodError } from "zod";

function getExternalIdBySourceType(
  sourceType: "youtube-shorts",
  sourceId: string,
): string {
  switch (sourceType) {
    case "youtube-shorts":
      return `yt_short_${sourceId}`;
  }
}

function ensureDefined<T>(
  value: T,
  message?: string,
): asserts value is NonNullable<T> {
  assert.notEqual(value, undefined, message);
  assert.notEqual(value, null, message);
}

type ProcessRecipeResult =
  | { type: "validation-error"; error: ZodError }
  | { type: "recipe-already-exists-error" }
  | { type: "job-created"; job: typeof recipe_job_schema.$inferSelect };

export async function processRecipeFromSource(
  schema: InputRecipeSchema,
  db: Database,
): Promise<ProcessRecipeResult> {
  switch (schema.type) {
    case "youtube-shorts": {
      const schemaParseResult = youtubeShortsRecipeSchema.safeParse(
        schema.data,
      );
      if (schemaParseResult.error)
        return { type: "validation-error", error: schemaParseResult.error };

      const { id: videoId } = schemaParseResult.data;
      const externalId = getExternalIdBySourceType(schema.type, videoId);

      const [existingRecipe] = await db
        .select({
          recipe: {
            id: recipe_schema.id,
            name: recipe_schema.name,
            description: recipe_schema.description,
            tags: recipe_schema.tags,
            ingredients: recipe_schema.ingredients,
          },
          source: {
            type: recipe_source_schema.type,
          },
        })
        .from(recipe_schema)
        .innerJoin(
          recipe_source_schema,
          and(
            eq(recipe_schema.recipe_source_id, recipe_source_schema.id),
            eq(recipe_source_schema.external_id, externalId),
          ),
        );
      if (existingRecipe) return { type: "recipe-already-exists-error" };

      // TODO (anikait) - handle on conflict errors
      const recipeJob = await db.transaction(
        async function createRecipeJob(txn) {
          const [recipeSource] = await txn
            .insert(recipe_source_schema)
            .values({
              external_id: externalId,
              type: schema.type,
            })
            .returning();

          ensureDefined(recipeSource);

          const [recipeJob] = await txn
            .insert(recipe_job_schema)
            .values({
              recipe_source_id: recipeSource.id,
            })
            .returning();

          ensureDefined(recipeJob);
          return recipeJob;
        },
      );

      /**
       * TODO (anikait) - Move this function to a separate worker
       * When moving to a separate worker, we would most likely need
       * to change a bit of logic and only pass in the `recipeJob.id`
       */
      setImmediate(async function runRecipeJob(db) {
        try {
          await db
            .update(recipe_job_schema)
            .set({
              status: "processing",
            })
            .where(eq(recipe_job_schema.id, recipeJob.id));

          const pipeline = await RecipeJobService.youtubeShortRecipeProcessor(
            videoId,
            recipeJob.id,
            db,
          );
          const parsedRecipe = pipeline[1].data;
          const generatedEmbeddings = pipeline[2].data;

          if (!parsedRecipe || !generatedEmbeddings) {
            console.log(`Unable to process youtube video`, {
              jobId: recipeJob.id,
              videoId,
            });
            return;
          }

          await db.transaction(async function createRecipe(txn) {
            const [recipe] = await txn
              .insert(recipe_schema)
              .values({
                recipe_source_id: recipeJob.recipe_source_id,
                name: parsedRecipe.name,
                description: parsedRecipe.description,
                tags: parsedRecipe.tags,
                ingredients: parsedRecipe.ingredients,
              })
              .returning();

            ensureDefined(recipe);

            await txn.insert(embedding_schema).values({
              recipe_id: recipe.id,
              type: "text",
              data: generatedEmbeddings,
            });
          });
        } catch (err) {}
      }, db);

      return { type: "job-created", job: recipeJob };
    }
  }
}
