import type { MachineId } from "../catalog/index";
import type { OperatorView, TranscriptEntry } from "./log";

const PHASES: Record<string, string> = {
  browsing: "Browsing",
  drafting: "Drafting",
  awaiting_confirmation: "Waiting for yes",
  ready_to_pay: "Ready to pay",
  abandoned: "Walked away",
  lobby: "No machine chosen",
};

export function machineName(id: MachineId | null): string {
  if (id === "coffee") return "Boost Coffee";
  if (id === "snacks") return "Snacks Bot";
  return "Opening screen";
}

export function phaseName(phase: string): string {
  return PHASES[phase] ?? phase;
}

export function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function when(ms: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(ms);
}

export function preview(session: OperatorView): string {
  const last = [...session.transcript].reverse().find((entry) => entry.customer || entry.say);
  if (!last) return "No conversation yet.";
  return last.customer || last.say || "No conversation yet.";
}

export function speaker(entry: TranscriptEntry, field: "customer" | "say"): string {
  if (field === "say") return "Machine";
  if (entry.source === "voice") return "Customer, voice";
  if (entry.source === "touch") return "Customer, touch";
  if (entry.source === "system") return "Machine";
  return "Customer, typed";
}
