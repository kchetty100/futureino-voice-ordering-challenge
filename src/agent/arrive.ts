import { t, type AppLanguage } from "../i18n";
import type { MachineId } from "../catalog/index";
import { itemScore, searchMenu } from "./tools";

/** The customer is asking to see a machine, not naming one product. */
export function requestedMachine(text: string): MachineId | null {
  const normalized = text
    .toLowerCase()
    .replace(/\bwhat'?s\s+next\b/g, "what snacks")
    .replace(/\bwhat\s+next\b/g, "what snacks");
  // Return / go back to a machine screen (not a product order).
  if (/\b(return|go back|back)\b/.test(normalized) && /\b(coffee|drinks?|boost)\b/.test(normalized) && !/\bsnack/.test(normalized)) {
    return "coffee";
  }
  if (/\b(return|go back|back)\b/.test(normalized) && /\bsnack/.test(normalized) && !/\b(coffee|drinks?|boost)\b/.test(normalized)) {
    return "snacks";
  }
  const asking = /\b(what|which|whats|what's|have|got|any|show|see|options|menu|offer|sell|want|get|open|like|add|order|view|display)\b/.test(normalized);
  const snacks = /\bsnacks?\b/.test(normalized);
  const coffee = /\b(coffees?|drinks?|boost coffee)\b/.test(normalized);
  if (snacks && !coffee && asking) return "snacks";
  if (coffee && !snacks && asking) return "coffee";
  if (/^\s*(the\s+|a\s+|some\s+)?(snacks?(?:\s+bot|\s+machine|\s+screen|\s+menu)?|snacks bot)[.!?\s]*$/i.test(text)) return "snacks";
  if (/^\s*(a\s+|the\s+|some\s+)?(coffee(?:\s+machine|\s+screen|\s+menu)?|drinks?|boost coffee)[.!?\s]*$/i.test(text)) return "coffee";
  return null;
}

/** Home-screen wake phrase. "Hey, Future!" counts. "Future" alone does not. */
export function isHeyFuture(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /\b(hey|hay|hi)\s+(future|futuer|fewcher|futcher)\b/.test(normalized);
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

export function machineIntro(_machineId: MachineId, language?: AppLanguage | null): { say: string; spotlightIds: string[] } {
  return { say: t(language ?? "en", "view_items"), spotlightIds: [] };
}

function topScore(machineId: MachineId, text: string): number {
  const best = searchMenu(machineId, text)[0];
  return best ? itemScore(best, text) : 0;
}
