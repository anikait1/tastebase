import { youtubeShortsRecipeSchema, type InputRecipeSchema } from "./schema";
import { eq, and, sql, cosineDistance, desc } from "drizzle-orm";
import {
  recipe_source_schema,
  recipe_schema,
  embedding_schema,
} from "../db/schema";

import type { Database } from "../db";

import * as RecipeJobService from "./job";
import * as LlmService from "../llm/service";
import * as z from "zod";
import type { AppLogger } from "../logger";
import {
  RecipeAlreadyExists,
  RecipeInputValidationFailed,
  type Recipe,
  type RecipePipelineEventType,
  type RecipeSource,
  VideoUnavailable,
} from "./type";
import { ensureDefined } from "../utils";
import * as YoutubeService from "../youtube/service";

/**
 * Validates input, enforces dedup by (external_id,type), persists a recipe_source,
 * and delegates to the pipeline while streaming each event to the caller.
 * Early‑exit on validation failure or existing recipe.
 *
 * Few key pieces that are missing here:
 * 1. Determine the start step of recipe pipeline in case it failed earlier due to a recoverable error
 * 2. Currently the pipeline may end up being in a "corrupt" state if a recipe source is created but
 * the recipe is not stored, this is because recipe would not be found for the corresponding source but
 * when the time comes to insert a recipe source it would fail because of the unique index. Few options
 * exist to solve for this, need to brainstorm which one would be ideal
 *   a. Restart the pipeline from desired step, check the corresponding tables to understand on which
 *   step should the pipeline begin from.
 *   b. Delete the recipe source in case of an error and always start the pipeline from scratch.
 * 3. In error cases, currently no information is stored in db (transcript aside). To prevent abuse
 * it would be better to either rate limit people or store referenes to failed attempts. Storing
 * references might be tricky since people could still spam and abuse the system.
 */
export async function* processRecipeFromSource(
  schema: InputRecipeSchema,
  db: Database,
  logger: AppLogger,
): AsyncGenerator<
  | RecipePipelineEventType
  | RecipeInputValidationFailed
  | RecipeAlreadyExists
  | VideoUnavailable
> {
  const sourceType = schema.type;
  const scopedLogger = logger.child({
    scope: "recipe-service",
    source: sourceType,
  });

  const parsedSource = youtubeShortsRecipeSchema.safeParse(schema.data);
  if (parsedSource.error) {
    scopedLogger.warn(
      {
        validationIssues: z.prettifyError(parsedSource.error),
      },
      "Recipe input validation failed",
    );
    yield new RecipeInputValidationFailed(parsedSource.error);
    return;
  }

  const { id: externalId } = parsedSource.data;
  scopedLogger.setBindings({ externalId });
  scopedLogger.info("Processing recipe source");

  const existingRecipe = await getRecipeByExternalId(
    externalId,
    sourceType,
    db,
  );
  if (existingRecipe) {
    scopedLogger.info(
      { recipeId: existingRecipe.id, externalId },
      "Recipe already exists for source",
    );
    yield new RecipeAlreadyExists(existingRecipe.id);
    return;
  }

  const videoInfo = await YoutubeService.getVideoInfo(externalId).catch(error => {
    scopedLogger.warn({error}, "Video unavailable or invalid")
    return null;
  });
  if (!videoInfo) {
    yield new VideoUnavailable();
    return;
  }

  const recipeSource = await createRecipeSource({
    type: sourceType,
    externalId: externalId,
    db,
  });
  for await (const event of RecipeJobService.processRecipePipeline(
    recipeSource,
    db,
    logger,
    videoInfo,
  )) {
    yield event;
  }
}

/**
 * Hybrid search:
 *  finalScore = 0.7 * (1 - cosineDistance(embedding, qEmb))
 *             + 0.3 * ts_rank_cd(name,tags,ingredients)
 * Returns recipes ordered by finalScore.
 *
 * TODO - Need to come up with the final approach here and how much importance
 * should be given to search criteria. This would probably change as time
 * goes by and more data is in the system to better understand the user
 * queries.
 *
 * TODO - Add indexing across the columns being searched. This is a general
 * theme across the codebase, no indexing has been done as of now.
 */
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
  type: string,
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

async function createRecipeSource(params: {
  type: string;
  externalId: string;
  db: Database;
}): Promise<RecipeSource> {
  const [recipeSource] = await params.db
    .insert(recipe_source_schema)
    .values({
      type: params.type,
      external_id: params.externalId,
    })
    .returning({
      id: recipe_source_schema.id,
      external_id: recipe_source_schema.external_id,
      type: recipe_source_schema.type,
    });
  ensureDefined(recipeSource, "Failed to persist recipe source");

  return recipeSource;
}
