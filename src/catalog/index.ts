import { ALIASES } from "./aliases";
import { COFFEE_ITEMS } from "./coffee";
import { SNACK_ITEMS } from "./snacks";
import { MACHINES, type CatalogItem, type MachineId } from "./types";

export { COFFEE_ITEMS } from "./coffee";
export { SNACK_ITEMS } from "./snacks";
export {
  MACHINES,
  TASTE_TAGS,
  TEMPERATURES,
  type AllergenStatus,
  type CatalogItem,
  type MachineId,
  type NameBasis,
  type TasteTag,
  type Temperature,
} from "./types";

export const CATALOG: readonly CatalogItem[] = [...COFFEE_ITEMS, ...SNACK_ITEMS];

const byId = new Map<string, CatalogItem>();

for (const item of CATALOG) {
  if (byId.has(item.id)) {
    throw new Error(`Duplicate catalog id: ${item.id}`);
  }
  if (item.allergens !== "unknown") {
    throw new Error(`Allergens must stay unknown until an ingredient list exists: ${item.id}`);
  }
  if (!item.imagePath.endsWith(`/${item.id}.webp`)) {
    throw new Error(`Image path does not match id: ${item.id}`);
  }
  if (item.priceCents <= 0 || !Number.isInteger(item.priceCents)) {
    throw new Error(`Price must be a positive whole number of cents: ${item.id}`);
  }

  const folder = item.machineId === "coffee" ? "images/coffee/" : "images/snacks/";
  if (!item.imagePath.startsWith(folder)) {
    throw new Error(`Item is filed under the wrong machine: ${item.id}`);
  }
  if (item.machineId === "coffee" && !item.requiresTemperature) {
    throw new Error(`Every Boost Coffee drink needs a temperature: ${item.id}`);
  }
  if (item.machineId === "snacks" && item.requiresTemperature) {
    throw new Error(`Snacks Bot items do not take a temperature: ${item.id}`);
  }
  if (item.nameBasis === "contents-hidden" && item.tasteTags.length > 0) {
    throw new Error(`Hidden contents cannot carry taste tags: ${item.id}`);
  }

  byId.set(item.id, item);
}

for (const id of Object.keys(ALIASES)) {
  if (!byId.has(id)) throw new Error(`Alias for an item that is not on the menu: ${id}`);
}

export function getItem(id: string): CatalogItem | undefined {
  return byId.get(id);
}

export function itemsForMachine(machineId: MachineId): readonly CatalogItem[] {
  return CATALOG.filter((item) => item.machineId === machineId);
}

export function machineName(machineId: MachineId): string {
  return MACHINES[machineId].name;
}

export function aliasesFor(id: string): readonly string[] {
  return ALIASES[id] ?? [];
}

/** Names and customer phrases, for the transcriber. Both machines, every turn. */
export function speechPrompt(): string {
  const parts = CATALOG.map((item) => {
    const extra = aliasesFor(item.id);
    return extra.length > 0 ? `${item.name} (${extra.join(", ")})` : item.name;
  });
  return `Futureino menu words. ${parts.join("; ")}. Snacks Bot. Boost Coffee. Hey Future.`;
}

/** A quiet clip often comes back as the opening of the transcriber hint. That is not an order. */
export function isPromptEcho(text: string, prompt = speechPrompt()): boolean {
  const heard = promptWords(text);
  const guide = promptWords(prompt);
  if (!heard || !guide) return false;
  return guide.startsWith(heard) || heard.startsWith(guide);
}

function promptWords(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
