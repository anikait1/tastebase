import * as z from "zod";
import type { ParsedRecipeLlm } from "../llm/schema";
import type { Database } from "../db";
import type { AppLogger } from "../logger";
import type { InnertubeVideoInfo } from "../youtube/service";

export type RecipeSource = {
  id: number;
  external_id: string;
  type: string;
};

export type PipelineContext = {
  recipeSource: RecipeSource;
  db: Database;
  logger: AppLogger;
  videoInfo: InnertubeVideoInfo;
  transcript?: string;
  recipe?: ParsedRecipeLlm;
};

export type PipelineStep = (
  ctx: PipelineContext,
) => Promise<RecipePipelineEventType>;

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
  public readonly uri =
    "https://tastebase.dev/http-errors/transcript-generation-failed";
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
  public readonly uri =
    "https://tastebase.dev/http-errors/recipe-generation-failed";
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
  public readonly uri =
    "https://tastebase.dev/http-errors/recipe-saving-failed";
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(
      params?.message ?? "Unable to save the generated recipe",
      params?.options,
    );
    this.name = "RecipeSavingFailed";
  }
}

export class RecipeAlreadyExists extends Error {
  public readonly type = "recipeAlreadyExists";
  public readonly uri =
    "https://tastebase.dev/http-errors/recipe-already-exists";
  public readonly recipeId: number;
  constructor(
    recipeId: number,
    params?: { message?: string; options?: ErrorOptions },
  ) {
    super(params?.message ?? "Recipe already exists", params?.options);
    this.recipeId = recipeId;
    this.name = "RecipeAlreadyExists";
  }
}

export class RecipeInputValidationFailed extends Error {
  public readonly type = "recipeInputValidationFailed";
  public readonly uri =
    "https://tastebase.dev/http-errors/recipe-input-validation";
  public readonly data: z.ZodError;
  constructor(
    zodError: z.ZodError,
    params?: { message?: string; options?: ErrorOptions },
  ) {
    super(params?.message ?? "Recipe validation failed", params?.options);
    this.data = zodError;
    this.name = "RecipeInputValidationFailed";
  }
}

export class VideoUnavailable extends Error {
  public readonly type = "videoUnavailable";
  public readonly uri = "https://tastebase.dev/http-errors/video-unavailable";
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(
      params?.message ?? "The referenced YouTube video is unavailable",
      params?.options,
    );
    this.name = "VideoUnavailable";
  }
}

export class VideoTranscriptUnavailable extends Error {
  public readonly type = "videoTranscriptUnavailable";
  public readonly uri =
    "https://tastebase.dev/http-errors/video-transcript-unavailable";
  constructor(params?: { message?: string; options?: ErrorOptions }) {
    super(params?.message ?? "Video transcript not available", params?.options);
    this.name = "VideoTranscriptUnavailable";
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
