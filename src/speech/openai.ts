import { estimateSpeech, transcribeUsage, type ModelUsage } from "../operator/cost";
import type { AppLanguage } from "../i18n";
import { sttLanguageCode } from "../i18n";
import { lineToSpeak } from "./line";

const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const SPEAK_MODEL = "gpt-4o-mini-tts";

function key(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("No speech key.");
  return value;
}

export type TranscribeResult = {
  text: string;
  usage: ModelUsage;
  /** Spoken-language label when the transcript payload includes one. */
  detectedLanguage: string | null;
};

/**
 * Transcribe customer audio.
 * When `language` is set, Whisper is biased to that language.
 * When omitted, the model may auto-detect (no hard English lock).
 */
export async function transcribe(
  file: File,
  prompt?: string,
  clipSeconds = 0,
  language?: AppLanguage | null,
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append("file", file, file.name || "talk.webm");
  form.append("model", TRANSCRIBE_MODEL);
  // gpt-4o-mini-transcribe accepts json only. verbose_json is a 400.
  form.append("response_format", "json");
  if (language) form.append("language", sttLanguageCode(language));
  if (prompt) form.append("prompt", prompt);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    console.error("Transcription failed.", response.status, detail);
    throw new Error(`Transcription failed (${response.status}).`);
  }
  const payload = (await response.json()) as {
    text?: string;
    language?: string;
    usage?: { seconds?: number; input_tokens?: number; output_tokens?: number };
  };
  return {
    text: payload.text?.trim() ?? "",
    usage: transcribeUsage(payload, clipSeconds),
    detectedLanguage: payload.language?.trim() || null,
  };
}

/** Speak the screen line. Returns mp3 bytes and an estimated cost. */
export async function synthesize(
  say: string | null | undefined,
  language?: AppLanguage | null,
): Promise<{ bytes: Uint8Array; usage: ModelUsage } | null> {
  const input = lineToSpeak(say);
  if (!input) return null;
  const body: Record<string, unknown> = {
    model: SPEAK_MODEL,
    voice: "alloy",
    input,
    response_format: "mp3",
  };
  // gpt-4o-mini-tts follows the script language; a short instruction helps non-English.
  if (language && language !== "en") {
    body.instructions = `Speak naturally in the language of the script (${language}).`;
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Speech playback failed (${response.status}).`);
  return { bytes: new Uint8Array(await response.arrayBuffer()), usage: estimateSpeech(input) };
}
