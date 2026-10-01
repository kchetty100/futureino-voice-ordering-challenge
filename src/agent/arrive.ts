import type { MachineId } from "../catalog/index";
import { itemScore, searchMenu } from "./tools";

/** The customer is asking to see a machine, not naming one product. */
export function requestedMachine(text: string): MachineId | null {
  const normalized = text
    .toLowerCase()
    .replace(/\bwhat'?s\s+next\b/g, "what snacks")
    .replace(/\bwhat\s+next\b/g, "what snacks");
  const asking = /\b(what|which|whats|what's|have|got|any|show|see|options|menu|offer|sell|want|get|open|like|add|order)\b/.test(normalized);
  const snacks = /\bsnacks?\b/.test(normalized);
  const coffee = /\b(coffees?|drinks?|boost coffee)\b/.test(normalized);
  if (snacks && !coffee && asking) return "snacks";
  if (coffee && !snacks && asking) return "coffee";
  if (/^\s*(the\s+|some\s+)?(snacks?|snacks bot)[.!?\s]*$/i.test(text)) return "snacks";
  if (/^\s*(a\s+|the\s+|some\s+)?(coffee|drinks?|boost coffee)[.!?\s]*$/i.test(text)) return "coffee";
  return null;
}

/** Which machine a first-screen utterance belongs to. Null means ask them to choose. */
export function machineForUtterance(text: string): MachineId | null {
  const asked = requestedMachine(text);
  if (asked) return asked;
  const snacks = topScore("snacks", text);
  const coffee = topScore("coffee", text);
  if (snacks >= 5 && snacks > coffee) return "snacks";
  if (coffee >= 5 && coffee > snacks) return "coffee";
  return null;
}

export function machineIntro(_machineId: MachineId): { say: string; spotlightIds: string[] } {
  return { say: "Please view the items below.", spotlightIds: [] };
}

function topScore(machineId: MachineId, text: string): number {
  const best = searchMenu(machineId, text)[0];
  return best ? itemScore(best, text) : 0;
}
