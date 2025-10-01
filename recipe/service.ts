import { youtubeShortsRecipeSchema, type InputRecipeSchema } from "./schema";
import { eq, and, sql, cosineDistance, desc } from "drizzle-orm";
import {
  recipe_source_schema,
  recipe_schema,
  embedding_schema,
  recipe_job_schema,
} from "../db/schema";

import { strict as assert } from "node:assert";

import type { Database } from "../db";

import * as RecipeJobService from "./job";
import * as LlmService from "../llm/service";
import * as z from "zod";
import type { ZodError } from "zod";
import type { AppLogger } from "../logger";

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
  logger: AppLogger,
): Promise<ProcessRecipeResult> {
  const scopedLog = logger.child({
    scope: "recipe-service",
    source: schema.type,
  });

  switch (schema.type) {
    case "youtube-shorts": {
      const parsedSource = youtubeShortsRecipeSchema.safeParse(schema.data);
      if (parsedSource.error) {
        scopedLog.warn(
          {
            validationIssues: z.prettifyError(parsedSource.error),
          },
          "Recipe input validation failed",
        );

        return { type: "validation-error", error: parsedSource.error };
      }

      const { id: videoId } = parsedSource.data;
      scopedLog.setBindings({ videoId });
      scopedLog.info("Processing recipe source");

      const externalId = getExternalIdBySourceType(schema.type, videoId);
      const [existingRecipe] = await db
        .select({
          recipe: {
            id: recipe_schema.id,
            name: recipe_schema.name,
            instructions: recipe_schema.instructions,
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

      if (existingRecipe) {
        scopedLog.info(
          { recipeId: existingRecipe.recipe.id, externalId },
          "Recipe already exists for source",
        );
        return { type: "recipe-already-exists-error" };
      }

      scopedLog.info({ externalId }, "Creating recipe job");
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
      scopedLog.info({ jobId: recipeJob.id }, "Recipe job created");
      scopedLog.setBindings({ jobId: recipeJob.id });

      /**
       * TODO (anikait) - Move this function to a separate worker
       * When moving to a separate worker, we would most likely need
       * to change a bit of logic and only pass in the `recipeJob.id`
       */
      setImmediate(async function runRecipeJob(db) {
        try {
          const pipeline = await RecipeJobService.youtubeShortRecipeProcessor(
            videoId,
            recipeJob.id,
            db,
            scopedLog,
          );
          const parsedRecipe = pipeline[1].data;
          const generatedEmbeddings = pipeline[2].data;

          if (!parsedRecipe || !generatedEmbeddings) {
            scopedLog.error(
              {
                failedSteps: pipeline
                  .filter((step) => step.error)
                  .map((step) => ({ name: step.name, error: step.error })),
              },
              "Recipe pipeline failed to generate required data",
            );
            return;
          }

          await db.transaction(async function createRecipe(txn) {
            const [recipe] = await txn
              .insert(recipe_schema)
              .values({
                recipe_source_id: recipeJob.recipe_source_id,
                name: parsedRecipe.name,
                instructions: parsedRecipe.instructions,
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

            scopedLog.info(
              { recipeId: recipe.id },
              "Recipe persisted from processed job",
            );
          });
        } catch (err) {
          scopedLog.error(
            { err },
            "Recipe job execution failed with an unknown error",
          );
        }
      }, db);

      return { type: "job-created", job: recipeJob };
    }
  }
}

export async function searchRecipes(query: string, db: Database) {
  const queryEmbeddings = await LlmService.generateQueryEmbedding(query);

  const similarity = sql<number>`1 - (${cosineDistance(
    embedding_schema.data,
    queryEmbeddings,
  )})`;

  const keywordScore = sql<number>`ts_rank_cd(
    setweight(to_tsvector('english', coalesce(${recipe_schema.name}, '')), 'A') ||
    setweight(to_tsvector('english', array_to_string(${recipe_schema.tags}, ' ')), 'B') ||
    setweight(to_tsvector('english', coalesce(${recipe_schema.ingredients}::text, '')), 'A'),
    plainto_tsquery('english', ${query})
  )`;

  const finalScore = sql<number>`(0.7 * ${similarity} + 0.3 * ${keywordScore})`;
  return await db
    .select({
      similarity,
      keywordScore,
      finalScore,
      recipe: {
        id: recipe_schema.id,
        name: recipe_schema.name,
        instructions: recipe_schema.instructions,
        ingredients: recipe_schema.ingredients,
        tags: recipe_schema.tags,
      },
    })
    .from(embedding_schema)
    .innerJoin(recipe_schema, eq(embedding_schema.recipe_id, recipe_schema.id))
    .orderBy(desc(finalScore));
}
