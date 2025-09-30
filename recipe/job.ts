import type { EmbedResult } from "ai";
import type { ParsedRecipe } from "../llm/schema";
import * as YoutubeService from "../youtube/service";
import * as LlmService from "../llm/service";
import type { Database } from "../db";
import { recipe_job_schema } from "../db/schema";
import { eq, and, sql } from "drizzle-orm";

/**
 * Below is the definition of when a step is considered as
 * success, failure or skipped
 *
 * 1. success: only data key is present
 * 2. failure: only error key is present
 * 3. skipped: only the step name is there, both data and error is missing
 */
export type RecipeJobStep<
  Step extends string,
  Data,
  FailureMetadata = unknown,
> =
  | { name: Step; data: Data; error?: never }
  | { name: Step; data?: never; error: string; metadata?: FailureMetadata }
  | { name: Step; data?: never; error?: never };

export type YoutubeShortRecipePipeline = [
  RecipeJobStep<"instructions", string>,
  RecipeJobStep<"llm-parse", ParsedRecipe>,
  RecipeJobStep<"embeddings", EmbedResult<string>["embedding"]>,
];

async function runStep<T, P extends any[]>(
  step: RecipeJobStep<string, any, any>,
  fn: (...args: P) => Promise<T>,
  ...args: P
): Promise<T | null> {
  try {
    const result = await fn(...args);
    step.data = result;

    return result;
  } catch (err) {
    step.error = err instanceof Error ? err.message : `${err}`;

    return null;
  }
}

/**
 * TODO(anikait): A better of handling this job processing
 * exists for sure. Need to figure out how will different pieces
 * fit in together and then refactor the flow here
 */
export async function youtubeShortRecipeProcessor(
  videoId: string,
  jobId: number,
  db: Database,
): Promise<YoutubeShortRecipePipeline> {
  await db
    .update(recipe_job_schema)
    .set({
      status: "processing",
      current_step_index: 0,
      started_at: sql`NOW()`,
    })
    .where(eq(recipe_job_schema.id, jobId));

  const pipeline: YoutubeShortRecipePipeline = [
    { name: "instructions" },
    { name: "llm-parse" },
    { name: "embeddings" },
  ];

  const transcript = await runStep(
    pipeline[0],
    YoutubeService.getTranscript,
    videoId,
  );
  if (!transcript) {
    await db
      .update(recipe_job_schema)
      .set({
        status: "failed",
        steps: pipeline,
        error_message: `Unable to generate the transcript for the provided video`,
        updated_at: sql`NOW()`,
      })
      .where(eq(recipe_job_schema.id, jobId));

    return pipeline;
  }

  await db
    .update(recipe_job_schema)
    .set({
      steps: pipeline,
      current_step_index: 1,
      updated_at: sql`NOW()`,
    })
    .where(eq(recipe_job_schema.id, jobId));

  const recipe = await runStep(pipeline[1], LlmService.parseRecipe, transcript);
  if (!recipe) {
    await db
      .update(recipe_job_schema)
      .set({
        status: "failed",
        steps: pipeline,
        error_message: `Unable to parse the recipe instructions`,
        updated_at: sql`NOW()`,
      })
      .where(eq(recipe_job_schema.id, jobId));
    return pipeline;
  }

  await db
    .update(recipe_job_schema)
    .set({
      steps: pipeline,
      current_step_index: 2,
      updated_at: sql`NOW()`,
    })
    .where(eq(recipe_job_schema.id, jobId));

  const embeddings = await runStep(
    pipeline[2],
    LlmService.generateRecipeEmbedding,
    recipe,
  );
  if (!embeddings) {
    await db
      .update(recipe_job_schema)
      .set({
        status: "failed",
        steps: pipeline,
        error_message: `Unable to generate data required to make the recipe searchable`,
        updated_at: sql`NOW()`,
      })
      .where(eq(recipe_job_schema.id, jobId));
    return pipeline;
  }

  await db
    .update(recipe_job_schema)
    .set({
      status: "success",
      steps: pipeline,
      updated_at: sql`NOW()`,
      completed_at: sql`NOW()`,
    })
    .where(eq(recipe_job_schema.id, jobId));

  return pipeline;
}

export async function getRecipeJob(
  jobId: number,
  db: Database,
): Promise<typeof recipe_job_schema.$inferSelect | null> {
  const [job] = await db
    .select()
    .from(recipe_job_schema)
    .where(eq(recipe_job_schema.id, jobId));
  if (!job) return null;

  return job;
}
