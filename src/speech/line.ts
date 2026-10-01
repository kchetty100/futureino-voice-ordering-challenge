/** The only string text-to-speech may read. It is the line already on screen. */
export function lineToSpeak(say: string | null | undefined): string {
  return (say ?? "").replace(/\s+/g, " ").trim();
}
