import { embed, generateObject, type EmbedResult } from "ai";
import { RECIPE_ANALYSER_PROMPT_CURSOR_V1 } from "./prompt";
import { openai } from "@ai-sdk/openai";
import {
  RecipeParsedSchema,
  RecipeRawSchema,
  type ParsedRecipe,
} from "./schema";

export async function parseRecipe(instructions: string): Promise<ParsedRecipe> {
  const result = await generateObject({
    model: openai("gpt-4o"),
    schema: RecipeRawSchema,
    prompt: `${RECIPE_ANALYSER_PROMPT_CURSOR_V1}
    <input>
    """${instructions}"""
    </input>
    `,
  });

  if (result.object.error?.reason) {
    throw new Error(result.object.error.reason);
  }

  delete result.object.error;
  const parsed = RecipeParsedSchema.safeParse(result.object);
  if (!parsed.success) {
    throw new Error(
      `Schema validation failed: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  return parsed.data;
}

export async function generateRecipeEmbedding(
  recipe: ParsedRecipe,
): Promise<EmbedResult<string>["embedding"]> {
  const ingredientsText = recipe.ingredients
    .map((ingredient) =>
      ingredient.quantity
        ? `${ingredient.name} (${ingredient.quantity})`
        : ingredient.name,
    )
    .join(", ");

  const text = [
    `Name: ${recipe.name}`,
    `Description: ${recipe.description}`,
    `Ingredients: ${ingredientsText}`,
    `Tags: ${recipe.tags.join(", ")}`,
  ].join("\n");

  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: text,
  });

  return embedding;
}

export async function generateQueryEmbedding(
  query: string,
): Promise<EmbedResult<string>["embedding"]> {
  const { embedding } = await embed({
    model: openai.embedding("text-embedding-3-small"),
    value: query,
  });

  return embedding;
}
