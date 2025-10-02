import * as z from "zod";

export const RecipeRawSchema = z
  .object({
    name: z.string().nullable(),
    instructions: z.string().nullable(),
    ingredients: z.array(
      z.object({
        name: z.string(),
        quantity: z.string().nullable(),
      }),
    ),
    tags: z.array(z.string()),
    error: z
      .object({
        reason: z.string(),
      })
      .optional()
      .nullable(),
  })
  .strict();

export const RecipeParsedSchema = z
  .object({
    name: z.string().transform((value) => value.trim().toLowerCase()),
    instructions: z.string(),
    ingredients: z.array(
      z.object({
        name: z.string().transform((value) => value.trim().toLowerCase()),
        quantity: z.string().nullable(),
      }),
    ),
    tags: z.array(z.string().transform((value) => value.trim().toLowerCase())),
  })
  .strict()
  .transform((data) => {
    const seenIngredientNames = new Set<string>();
    const ingredients: { name: string; quantity: string | null }[] = [];

    for (const ingredient of data.ingredients) {
      if (seenIngredientNames.has(ingredient.name)) continue;

      seenIngredientNames.add(ingredient.name);
      ingredients.push(ingredient);
    }

    data.ingredients = ingredients;
    data.tags = Array.from(new Set(data.tags));
    return data;
  });

export type ParsedRecipe = z.infer<typeof RecipeParsedSchema>;
export type RawRecipe = z.infer<typeof RecipeRawSchema>;
