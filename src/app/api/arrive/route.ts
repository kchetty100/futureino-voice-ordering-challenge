import { speechPrompt } from "../../../catalog/index";
import { detectLanguage, languageFromSttLabel, t } from "../../../i18n";
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
  let sttLanguageLabel: string | null = null;
  let spoken = contentType.includes("application/json") ? ("text" as const) : ("voice" as const);
  let wake = false;
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { text?: string };
    text = body.text?.trim() ?? "";
  } else {
    if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Speech is not configured." }, { status: 503 });
    const form = await request.formData();
    wake = form.get("intent") === "wake";
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "No audio." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
    try {
      // First utterance: do not force English; let STT auto-detect.
      const heard = await transcribe(audio, PROMPT, clipSeconds(form), null);
      text = heard.text === PROMPT ? "" : heard.text;
      usage = heard.usage;
      sttLanguageLabel = heard.detectedLanguage;
    } catch (error) {
      console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "Speech didn't come through." }, { status: 502 });
    }
  }

  if (wake) {
    return Response.json({
      session: null,
      readBack: null,
      say: text ? null : t("en", "didnt_catch"),
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui: null,
      transcript: text,
      audioBase64: null,
    });
  }

  if (!text) {
    const now = Date.now();
    const logId = beginLobby(now);
    const lang = languageFromSttLabel(sttLanguageLabel) ?? "en";
    const miss = t(lang, "didnt_catch");
    recordTurn(logId, { at: now, source: spoken, customer: null, say: miss });
    if (usage) noteUsageFor(logId, usage);
    await saveRecord(logId);
    return Response.json({
      session: null,
      readBack: null,
      say: miss,
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui: null,
      transcript: "",
      audioBase64: null,
    });
  }

  const arrived = await arriveSession(text, Date.now(), spoken, sttLanguageLabel);
  if (usage) {
    noteUsageFor(arrived.logId, usage);
    await saveRecord(arrived.logId);
  }
  let audioBase64: string | null = null;
  const line = lineToSpeak(arrived.say);
  if (line && process.env.OPENAI_API_KEY) {
    try {
      const speakLang =
        (arrived.session && arrived.session.preferredLanguage) ||
        languageFromSttLabel(sttLanguageLabel) ||
        detectLanguage(text) ||
        "en";
      const playback = await synthesize(line, speakLang);
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
