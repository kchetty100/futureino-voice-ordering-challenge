import { speechPrompt } from "../../../catalog/index";
import { beginLobby, noteUsageFor, recordTurn, saveRecord } from "../../../operator/log";
import { arriveSession } from "../../../session/store";
import { lineToSpeak } from "../../../speech/line";
import { synthesize, transcribe } from "../../../speech/openai";

const MAX_AUDIO_BYTES = 2_000_000;
const PROMPT = speechPrompt();

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  let usage: Awaited<ReturnType<typeof transcribe>>["usage"] | null = null;
  let spoken = contentType.includes("application/json") ? ("text" as const) : ("voice" as const);
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
      const heard = await transcribe(audio, PROMPT, clipSeconds(form));
      text = heard.text === PROMPT ? "" : heard.text;
      usage = heard.usage;
    } catch (error) {
      console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "Speech didn't come through." }, { status: 502 });
    }
  }

  if (!text) {
    const now = Date.now();
    const logId = beginLobby(now);
    recordTurn(logId, { at: now, source: spoken, customer: null, say: "I didn't catch that." });
    if (usage) noteUsageFor(logId, usage);
    await saveRecord(logId);
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

  const arrived = await arriveSession(text, Date.now(), spoken);
  if (usage) {
    noteUsageFor(arrived.logId, usage);
    await saveRecord(arrived.logId);
  }
  let audioBase64: string | null = null;
  const line = lineToSpeak(arrived.say);
  if (line && process.env.OPENAI_API_KEY) {
    try {
      const playback = await synthesize(line);
      if (playback) {
        noteUsageFor(arrived.logId, playback.usage);
        await saveRecord(arrived.logId);
      }
      audioBase64 = playback ? Buffer.from(playback.bytes).toString("base64") : null;
    } catch (error) {
      console.error("Speech playback failed.", error instanceof Error ? error.message : "unknown error");
    }
  }
  const { logId: _logId, ...response } = arrived;
  return Response.json({ ...response, transcript: text, audioBase64 });
}

function clipSeconds(form: FormData): number {
  const raw = Number(form.get("seconds"));
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 30);
}
