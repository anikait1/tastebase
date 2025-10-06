import { Elysia, status } from "elysia";
import { openapi } from "@elysiajs/openapi";
import * as z from "zod";
import { inputRecipeSchema } from "./recipe/schema";
import * as RecipeService from "./recipe/service";
import * as YoutubeService from "./youtube/service";
import { dbClient } from "./db";
import { baseLogger } from "./logger";
import { ProblemDetails } from "./utils";
import { LlmRejectedError } from "./llm/type";

/**
 * HTTP server: attaches request-scoped metadata (id, startTime, logger) and
 * exposes streaming POST /recipe that yields pipeline events. Errors are logged
 * via onError and terminate the generator with an appropriate HTTP status.
 */
const app = new Elysia()
  /** Attach/propagate a stable request id for traceability */
  .derive(function setRequestId({ set }) {
    let requestId = set.headers["x-request-id"];
    if (!requestId) {
      requestId = Bun.randomUUIDv7();
      set.headers["x-request-id"] = requestId;
    }

    return { requestId };
  })
  /** Capture start time for latency logging */
  .derive(function getRequestStartTime() {
    return { startTime: performance.now() };
  })
  /** Create a request-scoped logger with consistent context */
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
  .decorate("yt", await YoutubeService.init())
  .use(
    openapi({
      mapJsonSchema: {
        zod: z.toJSONSchema,
      },
    }),
  )

  .post(
    "/recipe",
    /**
     * Streams recipe pipeline events back to the client as they complete.
     * Contract:
     *  - yields TranscriptGenerated → RecipeGenerated → RecipeSaved
     *  - on validation/conflict returns 422/409; on pipeline errors returns 500.
     */
    async function* createRecipe({
      logger,
      body,
      status,
      db,
      requestId,
      request,
    }) {
      for await (const event of RecipeService.processRecipeFromSource(
        body,
        db,
        logger,
      )) {
        switch (event.type) {
          case "recipeAlreadyExists": {
            return status(
              409,
              new ProblemDetails({
                type: event.uri,
                title: "Recipe for the given source already exists",
                status: 409,
                instance: request.url,
                extensions: {
                  requestId,
                  recipeId: event.recipeId,
                },
              }),
            );
          }
          case "recipeInputValidationFailed": {
            return status(
              422,
              new ProblemDetails({
                type: event.uri,
                title: "Invalid recipe input",
                status: 422,
                extensions: {
                  requestId,
                  issues: z.treeifyError(event.data),
                },
              }),
            );
          }
          case "videoUnavailable": {
            return status(
              422,
              new ProblemDetails({
                type: event.uri,
                title: "Video unavailable",
                status: 422,
                detail:
                  "The referenced YouTube video is unavailable or invalid.",
                instance: request.url,
                extensions: { requestId },
              }),
            );
          }
          case "videoTranscriptUnavailable": {
            return status(
              422,
              new ProblemDetails({
                type: event.uri,
                title: "Video transcript not available",
                status: 422,
                detail: "This video has no captions/transcript available.",
                instance: request.url,
                extensions: { requestId },
              }),
            );
          }
          case "recipeGenerationFailed":
          case "transcriptGenerationFailed":
          case "recipeSavingFailed": {
            if (event.cause instanceof LlmRejectedError) {
              console.log(event.cause.message);
              return status(
                422,
                new ProblemDetails({
                  type: event.uri,
                  title: "Cannot infer a recipe from the provided source",
                  status: 422,
                  instance: request.url,
                  detail: event.cause.message,
                  extensions: {
                    requestId,
                  },
                }),
              );
            }

            logger.error(
              event,
              "Something went wrong while execution of recipe pipeline",
            );
            return status(
              500,
              new ProblemDetails({
                type: event.uri,
                title: "Recipe generation failed",
                status: 500,
                instance: request.url,
                detail:
                  "An unexpected internal error occurred. This is on us—not you. Please share the requestId so we can investigate.",
                extensions: {
                  requestId,
                },
              }),
            );
          }
          case "transcriptGenerated": {
            yield event;
            break;
          }
          case "recipeGenerated": {
            yield event;
            break;
          }
          case "recipeSaved": {
            yield event;
            break;
          }
        }
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
    "/recipe/:recipe-id",
    async ({ logger, params, db }) => {
      logger.debug({ recipeId: params["recipe-id"] }, "Getting recipe");
      const recipe = await RecipeService.getRecipeById(params["recipe-id"], db);
      if (!recipe) {
        return status(404);
      }

      return recipe;
    },
    {
      detail: {
        summary: "Get recipe",
        description:
          "Retrieves a complete recipe by its unique ID. Returns the full recipe data including ingredients, instructions, metadata, and any associated processing information.",
      },
      params: z.object({
        "recipe-id": z.coerce.number().describe("Recipe ID"),
      }),
    },
  )
  .listen(6969);

baseLogger.info({ url: app.server?.url }, "Elysia server listening");
