/** How long the camera must see nobody before the countdown appears. */
export const AWAY_BEFORE_COUNTDOWN_MS = 10_000;
/** Quiet time before the countdown when the camera cannot see anyone. */
export const BLIND_BEFORE_COUNTDOWN_MS = 3 * 60_000;
/** How long the on-screen countdown runs before the session ends. */
export const LEAVE_COUNTDOWN_MS = 60_000;

/**
 * Seconds to show, or null while the customer is still inside the quiet window.
 * 0 means the countdown finished and the session should end.
 */
export function leaveSecondsLeft(awayForMs: number, beforeMs = AWAY_BEFORE_COUNTDOWN_MS): number | null {
  if (awayForMs < beforeMs) return null;
  const left = LEAVE_COUNTDOWN_MS - (awayForMs - beforeMs);
  if (left <= 0) return 0;
  return Math.ceil(left / 1000);
}

export function formatLeaveClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}
