import { Innertube } from "youtubei.js";

export type InnertubeVideoInfo = Awaited<ReturnType<Innertube["getInfo"]>>;

/**
 * Currently the client would be initialized globally and shared across the functions, however
 * since the client accepts options to create sessions which could change the behaviour depending
 * upon user specific metadata, the global initialization behaviour could change
 */
let client: Innertube;

export async function init(): Promise<Innertube> {
  client = await Innertube.create();
  return client;
}

export async function getVideoInfo(videoId: string): Promise<InnertubeVideoInfo> {
  return await client.getInfo(videoId);
}

/**
 * Retrieves transcript via youtubei.js. Some Shorts have no transcript panel
 * and the client may throw InnerTubeError("Transcript panel not found"). Infact
 * the library may also throw errors in case the video was not a valid one. Library
 * errors are currently not converted to any error and are a responsibility of the
 * caller.
 *
 * TODO: Error handling, the function assumes a very happy path and needs to be
 * improved to handle the error cases, however right now I am not sure of the
 * complete flow in cases of error, so leaving it for later as I discover the
 * errors during dog fooding of the app and understanding how the UX can be
 * shaped
 */
export async function getTranscript(videoInfo: InnertubeVideoInfo): Promise<string> {
  /**
   * In case the `getTranscript` function does not work properly and older fallback implementation
   * is available: https://github.com/LuanRT/YouTube.js/issues/501
   *
   * TODO (error handling) - Innertube client raises the following error with the message
   * Class: InnerTubeError
   * Message: "Transcript panel not found. Video likely has no transcript."
   * Example video: https://www.youtube.com/shorts/HK6oezUtJho
   */
  const transcript = await videoInfo.getTranscript();

  let text = "";
  for (const segment of transcript.transcript.content?.body?.initial_segments ||
    []) {
    if (segment.snippet.text) {
      text += segment.snippet.text + " ";
    }
  }

  return text;
}
