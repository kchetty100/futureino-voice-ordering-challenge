export type WatchStatus = "idle" | "starting" | "blocked" | "looking" | "seen" | "unavailable";

export type Presence = { present: boolean; faces: number; misses: number };

const HOLD_FRAMES = 2;
const RELEASE_FRAMES = 8;

/** A face has to hold for two frames. It has to stay gone for eight before the mic drops. */
export function nextPresence(state: Presence, seen: boolean): Presence {
  if (seen) {
    const faces = state.faces + 1;
    return { present: state.present || faces >= HOLD_FRAMES, faces, misses: 0 };
  }
  const misses = state.misses + 1;
  return { present: state.present && misses < RELEASE_FRAMES, faces: 0, misses };
}

export function watchLabel(status: WatchStatus): string {
  switch (status) {
    case "starting":
      return "Turning the camera on";
    case "blocked":
      return "Allow the camera, then stand in front";
    case "looking":
      return "Step in front";
    case "seen":
      return "I see you";
    case "unavailable":
      return "Face detection didn't load. Tap to start.";
    default:
      return "";
  }
}
