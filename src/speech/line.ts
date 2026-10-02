/** The only string text-to-speech may read. It is the line already on screen. */
export function lineToSpeak(say: string | null | undefined): string {
  return (say ?? "").replace(/\s+/g, " ").trim();
}

/**
 * The microphone heard the line the machine just spoke.
 * A short reply such as "yes" is kept, even when that word sits inside the line.
 */
export function isPlaybackEcho(transcript: string, spoken: string | null | undefined): boolean {
  const heard = spokenWords(transcript);
  const line = spokenWords(spoken);
  if (heard.length < 12 || line.length < 12) return false;
  return line.includes(heard) || heard.includes(line);
}

function spokenWords(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
