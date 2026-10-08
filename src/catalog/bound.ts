import type { MachineId } from "./types";

/**
 * Production unit bind: only when NEXT_PUBLIC_MACHINE_ID is exactly coffee or snacks.
 * Unset/empty keeps the demo Attract picker and cross-catalog named adds.
 */
export function boundMachineId(): MachineId | null {
  const raw = process.env.NEXT_PUBLIC_MACHINE_ID?.trim().toLowerCase();
  if (raw === "coffee" || raw === "snacks") return raw;
  return null;
}

/** True when this process is a one-machine production unit. */
export function isMachineBound(): boolean {
  return boundMachineId() != null;
}
