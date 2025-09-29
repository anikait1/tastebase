import { youtubeShortsRecipeSchema, type InputRecipeSchema } from "./schema";
import { eq, and } from "drizzle-orm";
import {
  recipe_source_schema,
  recipe_schema,
  embedding_schema,
  recipe_job_schema,
} from "../db/schema";

import type { Database } from "../db";

import * as RecipeJobProcessor from "./job";

function getExternalIdBySourceType(
  sourceType: "youtube-shorts",
  sourceId: string,
): string {
  switch (sourceType) {
    case "youtube-shorts":
      return `yt_short_${sourceId}`;
  }
}

export async function processRecipeFromSource(
  schema: InputRecipeSchema,
  db: Database,
) {
  switch (schema.type) {
    case "youtube-shorts": {
      const schemaParseResult = youtubeShortsRecipeSchema.safeParse(
        schema.data,
      );

      if (schemaParseResult.error) {
        return schemaParseResult.error;
      }

      const { id: videoId } = schemaParseResult.data;
      const externalId = getExternalIdBySourceType(schema.type, videoId);

      const existingRecipe = db
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

      if (existingRecipe) return existingRecipe;

      const recipeJob = await db.transaction(async (txn) => {
        const [recipeSource] = await txn
          .insert(recipe_source_schema)
          .values({
            external_id: externalId,
            type: schema.type,
          })
          .returning();

        // TODO: add reason why this is for typescript
        if (!recipeSource) throw new Error();

        // TODO - handle on conflict error
        const [recipeJob] = await txn
          .insert(recipe_job_schema)
          .values({
            recipe_source_id: recipeSource.id,
          })
          .returning();

        // TODO: add reason why this is for typescript
        if (!recipeJob) throw new Error();

        return recipeJob;
      });

      await db.update(recipe_job_schema).set({
        status: "processing",
      });

      const pipeline = await RecipeJobProcessor.youtubeShortRecipeProcessor(
        videoId,
        recipeJob.id,
        db,
      );

      const parsedRecipe = pipeline[1].data;
      const generatedEmbeddings = pipeline[2].data;

      if (!parsedRecipe || !generatedEmbeddings) {
        return null;
      }

      await db.transaction(async (txn) => {
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

        // TODO - for the typescript
        if (!recipe) throw new Error("");

        await txn.insert(embedding_schema).values({
          recipe_id: recipe.id,
          type: "text",
          data: generatedEmbeddings,
        });
      });
    }
  }
}
