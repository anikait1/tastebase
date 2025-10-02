import { youtubeShortsRecipeSchema, type InputRecipeSchema } from "./schema";
import { eq, and, sql, cosineDistance, desc } from "drizzle-orm";
import {
  recipe_source_schema,
  recipe_schema,
  embedding_schema,
  recipe_job_schema,
} from "../db/schema";

import type { Database } from "../db";

import * as RecipeJobService from "./job";
import * as LlmService from "../llm/service";
import * as z from "zod";
import type { ZodError } from "zod";
import type { AppLogger } from "../logger";
import type { Recipe, RecipeJob } from "./type";
import { ensureDefined } from "../utils";

function getExternalIdBySourceType(
  sourceType: "youtube-shorts",
  sourceId: string,
): string {
  switch (sourceType) {
    case "youtube-shorts":
      return `yt_short_${sourceId}`;
  }
}

type ProcessRecipeResult =
  | { type: "validation-error"; error: ZodError }
  | { type: "recipe-already-exists-error" }
  | { type: "job-created"; job: RecipeJob };

export async function processRecipeFromSource(
  schema: InputRecipeSchema,
  db: Database,
  logger: AppLogger,
): Promise<ProcessRecipeResult> {
  const scopedLogger = logger.child({
    scope: "recipe-service",
    source: schema.type,
  });

  switch (schema.type) {
    case "youtube-shorts": {
      const parsedSource = youtubeShortsRecipeSchema.safeParse(schema.data);
      if (parsedSource.error) {
        scopedLogger.warn(
          {
            validationIssues: z.prettifyError(parsedSource.error),
          },
          "Recipe input validation failed",
        );

        return { type: "validation-error", error: parsedSource.error };
      }

      const { id: videoId } = parsedSource.data;
      scopedLogger.setBindings({ videoId });
      scopedLogger.info("Processing recipe source");

      const externalId = getExternalIdBySourceType(schema.type, videoId);
      const existingRecipe = await getRecipeByExternalId(externalId, db);

      if (existingRecipe) {
        scopedLogger.info(
          { recipeId: existingRecipe.id, externalId },
          "Recipe already exists for source",
        );
        return { type: "recipe-already-exists-error" };
      }

      scopedLogger.info({ externalId }, "Creating recipe job");
      const recipeJob = await RecipeJobService.createRecipeJob(schema.type, externalId, db);
      scopedLogger.info({ jobId: recipeJob.id }, "Recipe job created");

      /**
       * TODO (anikait) - Move this function to a separate worker
       * When moving to a separate worker, we would most likely need
       * to change a bit of logic and only pass in the `recipeJob.id`
       */
      setImmediate(async function runRecipeJob(db) {
        try {
          await RecipeJobService.processRecipeJob(
            recipeJob.id,
            videoId,
            db,
            scopedLogger,
          );
        } catch (err) {
          scopedLogger.error(
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

async function getRecipeByExternalId(
  externalId: string,
  db: Database,
): Promise<Recipe | null> {
  const [recipe] = await db
    .select({
      id: recipe_schema.id,
      name: recipe_schema.name,
      instructions: recipe_schema.instructions,
      tags: recipe_schema.tags,
      ingredients: recipe_schema.ingredients,
    })
    .from(recipe_schema)
    .innerJoin(
      recipe_source_schema,
      and(
        eq(recipe_schema.recipe_source_id, recipe_source_schema.id),
        eq(recipe_source_schema.external_id, externalId),
      ),
    );

  if (!recipe) return null;
  return recipe;
}
