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

async function saveContentItem(
  jobStepId: number,
  type: string,
  data: any,
  db: Database,
): Promise<void> {
  await db.insert(content_item_schema).values({
    job_step_id: jobStepId,
    content: { type, data },
  });
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

  let instructions: string | null = null;
  let parsedRecipe: ParsedRecipe | null = null;
  let embedding: number[] | null = null;

  for (const step of recipeJob.steps) {
    await db
      .update(job_step_schema)
      .set({
        status: "processing",
        started_at: sql`now()`,
      })
      .where(eq(job_step_schema.id, step.id));

    /**
     * TODO (anikait) - understand how the intermediate values can be saved
     * to the database (content_items)
     */
    try {
      switch (step.type) {
        case "extract_instructions": {
          instructions = await YoutubeService.getTranscript(videoId);
          break;
        }
        case "parse_recipe": {
          ensureDefined(instructions, "Recipe instructions is not populated");
          parsedRecipe = await LlmService.parseRecipe(instructions);
          break;
        }
        case "create_embeddings": {
          ensureDefined(parsedRecipe, "Recipe structure not available");
          embedding = await LlmService.generateRecipeEmbedding(parsedRecipe);
          break;
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : `${err}`;
      scoppedLogger.error(
        {
          stepId: step.id,
          stepTyoe: step.type,
          error: errorMessage,
        },
        "Recip job step failed",
      );

      /**
       * Failure of any one step in the job would lead to both the job step failure
       * and the job failure.
       *
       * TODO (anikait): maybe it would be better to pass the `updated_at` value,
       * otherwise the two values might differ a bit and could cause confusion when
       * looking at db
       */
      await db.transaction(async (txn) => {
        await Promise.all([
          txn
            .update(job_step_schema)
            .set({
              status: "failed",
              error_message: errorMessage,
              updated_at: sql`now()`,
            })
            .where(eq(job_step_schema.id, step.id)),
          txn
            .update(recipe_job_schema)
            .set({
              status: "failed",
              updated_at: sql`now()`,
              /**
               * This error message would be exposed outside of the application,
               * so it needs to be decided what exactly would be set here
               */
              error_message: "TODO",
            })
            .where(eq(recipe_job_schema.id, jobId)),
        ]);
      });

      /**
       * DO NOT REMOVE: this return ensures that in case of error
       * the processing of job is terminated. Code after this
       * point assumes all the steps were successful
       */
      return;
    }

    await db
      .update(job_step_schema)
      .set({
        status: "completed",
        updated_at: sql`now()`,
        completed_at: sql`now()`,
      })
      .where(eq(job_step_schema.id, step.id));
  }

  ensureDefined(parsedRecipe);
  ensureDefined(embedding);

  await db.transaction(async (txn) => {
    const [recipe] = await txn
      .insert(recipe_schema)
      .values({
        recipe_source_id: recipeJob.source.id,
        name: parsedRecipe.name,
        instructions: parsedRecipe.instructions,
        ingredients: parsedRecipe.ingredients,
        tags: parsedRecipe.tags,
      })
      .returning();
    ensureDefined(recipe);

    await Promise.all([
      txn.insert(embedding_schema).values({
        recipe_id: recipe.id,
        type: "text",
        data: embedding,
      }),
      txn
        .update(recipe_job_schema)
        .set({
          status: "completed",
          completed_at: sql`now()`,
          updated_at: sql`now()`,
        })
        .where(eq(recipe_job_schema.id, jobId)),
    ]);
  });
}

export async function getRecipeJob(
  jobId: number,
  db: Database,
): Promise<RecipeJob | null> {
  const [job] = await db
    .select({
      id: recipe_job_schema.id,
      status: recipe_job_schema.status,
      created_at: recipe_job_schema.created_at,
      started_at: recipe_job_schema.started_at,
      completed_at: recipe_job_schema.completed_at,
      error_message: recipe_job_schema.error_message,
      source: {
        id: recipe_source_schema.id,
        external_id: recipe_source_schema.external_id,
        type: recipe_source_schema.type,
      },
      /**
       * TODO: check if the query can be improved
       */
      steps: sql<
        {
          id: number;
          type: string;
          status: string;
          error_message: string | null;
        }[]
      >`
        COALESCE(
          JSON_AGG(
            JSON_BUILD_OBJECT(
              'id', ${job_step_schema.id},
              'type', ${job_step_schema.type},
              'status', ${job_step_schema.status},
              'error_message', ${job_step_schema.error_message}
            ) ORDER BY ${job_step_schema.order}
          ), '[]'::json
        )
      `,
    })
    .from(recipe_job_schema)
    .innerJoin(
      recipe_source_schema,
      eq(recipe_job_schema.recipe_source_id, recipe_source_schema.id),
    )
    .leftJoin(job_step_schema, eq(recipe_job_schema.id, job_step_schema.job_id))
    .where(eq(recipe_job_schema.id, jobId))
    .groupBy(recipe_job_schema.id, recipe_source_schema.id);

  if (!job) return null;
  return job;
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
      source: {
        id: recipeSource.id,
        external_id: recipeSource.external_id,
        type: recipeSource.type,
      },
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
