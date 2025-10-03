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
} from "./type";
import { ensureDefined } from "../utils";

export async function* processRecipeFromSource(
  schema: InputRecipeSchema,
  db: Database,
  logger: AppLogger,
): AsyncGenerator<
  RecipePipelineEventType | RecipeInputValidationFailed | RecipeAlreadyExists
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

  const existingRecipe = await getRecipeByExternalId(externalId, sourceType, db);
  if (existingRecipe) {
    scopedLogger.info(
      { recipeId: existingRecipe.id, externalId },
      "Recipe already exists for source",
    );
    yield new RecipeAlreadyExists(existingRecipe.id);
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
  )) {
    yield event;
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
