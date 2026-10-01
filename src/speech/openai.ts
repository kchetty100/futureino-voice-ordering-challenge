import { lineToSpeak } from "./line";

const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const SPEAK_MODEL = "gpt-4o-mini-tts";

function key(): string {
  const value = process.env.OPENAI_API_KEY;
  if (!value) throw new Error("No speech key.");
  return value;
}

export async function transcribe(file: File, prompt?: string): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name || "talk.webm");
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "en");
  if (prompt) form.append("prompt", prompt);
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key()}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Transcription failed (${response.status}).`);
  const payload = (await response.json()) as { text?: string };
  return payload.text?.trim() ?? "";
}

/** Speak the screen line. Returns mp3 bytes. */
export async function synthesize(say: string | null | undefined): Promise<Uint8Array | null> {
  const input = lineToSpeak(say);
  if (!input) return null;
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SPEAK_MODEL,
      voice: "alloy",
      input,
      response_format: "mp3",
    }),
  });
  if (!response.ok) throw new Error(`Speech playback failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}
