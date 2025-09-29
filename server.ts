import { Elysia, status } from "elysia";
import { openapi } from "@elysiajs/openapi";
import * as z from "zod";
import { drizzle } from "drizzle-orm/node-postgres";
import { cosineDistance, sql } from "drizzle-orm";
import Innertube from "youtubei.js";
import * as YoutubeService from "./youtube/service";
import * as LlmService from "./llm/service";
import { RecipeParseStatus } from "./llm/schema";
import type { EmbedResult } from "ai";
import { recipe_schema } from "./db/schema";

const app = new Elysia()
  .use(
    openapi({
      mapJsonSchema: {
        zod: z.toJSONSchema,
      },
    }),
  )
  .decorate("db", drizzle(Bun.env.DATABASE_URL!))
  .decorate("innertube", await Innertube.create())
  .post(
    "/recipe",
    async ({ body, innertube, db }) => {
      const requestStart = Date.now();
      const transcriptStart = Date.now();
      const videoId = body.data;

      let transcript: undefined | string;
      try {
        transcript = await YoutubeService.getTranscript(body.data, innertube);
      } catch (err) {
        console.error("Unable to fetch transcript", {
          error: err,
          videoId,
        });

        return status(500);
      }

      if (!transcript || transcript.length === 0) {
        console.error("Empty transcript from youtube", {
          videoId,
        });

        return status(500);
      }
      console.log(
        "transcript fetch duration:",
        Date.now() - transcriptStart,
        "ms",
      );

      const parseStart = Date.now();
      const parsedRecipe = await LlmService.parseRecipe(transcript);
      console.log("recipe parse duration:", Date.now() - parseStart, "ms");
      if (parsedRecipe.status === RecipeParseStatus.FAILURE) {
        console.error("Unable to parse recipe instructions from transcript", {
          videoId,
          error: parsedRecipe.error,
          transcript,
        });

        return status(500);
      }

      const embeddingStart = Date.now();
      let embedding: EmbedResult<string>["embedding"] | undefined;
      try {
        embedding = await LlmService.generateRecipeEmbedding(parsedRecipe.data);
      } catch (err) {
        console.error("Unable to generate embeddings for recipe", {
          videoId,
          recipe: parsedRecipe.data,
          transcript,
        });

        return status(500);
      }
      console.log(
        "embedding generation duration:",
        Date.now() - embeddingStart,
        "ms",
      );

      if (!embedding) {
        console.error("Something unexpected occured. Embeddings are empty", {
          videoId,
          recipe: parsedRecipe.data,
        });

        return status(500);
      }

      const dbStart = Date.now();
      const recipe = parsedRecipe.data;
      await db.insert(recipe).values({
        video_id: videoId,
        transcription: transcript,
        name: recipe.name,
        instructions: recipe.instructions,
        tags: recipe.tags,
        ingredients: recipe.ingredients,
        embedding,
      });
      console.log("db insert duration:", Date.now() - dbStart, "ms");

      console.log(
        "total POST /recipe duration:",
        Date.now() - requestStart,
        "ms",
      );
      return parsedRecipe.data;
    },
    {
      body: z.object({
        type: z.literal("youtube-video"),
        data: z
          .url()
          .transform((url) => new URL(url))
          /**
           * For a url: https://www.youtube.com/shorts/<id>, the .pathname
           * would return the following /shorts/<id>. As a result the following
           * needs to be validated
           * 1. Length of parts after split should be 3
           * 2. The first part(0) is an empty string
           * 3. The second part(1) is "shorts"
           * 4. The third part(2) is the id
           *
           * Currently the format for youtube shorts id is not documented,
           * so rather than reverse engineering it and applying regex, this
           * function would simply check for it to be a non empty string
           */
          .refine((url) => url.hostname === "www.youtube.com", {
            error:
              "Invalid Youtube Shorts URL: host name should be www.youtube.com",
          })
          .transform((url) => url.pathname.split("/"))
          .refine((urlParts) => urlParts.length === 3, {
            error: "Invalid Youtube Shorts URL: invalid path structure",
          })
          .refine((urlParts) => urlParts[0] === "", {
            error: "Invalid Youtube Shorts URL: invalid path structure",
          })
          .refine((urlParts) => urlParts[1] === "shorts", {
            error: "Invalid Youtube Shorts URL: not a shorts URL",
          })
          .refine((urlParts) => urlParts[2]?.length !== 0, {
            error: "Invalid Youtube Shorts URL: missing video ID",
          })
          .transform((urlParts) => urlParts[2]!),
      }),
    },
  )
  .get(
    "/recipe",
    async ({ query, db }) => {
      const queryEmbedding = await LlmService.generateQueryEmbedding(query.q);
      const results = await db
        .select({
          id: recipe_schema.id,
          name: recipe_schema.name,
          tags: recipe_schema.tags,
          instructions: recipe_schema.instructions,
          ingredients: recipe_schema.ingredients,
          distance: cosineDistance(recipe_schema.embedding, queryEmbedding),
        })
        .from(recipe_schema)
        .orderBy(cosineDistance(recipe_schema.embedding, queryEmbedding))
        .limit(2);
      return results;
    },
    {
      query: z.object({
        q: z.string().min(1),
      }),
    },
  )
  .listen(6969);

console.log(`🦊 Elysia is running on ${app.server?.url}`);

import { z } from "zod";

const baseDataSchema = z
  .object({})
  .refine((data) => Object.keys(data).length > 0, {
    message: "Data must be a non-empty object",
  });

const youtubeShortsDataSchema = z
  .object({
    url: z.string().url(),
  })
  .refine(
    (data) => {
      try {
        const url = new URL(data.url);
        return (
          url.hostname === "www.youtube.com" &&
          url.pathname.split("/").length === 3 &&
          url.pathname.split("/")[1] === "shorts" &&
          (url.pathname.split("/")[2] ?? "").length > 0
        );
      } catch {
        return false;
      }
    },
    {
      message: "Invalid YouTube Shorts URL",
    },
  );

export const inputRecipeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("youtube-shorts"),
    data: youtubeShortsDataSchema,
  }),
  z.object({
    type: z.literal("online-text"),
    data: z.object({
      url: z.string().url(),
      title: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("custom-text"),
    data: z.object({
      text: z.string().min(1),
    }),
  }),
  z.object({
    type: z.literal("audio"),
    data: z.object({
      url: z.string().url(),
      transcript: z.string().optional(),
    }),
  }),
]);

export type InputRecipeSchema = z.infer<typeof inputRecipeSchema>;
