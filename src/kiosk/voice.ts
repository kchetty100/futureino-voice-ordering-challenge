/** How long a sound has to stay above the gate before it counts as a word. */
export const VOICE_HOLD_MS = 140;
/** Quiet time after that word before the clip is sent. */
export const VOICE_PAUSE_MS = 450;
export const VOICE_MAX_MS = 12_000;
export const VOICE_GIVE_UP_MS = 6_000;

/** A short "hot" is sent. A noise spike, and a long silence, are not. */
export function utteranceReady(voiceMs: number, quietForMs: number, elapsedMs: number): "send" | "drop" | "wait" {
  const held = voiceMs >= VOICE_HOLD_MS;
  if (held && (quietForMs >= VOICE_PAUSE_MS || elapsedMs >= VOICE_MAX_MS)) return "send";
  if (!held && elapsedMs >= VOICE_GIVE_UP_MS) return "drop";
  return "wait";
}
