import type { ParsedRecipeLlm } from "../llm/schema";

export type RecipeSource = {
  id: number;
  external_id: string;
  type: string;
};

export type Ingredient = {
  name: string;
  quantity: string | null;
};

export type Recipe = {
  id: number;
  name: string;
  instructions: string;
  tags: string[];
  ingredients: Ingredient[];
};

export type RecipeJob = {
  id: number;
  source: RecipeSource;
  status: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  error_message: string | null;
  steps: RecipeJobStep[];
};

export type RecipeJobStep = {
  id: number;
  type: string;
  status: string;
  error_message: string | null;
};

export const RecipePipelineEventTypes = {
  transcriptGenerated: "transcriptGenerated",
  recipeGenerated: "recipeGenerated",
  recipeSaved: "recipeSaved",
} as const;

export const RecipePipelineErrors = {
  transcriptGenerationFailed: "transcriptGenerationFailed",
  recipeGenerationFailed: "recipeGenerationFailed",
  recipeSavingFailed: "recipeSavingFailed",
} as const;

export class TranscriptGenerated {
  public readonly type = RecipePipelineEventTypes.transcriptGenerated;
  constructor(public data: string) {}
}

export class RecipeGenerated {
  public readonly type = RecipePipelineEventTypes.recipeGenerated;
  constructor(public data: ParsedRecipeLlm) {}
}

export class RecipeSaved {
  public readonly type = RecipePipelineEventTypes.recipeSaved;
  constructor(public data: number) {}
}

export class TranscriptGenerationFailed extends Error {
  public readonly type = RecipePipelineErrors.transcriptGenerationFailed;
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(
      params?.message ?? "Unable to generate the transcription for the video",
      params?.options,
    );
    this.name = "TranscriptGenerationFailed";
  }
}

export class RecipeGenerationFailed extends Error {
  public readonly type = RecipePipelineErrors.recipeGenerationFailed;
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(
      params?.message ??
        "Unable to generate the recipe from the provided instructions",
      params?.options,
    );
    this.name = "RecipeGenerationFailed";
  }
}

export class RecipeSavingFailed extends Error {
  public readonly type = RecipePipelineErrors.recipeSavingFailed;
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(
      params?.message ?? "Unable to save the generated recipe",
      params?.options,
    );
    this.name = "RecipeSavingFailed";
  }
}

export type RecipePipelineSuccessEvent =
  | TranscriptGenerated
  | RecipeGenerated
  | RecipeSaved;

export type RecipePipelineErrorEvent =
  | TranscriptGenerationFailed
  | RecipeGenerationFailed
  | RecipeSavingFailed;

export type RecipePipelineEventType =
  | RecipePipelineSuccessEvent
  | RecipePipelineErrorEvent;
