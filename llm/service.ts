import { embed, generateObject, type EmbedResult } from "ai";
import { RECIPE_ANALYSER_PROMPT_CURSOR_V1 } from "./prompt";
import { openai } from "@ai-sdk/openai";
import {
  RecipeParsedSchema,
  RecipeRawSchema,
  type ParsedRecipeLlm,
  type RawRecipeLlm,
} from "./schema";
import {
  LlmEmbeddingError,
  LlmInvocationError,
  LlmParseError,
  LlmRejectedError,
} from "./errors";

export async function parseRecipe(
  instructions: string,
): Promise<ParsedRecipeLlm> {
  let result: RawRecipeLlm;
  try {
    ({ object: result } = await generateObject({
      model: openai("gpt-4o"),
      schema: RecipeRawSchema,
      prompt: `${RECIPE_ANALYSER_PROMPT_CURSOR_V1}
    <input>
    """${instructions}"""
    </input>
    `,
    }));
  } catch (error) {
    const options = error instanceof Error ? { cause: error } : undefined;
    throw new LlmInvocationError(
      "Unexpected error occurred while invoking the LLM.",
      options,
    );
  }

  if (result.error?.reason) {
    throw new LlmRejectedError(result.error.reason);
  }

  delete result.error;
  const parsed = RecipeParsedSchema.safeParse(result);
  if (!parsed.success) {
    throw new LlmParseError(
      `Schema validation failed: ${parsed.error.issues
        .map((issue) => issue.message)
        .join("; ")}`,
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export async function generateRecipeEmbedding(
  recipe: ParsedRecipeLlm,
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
    `Instructions: ${recipe.instructions}`,
    `Ingredients: ${ingredientsText}`,
    `Tags: ${recipe.tags.join(", ")}`,
  ].join("\n");

  try {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: text,
    });

    return embedding;
  } catch (error) {
    const options = error instanceof Error ? { cause: error } : undefined;
    throw new LlmEmbeddingError(
      "Failed to generate recipe embedding.",
      options,
    );
  }
}

export async function generateQueryEmbedding(
  query: string,
): Promise<EmbedResult<string>["embedding"]> {
  try {
    const { embedding } = await embed({
      model: openai.embedding("text-embedding-3-small"),
      value: query,
    });

    return embedding;
  } catch (error) {
    const options = error instanceof Error ? { cause: error } : undefined;
    throw new LlmEmbeddingError("Failed to generate query embedding.", options);
  }
}
