import { Innertube } from "youtubei.js";

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

export async function getTranscript(videoId: string): Promise<string> {
  const videoInfo = await client.getInfo(videoId);
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
