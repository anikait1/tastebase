import { z } from "zod";

/**
 * TODO (anikait) - Few things are currently missing, which would probably be a good addition
 * 1. Error message is a bit generic and not specific to the failing condition
 * 2. URL is object is created twice
 * 3. Forced assertion for urlParts[2]
 * 4. Missing `path` when using `ctx.addIssue`
 */
export const youtubeShortsRecipeSchema = z
  .object({
    url: z.url(),
  })
  .superRefine(({ url }, ctx) => {
    const parsed = new URL(url);
    const urlParts = parsed.pathname.split("/");

    if (
      parsed.hostname !== "www.youtube.com" ||
      urlParts.length !== 3 ||
      urlParts[1] !== "shorts" ||
      urlParts[2]!.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Invalid YouTube shorts URL, only the 'https://www.youtube.com/shorts/{id}' is accepted",
      });
    }
  })
  .transform(({ url }) => {
    const parsed = new URL(url);
    const urlParts = parsed.pathname.split("/");
    return {
      url,
      id: urlParts[2]!,
    };
  });

export const inputRecipeSchema = z.object({
  type: z.literal("youtube-shorts"),
  data: z.record(z.string(), z.unknown()),
});

export type InputRecipeSchema = z.infer<typeof inputRecipeSchema>;
export type YoutubeShortsRecipeSchema = z.infer<
  typeof youtubeShortsRecipeSchema
>;
