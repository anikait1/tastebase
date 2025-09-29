import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import * as z from "zod";
import { inputRecipeSchema } from "./recipe/schema";

const app = new Elysia()
  .use(
    openapi({
      mapJsonSchema: {
        zod: z.toJSONSchema,
      },
    }),
  )
  .post("/recipe", () => {}, {
    body: inputRecipeSchema,
  })
  .get("/recipe", () => {}, {
    query: z.object({
      q: z.string().min(1),
    }),
  })
  .get("/recipe-job/:job-id", () => {}, {
    params: z.object({
      "job-id": z.coerce.number(),
    }),
  })
  .get("/recipe/:recipe-id", () => {}, {
    params: z.object({
      "recipe-id": z.coerce.number(),
    }),
  })
  .listen(6969);

console.log(`🦊 Elysia is running on ${app.server?.url}`);
