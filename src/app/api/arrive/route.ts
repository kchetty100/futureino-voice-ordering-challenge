import { speechPrompt } from "../../../catalog/index";
import { arriveSession } from "../../../session/store";
import { lineToSpeak } from "../../../speech/line";
import { synthesize, transcribe } from "../../../speech/openai";

const MAX_AUDIO_BYTES = 2_000_000;
const PROMPT = speechPrompt();

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { text?: string };
    text = body.text?.trim() ?? "";
  } else {
    if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Speech is not configured." }, { status: 503 });
    const form = await request.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "No audio." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
    try {
      text = await transcribe(audio, PROMPT);
      if (text === PROMPT) text = "";
    } catch (error) {
      console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "Speech didn't come through." }, { status: 502 });
    }
  }

  if (!text) {
    return Response.json({
      session: null,
      readBack: null,
      say: "I didn't catch that.",
      notice: null,
      spotlightIds: [],
      switchTo: null,
      transcript: "",
      audioBase64: null,
    });
  }

  const response = await arriveSession(text);
  let audioBase64: string | null = null;
  const line = lineToSpeak(response.say);
  if (line && process.env.OPENAI_API_KEY) {
    try {
      const bytes = await synthesize(line);
      audioBase64 = bytes ? Buffer.from(bytes).toString("base64") : null;
    } catch (error) {
      console.error("Speech playback failed.", error instanceof Error ? error.message : "unknown error");
    }
  }
  return Response.json({ ...response, transcript: text, audioBase64 });
}
