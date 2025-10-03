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
    async function* createRecipe({ logger, body, status, db }) {
      for await (const event of RecipeService.processRecipeFromSource(
        body,
        db,
        logger,
      )) {
        switch (event.type) {
          case "recipeAlreadyExists": {
            // TODO - finalize error object
            return status(409);
          }
          case "recipeInputValidationFailed": {
            // TODO - finalize error object
            return status(422);
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
          // TODO - finalize error object
          case "transcriptGenerationFailed":
          case "recipeGenerationFailed":
          case "recipeSavingFailed": {
            logger.error(event, "Something went wrong while creating recipe")
            return status(500);
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
