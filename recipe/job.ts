import { sql, eq, and } from "drizzle-orm";
import type { AppLogger } from "../logger";
import {
  content_item_schema,
  job_step_schema,
  recipe_job_schema,
  recipe_schema,
  embedding_schema,
  recipe_source_schema,
} from "../db/schema";
import type { Database } from "../db";
import * as YoutubeService from "../youtube/service";
import * as LlmService from "../llm/service";
import type { ParsedRecipe } from "../llm/schema";
import type { InputRecipeSchema } from "./schema";
import { ensureDefined } from "../utils";
import type { RecipeJob } from "./type";

type StepType = "extract_instructions" | "parse_recipe" | "create_embeddings";


const YOUTUBE_SHORT_RECIPE_JOB_STEPS: { type: StepType; order: number }[] = [
  { type: "extract_instructions", order: 0 },
  { type: "parse_recipe", order: 1 },
  { type: "create_embeddings", order: 2 },
];

async function markJobFailed(
  db: Database,
  jobId: number,
  message: string,
): Promise<void> {
  await db
    .update(recipe_job_schema)
    .set({ status: "failed", error_message: message, updated_at: sql`now()` })
    .where(eq(recipe_job_schema.id, jobId));
}


async function markJobStepAsProcessing(jobId: number, stepId: number, db: Database) {
  await db.update(job_step_schema).set({
    status: 'processing',
    started_at: sql`now()`
  })
}

async function runStep() {

}

export async function processRecipeJob(
  jobId: number,
  videoId: string,
  db: Database,
  logger: AppLogger,
): Promise<void> {
  const scoppedLogger = logger.child({ jobId, scope: "recipe-job" });
  await db
    .update(recipe_job_schema)
    .set({
      status: "processing",
      started_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(eq(recipe_job_schema.id, jobId));

  const recipeJob = await getRecipeJob(jobId, db);
  ensureDefined(recipeJob);

  for (const step of recipeJob.steps) {
    await markJobStepAsProcessing(
      jobId,
      step.id,
      db
    )

    scoppedLogger.info({ step: step.type }, "Running job step");
    try {
      switch (step.type) {
        case 'extract_instructions': {
          const youtubeTranscript = await YoutubeService.getTranscript(videoId);
        }
      }
    } catch (err) {

    }
  }

}

export async function getRecipeJob(
  jobId: number,
  db: Database,
): Promise<RecipeJob | null> {
  const [job] = await db
    .select()
    .from(recipe_job_schema)
    .where(eq(recipe_job_schema.id, jobId))
    .limit(1);

  if (!job) return null;

  const steps = await db
    .select({
      id: job_step_schema.id,
      type: job_step_schema.type,
      status: job_step_schema.status,
      error_message: job_step_schema.error_message,
    })
    .from(job_step_schema)
    .where(eq(job_step_schema.job_id, jobId))
    .orderBy(job_step_schema.order);

  return {
    id: job.id,
    status: job.status,
    created_at: job.created_at,
    started_at: job.started_at,
    completed_at: job.completed_at,
    error_message: job.error_message,
    steps: steps.map((step) => ({
      id: step.id,
      type: step.type,
      status: step.status,
      error_message: step.error_message,
    })),
  };
}

export async function createRecipeJob(
  sourceType: InputRecipeSchema["type"],
  externalId: string,
  db: Database,
): Promise<RecipeJob> {
  return await db.transaction(async (txn) => {
    const [recipeSource] = await txn
      .insert(recipe_source_schema)
      .values({
        external_id: externalId,
        type: sourceType,
      })
      .returning();

    ensureDefined(recipeSource);

    const [recipeJob] = await txn
      .insert(recipe_job_schema)
      .values({
        recipe_source_id: recipeSource.id,
      })
      .returning();

    ensureDefined(recipeJob);

    const steps = await txn
      .insert(job_step_schema)
      .values(
        YOUTUBE_SHORT_RECIPE_JOB_STEPS.map((step) => ({
          job_id: recipeJob.id,
          type: step.type,
          order: step.order,
        })),
      )
      .returning();

    return {
      id: recipeJob.id,
      status: recipeJob.status,
      created_at: recipeJob.created_at,
      started_at: recipeJob.started_at,
      completed_at: recipeJob.completed_at,
      error_message: recipeJob.error_message,
      steps: steps.map((step) => ({
        id: step.id,
        type: step.type,
        status: step.status,
        error_message: step.error_message,
      })),
    };
  });
}
