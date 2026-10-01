import { speechPrompt } from "../../../../../catalog/index";
import { commandSession, messageSession, sessionMachine } from "../../../../../session/store";
import { lineToSpeak } from "../../../../../speech/line";
import { synthesize, transcribe } from "../../../../../speech/openai";

const MAX_AUDIO_BYTES = 2_000_000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Speech is not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No audio." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "That recording is too long." }, { status: 413 });
  }

  if (!sessionMachine(id)) return Response.json({ error: "Unknown session." }, { status: 404 });
  const prompt = speechPrompt();

  let transcript = "";
  try {
    transcript = await transcribe(audio, prompt);
    if (transcript === prompt) transcript = "";
  } catch (error) {
    console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Speech didn't come through." }, { status: 502 });
  }

  if (!transcript) {
    const quiet = await commandSession(id, { type: "activity" });
    if (!quiet) return Response.json({ error: "Unknown session." }, { status: 404 });
    return Response.json({ ...quiet, say: "I didn't catch that.", transcript: "", audioBase64: null });
  }

  const response = await messageSession(id, transcript);
  if (!response) return Response.json({ error: "Unknown session." }, { status: 404 });

  let audioBase64: string | null = null;
  const line = lineToSpeak(response.say);
  if (line) {
    try {
      const bytes = await synthesize(line);
      audioBase64 = bytes ? Buffer.from(bytes).toString("base64") : null;
    } catch (error) {
      console.error("Speech playback failed.", error instanceof Error ? error.message : "unknown error");
    }
  }

  return Response.json({ ...response, transcript, audioBase64 });
}
