import type { EmbedResult } from "ai";
import type { ParsedRecipe } from "../llm/schema";
import * as YoutubeService from "../youtube/service";
import * as LlmService from "../llm/service";
import type { Database } from "../db";
import { recipe_job_schema } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import type { AppLogger } from "../logger";

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

async function runStep<T, P extends unknown[]>(
  step: RecipeJobStep<string, unknown, unknown>,
  logger: AppLogger,
  fn: (...args: P) => Promise<T>,
  ...args: P
): Promise<T | null> {
  const startedAt = performance.now();
  logger.debug({ step: step.name }, "Job step started");

  try {
    const result = await fn(...args);
    step.data = result;

    logger.info(
      {
        step: step.name,
        durationMs: performance.now() - startedAt,
      },
      "Job step completed",
    );

    return result;
  } catch (error) {
    step.error = error instanceof Error ? error.message : `${error}`;

    logger.error(
      {
        step: step.name,
        durationMs: performance.now() - startedAt,
        err: error,
      },
      "Job step failed",
    );

    return null;
  }
}

/**
 * TODO(anikait): A better of handling this job processing
 * exists for sure. Need to figure out how will different pieces
 * fit in together and then refactor the flow here
 * 
 * The logger passed to this function already has the
 * bindings set for videoId and jobId, no need to set those
 * bindings in here
 */
export async function youtubeShortRecipeProcessor(
  videoId: string,
  jobId: number,
  db: Database,
  logger: AppLogger,
): Promise<YoutubeShortRecipePipeline> {
  logger.info("Starting youtube shorts recipe pipeline");

  await db
    .update(recipe_job_schema)
    .set({
      status: "processing",
      current_step_index: 0,
      started_at: sql`NOW()`,
      updated_at: sql`NOW()`,
    })
    .where(eq(recipe_job_schema.id, jobId));  
  logger.debug({ stepIndex: 0 }, "Advancing to recipe instructions step");

  const pipeline: YoutubeShortRecipePipeline = [
    { name: "instructions" },
    { name: "llm-parse" },
    { name: "embeddings" },
  ];

  const markFailure = async (message: string) => {
    await db
      .update(recipe_job_schema)
      .set({
        status: "failed",
        steps: pipeline,
        error_message: message,
        updated_at: sql`NOW()`,
      })
      .where(eq(recipe_job_schema.id, jobId));

    logger.error({ message }, "Recipe job marked as failed");
  };

  const transcript = await runStep(
    pipeline[0],
    logger,
    YoutubeService.getTranscript,
    videoId,
  );
  if (!transcript) {
    await markFailure(
      "Unable to generate the transcript for the provided video",
    );
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

  logger.debug({ stepIndex: 1 }, "Advancing to recipe parsing step");

  const recipe = await runStep(
    pipeline[1],
    logger,
    LlmService.parseRecipe,
    transcript,
  );
  if (!recipe) {
    await markFailure("Unable to parse the recipe instructions");
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

  logger.debug({ stepIndex: 2 }, "Advancing to embedding generation step");

  const embeddings = await runStep(
    pipeline[2],
    logger,
    LlmService.generateRecipeEmbedding,
    recipe,
  );
  if (!embeddings) {
    await markFailure(
      "Unable to generate data required to make the recipe searchable",
    );
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

  logger.info("Recipe job pipeline completed successfully");

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
