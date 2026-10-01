import {
  getItem,
  itemsForMachine,
  type CatalogItem,
  type MachineId,
  type TasteTag,
  type Temperature,
} from "../catalog/index";
import {
  apply,
  type ApplyResult,
  type OrderSession,
  type ReadBack,
  type RejectReason,
} from "../order/engine";

export const AGENT_TOOLS = ["search_menu", "add_to_cart", "set_temperature", "remove_line", "read_back"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

export type ToolEffect = {
  session: OrderSession;
  say: string;
  spotlightIds: string[];
  readBack: ReadBack | null;
  ok: boolean;
};

const REASONS: Record<RejectReason, string> = {
  session_abandoned: "This order was cleared.",
  unknown_product: "That item is not on this machine.",
  wrong_machine: "That item is not on this machine.",
  invalid_quantity: "I can add between 1 and 9.",
  invalid_temperature: "Choose hot, iced, or room.",
  temperature_not_allowed: "Snacks do not take a temperature.",
  unknown_line: "That line is no longer in the cart.",
  cart_empty: "There is nothing in the cart yet.",
  incomplete: "Choose hot, iced, or room before I can confirm.",
  not_awaiting_confirmation: "I need to read the order back before a yes counts.",
  stale_cart: "That order changed. Ask me to read it again.",
};

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function searchMenu(machineId: MachineId, query: string): CatalogItem[] {
  const tokens = queryTokens(query);
  const ranked = itemsForMachine(machineId)
    .map((item) => ({ item, score: scoreItem(item, query, tokens) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return ranked.slice(0, 8).map((row) => row.item);
}

export function runTool(
  session: OrderSession,
  name: string,
  args: Record<string, unknown>,
  now: number,
): ToolEffect {
  if (!isAgentTool(name)) {
    const stayed = apply(session, { type: "activity", now });
    return effect(stayed, "I can only search this machine, add a menu item, or read the order back.", [], false);
  }
  if (name === "search_menu") {
    const stayed = apply(session, { type: "activity", now });
    const hits = searchMenu(session.machineId, String(args.query ?? ""));
    const say =
      hits.length === 0
        ? "This machine doesn't carry that."
        : `I can offer ${hits
            .slice(0, 3)
            .map((item) => item.name)
            .join(", ")}.`;
    return effect(stayed, say, hits.map((item) => item.id), hits.length > 0);
  }
  if (name === "add_to_cart") {
    const temperature = isTemperature(args.temperature) ? args.temperature : undefined;
    const quantity = typeof args.quantity === "number" ? args.quantity : undefined;
    const productId = String(args.productId ?? "");
    const result = apply(session, {
      type: "add",
      productId,
      now,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(temperature ? { temperature } : {}),
    });
    return effect(result, sayForAdd(result, productId, temperature), result.ok ? [productId] : []);
  }
  if (name === "set_temperature") {
    const temperature = args.temperature;
    if (!isTemperature(temperature)) {
      const stayed = apply(session, { type: "activity", now });
      return effect(stayed, "Choose hot, iced, or room.", [], false);
    }
    const result = apply(session, {
      type: "set_temperature",
      lineId: String(args.lineId ?? ""),
      temperature,
      now,
    });
    return effect(result, result.ok ? sayForTemperature(result.session, String(args.lineId)) : REASONS[result.reason ?? "unknown_line"], []);
  }
  if (name === "remove_line") {
    const result = apply(session, { type: "remove_line", lineId: String(args.lineId ?? ""), now });
    return effect(result, result.ok ? "Removed." : REASONS[result.reason ?? "unknown_line"], []);
  }
  const result = apply(session, { type: "read_back", now });
  return effect(result, result.ok && result.readBack ? sayForReadBack(result.readBack) : REASONS[result.reason ?? "incomplete"], []);
}

export function isClearYes(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]/g, "");
  return [
    "yes",
    "yes please",
    "yeah",
    "yep",
    "yup",
    "ok",
    "okay",
    "confirm",
    "that's right",
    "that is right",
    "correct",
    "go ahead",
  ].includes(normalized);
}

export function isClearNo(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!]/g, "");
  return ["no", "nope", "nah", "change it", "change"].includes(normalized);
}

export function asksAllergens(text: string): boolean {
  const normalized = text.toLowerCase();
  if (/\b(allergen|allergens|allergy|allergic)\b/.test(normalized)) return true;
  return (
    /\b(contain|contains|safe)\b/.test(normalized) &&
    /\b(nut|nuts|dairy|gluten|milk|peanut|peanuts)\b/.test(normalized)
  );
}

function effect(result: ApplyResult, say: string, spotlightIds: string[], ok = result.ok): ToolEffect {
  const keepReadBack =
    result.readBack &&
    (result.session.phase === "awaiting_confirmation" || result.session.phase === "ready_to_pay");
  return {
    session: result.session,
    say,
    spotlightIds,
    readBack: keepReadBack ? (result.readBack ?? null) : null,
    ok,
  };
}

function sayForAdd(result: ApplyResult, productId: string, temperature?: Temperature): string {
  if (!result.ok) return REASONS[result.reason ?? "unknown_product"];
  const line =
    result.session.lines.find((candidate) => candidate.productId === productId && candidate.temperature === temperature) ??
    result.session.lines[result.session.lines.length - 1];
  const item = line ? getItem(line.productId) : undefined;
  const name = item?.name ?? "That item";
  if (result.missing.length > 0) return `${name} is in the cart. Hot, iced, or room?`;
  const temp = line?.temperature ? `${line.temperature} ` : "";
  return `Added ${temp}${name}.`;
}

function sayForTemperature(session: OrderSession, lineId: string): string {
  const line = session.lines.find((candidate) => candidate.lineId === lineId) ?? session.lines[0];
  const item = line ? getItem(line.productId) : undefined;
  if (!line?.temperature || !item) return "Temperature saved.";
  return `${item.name}, ${line.temperature}.`;
}

function sayForReadBack(readBack: ReadBack): string {
  const lines = readBack.lines
    .map((line) => {
      const temp = line.temperature ? `${line.temperature} ` : "";
      const qty = line.quantity > 1 ? ` times ${line.quantity}` : "";
      return `${temp}${line.name}${qty}`;
    })
    .join(", ");
  return `That's ${lines}. Total ${money(readBack.totalCents)}. Say yes or tap Confirm.`;
}

function scoreItem(item: CatalogItem, query: string, tokens: string[]): number {
  const name = item.name.toLowerCase();
  const phrase = tokens.join(" ");
  let score = 0;
  if (phrase && name === phrase) score += 10;
  for (const token of tokens) {
    if (name.split(/\s+/).includes(token)) score += 3;
    else if (name.includes(token)) score += 1;
    if (item.tasteTags.includes(token as TasteTag)) score += 1;
  }
  if (query.trim().toLowerCase() === name) score += 2;
  return score;
}

function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOP.has(token) && !TEMP_WORDS.has(token));
}

function isAgentTool(name: string): name is AgentToolName {
  return (AGENT_TOOLS as readonly string[]).includes(name);
}

function isTemperature(value: unknown): value is Temperature {
  return value === "hot" || value === "iced" || value === "room";
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "want",
  "like",
  "something",
  "please",
  "can",
  "have",
  "get",
  "one",
  "of",
  "to",
  "for",
  "and",
  "with",
  "but",
  "not",
  "too",
  "some",
]);

const TEMP_WORDS = new Set(["hot", "iced", "ice", "cold", "room"]);
