import { Elysia, status } from "elysia";
import { openapi } from "@elysiajs/openapi";
import * as z from "zod";
import { inputRecipeSchema } from "./recipe/schema";
import * as RecipeService from "./recipe/service";
import * as RecipeJobService from "./recipe/job";
import * as YoutubeService from "./youtube/service";
import { dbClient } from "./db";
import { baseLogger } from "./logger";

const youtubeClient = await YoutubeService.init();

const app = new Elysia()
  .derive(function setRequestId({ set }) {
    let requestId = set.headers["x-request-id"];
    if (!requestId) {
      requestId = Bun.randomUUIDv7();
      set.headers["x-request-id"] = requestId;
    }

    return { requestId };
  })
  .derive(function getRequestStartTime() {
    return { startTime: performance.now() };
  })
  .derive(function setupRequestLogger({ requestId, request }) {
    const logger = baseLogger.child({
      scope: "http",
      requestId,
      method: request.method,
      url: request.url,
    });

    return { logger };
  })
  .onError(function logError({ logger, error, code }) {
    if (!logger) {
      console.error("Logger not setup", error);
      return;
    }

    logger.error(
      {
        error,
        code,
      },
      "Request encountered an error",
    );
  })
  .onAfterResponse(function logResponseTime({ logger, set, startTime }) {
    logger.info(
      {
        status: set.status ?? 200,
        duration: performance.now() - startTime,
      },
      "Request Completed",
    );
  })
  .decorate("db", dbClient)
  .decorate("yt", youtubeClient)
  .use(
    openapi({
      mapJsonSchema: {
        zod: z.toJSONSchema,
      },
    }),
  )
  .post(
    "/recipe",
    async ({ logger, body, status, db }) => {
      const result = await RecipeService.processRecipeFromSource(
        body,
        db,
        logger,
      );
      switch (result.type) {
        case "validation-error":
          return status("Bad Request", result.error.message);
        case "recipe-already-exists-error":
          return status("Conflict", "Recipe already exists");
        case "job-created":
          return result.job;
      }
    },
    {
      detail: {
        summary: "Create recipe",
        description:
          "Processes a recipe from a source URL (currently supports YouTube Shorts). Creates a background job to extract and process the recipe content. Returns the job object on success, or validation/conflict errors if the recipe already exists or input is invalid.",
      },
      body: inputRecipeSchema,
    },
  )
  .get(
    "/recipe",
    async ({ logger, query, db }) => {
      logger.debug({ query: query.q }, "Searching recipes");
      return RecipeService.searchRecipes(query.q, db);
    },
    {
      detail: {
        summary: "Search recipes",
        description:
          "Searches through processed recipes using a text query. Returns a list of recipes that match the search criteria based on recipe content, ingredients, or other metadata.",
      },
      query: z.object({
        q: z.string().min(1).describe("Search query"),
      }),
    },
  )
  .get(
    "/recipe-job/:job-id",
    async ({ params, db, logger }) => {
      const job = await RecipeJobService.getRecipeJob(params["job-id"], db);
      if (!job) {
        logger.warn({ jobId: params["job-id"] }, "Recipe job not found");
        return status("Not Found");
      }

      logger.debug({ jobId: job.id, status: job.status }, "Recipe job fetched");
      return job;
    },
    {
      detail: {
        summary: "Get recipe job",
        description:
          "Retrieves the current status and details of a recipe processing job by its ID. Returns job information including status (pending, processing, completed, failed), creation time, and any associated recipe data when available.",
      },
      params: z.object({
        "job-id": z.coerce.number().describe("Recipe job ID"),
      }),
    },
  )
  .get("/recipe/:recipe-id", () => {}, {
    detail: {
      summary: "Get recipe",
      description:
        "Retrieves a complete recipe by its unique ID. Returns the full recipe data including ingredients, instructions, metadata, and any associated processing information.",
    },
    params: z.object({
      "recipe-id": z.coerce.number().describe("Recipe ID"),
    }),
  })
  .listen(6969);

baseLogger.info({ url: app.server?.url }, "Elysia server listening");
