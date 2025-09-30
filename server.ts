import { Elysia, status } from "elysia";
import { openapi } from "@elysiajs/openapi";
import * as z from "zod";
import { inputRecipeSchema } from "./recipe/schema";
import * as RecipeService from "./recipe/service";
import * as RecipeJobService from "./recipe/job";
import * as YoutubeService from "./youtube/service";
import { dbClient } from "./db";

const app = new Elysia()
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
    async ({ status, body, db }) => {
      const result = await RecipeService.processRecipeFromSource(body, db);
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
      body: inputRecipeSchema,
    },
  )
  .get("/recipe", () => {}, {
    query: z.object({
      q: z.string().min(1),
    }),
  })
  .get(
    "/recipe-job/:job-id",
    async ({ params, db }) => {
      const job = await RecipeJobService.getRecipeJob(params["job-id"], db);
      if (!job) return status("Not Found");

      return job;
    },
    {
      params: z.object({
        "job-id": z.coerce.number(),
      }),
    },
  )
  .get("/recipe/:recipe-id", () => {}, {
    params: z.object({
      "recipe-id": z.coerce.number(),
    }),
  })
  .listen(6969);

console.log(`🦊 Elysia is running on ${app.server?.url}`);
