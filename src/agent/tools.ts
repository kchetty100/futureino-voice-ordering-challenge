import {
  aliasesFor,
  boundMachineId,
  CATALOG,
  getItem,
  isMachineBound,
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
import { clearNoCue, clearYesCue, langOf, noMoreCue, t, tempLabel, type AppLanguage } from "../i18n";

export const AGENT_TOOLS = ["search_menu", "add_to_cart", "set_temperature", "remove_line", "read_back"] as const;
export type AgentToolName = (typeof AGENT_TOOLS)[number];

export type ToolEffect = {
  session: OrderSession;
  say: string;
  spotlightIds: string[];
  readBack: ReadBack | null;
  ok: boolean;
};

function reasonSay(session: OrderSession, reason: RejectReason): string {
  return t(langOf(session), reason);
}

export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** "Latte for $3.75, Mocha for $4.00 or Spiced Chai for $3.75". Product names stay English. */
export function pricedList(items: readonly CatalogItem[], language: AppLanguage): string {
  const parts = items.map((item) => t(language, "price_for", { name: item.name, price: money(item.priceCents) }));
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} ${t(language, "list_or")} ${parts[parts.length - 1]}`;
}

/**
 * Menu search for named products.
 * Bound unit (NEXT_PUBLIC_MACHINE_ID = coffee|snacks): only that catalog.
 * Unset/empty demo: both catalogs so a laptop can add by name across machines.
 */
export function searchCatalog(query: string, machineId?: MachineId): CatalogItem[] {
  const bound = boundMachineId();
  if (bound) {
    return searchMenu(machineId ?? bound, query);
  }
  const seen = new Set<string>();
  return [...searchMenu("coffee", query), ...searchMenu("snacks", query)]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => itemScore(b, query) - itemScore(a, query) || a.name.localeCompare(b.name));
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
    return effect(stayed, t(langOf(session), "only_menu_tools"), [], false);
  }
  if (name === "search_menu") {
    const stayed = apply(session, { type: "activity", now });
    const hits = searchCatalog(String(args.query ?? ""), session.machineId);
    const say =
      hits.length === 0
        ? t(langOf(session), "not_carried")
        : t(langOf(session), "can_offer", { names: pricedList(hits.slice(0, 3), langOf(session)) });
    return effect(stayed, say, hits.map((item) => item.id), hits.length > 0);
  }
  if (name === "add_to_cart") {
    const temperature = isTemperature(args.temperature) ? args.temperature : undefined;
    const quantity = typeof args.quantity === "number" ? args.quantity : undefined;
    const productId = String(args.productId ?? "");
    const item = getItem(productId);
    // Bound unit: refuse a named item from the other catalog. Soft not_carried; cart unchanged.
    if (isMachineBound() && item && item.machineId !== session.machineId) {
      const stayed = apply(session, { type: "activity", now });
      return effect(stayed, t(langOf(session), "not_carried"), [], false);
    }
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
      return effect(stayed, t(langOf(session), "choose_temp"), [], false);
    }
    const result = apply(session, {
      type: "set_temperature",
      lineId: String(args.lineId ?? ""),
      temperature,
      now,
    });
    return effect(result, result.ok ? sayForTemperature(result.session, String(args.lineId)) : reasonSay(result.session, result.reason ?? "unknown_line"), []);
  }
  if (name === "remove_line") {
    const result = apply(session, { type: "remove_line", lineId: String(args.lineId ?? ""), now });
    return effect(result, result.ok ? t(langOf(result.session), "removed") : reasonSay(result.session, result.reason ?? "unknown_line"), []);
  }
  const result = apply(session, { type: "read_back", now });
  return effect(result, result.ok && result.readBack ? sayForReadBack(result.session, result.readBack) : reasonSay(result.session, result.reason ?? "incomplete"), []);
}

/**
 * Clear yes / confirm. Pass reviewing=true only on Review / ready_to_pay —
 * multi-word confirm STT aliases must not steal Menu add turns.
 */
export function isClearYes(text: string, reviewing = false): boolean {
  const normalized = spokenWords(text);
  if (YES.has(normalized) || clearYesCue(normalized)) return true;
  if (changesOrder(normalized)) return false;
  const content = normalized.split(" ").filter((token) => token && !YES_FILLER.has(token));
  if (content.length > 0 && content.every((token) => YES_WORD.has(token))) return true;
  // One-token sound-alike: "confrirm" — safe globally.
  if (content.length === 1 && (sameSound(content[0] ?? "", "confirm") || sameSound(content[0] ?? "", "proceed"))) {
    return true;
  }
  // Multi-word STT garbles ("couldnt farm") — Review only, explicit aliases (no loose subsequence).
  if (reviewing && CONFIRM_STT_ALIASES.has(normalized)) return true;
  return false;
}

/** A reply that accepts the order and also changes it is not a confirmation. */
export function changesOrder(text: string): boolean {
  return /\b(but|except|change|make|add|remove|removed|delete|deleted|without|instead|another|also|too|hot|iced|ice|cold|room|no|not|wrong|incorrect)\b/.test(spokenWords(text))
    || /\btake\b.*\b(off|out|away)\b/.test(spokenWords(text))
    || /\bget\b.*\brid\b/.test(spokenWords(text));
}

export function isClearNo(text: string): boolean {
  const normalized = spokenWords(text);
  return ["no", "nope", "nah", "change it", "change", "no thanks", "no thank you"].includes(normalized) || clearNoCue(normalized);
}

/** They do not want another item. "No, make it hot" is a change, not this. */
export function wantsNoMore(text: string): boolean {
  const normalized = spokenWords(text);
  if (NO_MORE.has(normalized) || noMoreCue(normalized)) return true;
  return /^(no|nope|nah|nothing)( thanks| thank you| more| else)?$/.test(normalized) || /^(done|checkout|check out)$/.test(normalized);
}

/** The reply asks to change the order, not merely to stop adding. */
export function wantsChange(text: string): boolean {
  return /\b(change|make|add|remove|removed|delete|deleted|but|instead|hot|iced|ice|cold|room|not|wrong|incorrect)\b/.test(spokenWords(text))
    || /\btake\b.*\b(off|out|away)\b/.test(spokenWords(text))
    || /\bget\b.*\brid\b/.test(spokenWords(text));
}

/** They are rejecting the order as read, without naming a replacement. */
export function wantsCorrection(text: string): boolean {
  const normalized = spokenWords(text);
  if (/^(wait|hold on|not quite)$/.test(normalized)) return true;
  return /\b(wrong|incorrect|mistake)\b/.test(normalized) || /\bnot right\b/.test(normalized) || /\bhold on\b/.test(normalized);
}

function spokenWords(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALLERGEN_INGREDIENT =
  /\b(nut|nuts|dairy|gluten|milk|peanut|peanuts|lactose|soy|egg|eggs|wheat|sesame|shellfish|nueces|cacahuete|lait|glúten|leche|lactosa)\b/i;

export function asksAllergens(text: string): boolean {
  const normalized = text.toLowerCase();
  if (
    /\b(allergen|allergens|allergy|allergic|al[eé]rgeno[s]?|allerg[eè]ne[s]?|אלרגן|allergeen)\b/i.test(normalized) ||
    /אלרג/.test(text)
  ) {
    return true;
  }
  if (!ALLERGEN_INGREDIENT.test(normalized)) return false;
  return /\b(contain|contains|containing|safe|free|contiene|contient|bevat|tiene|libre|sans|vry|have|has|got)\b/i.test(normalized);
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
  if (!result.ok) return reasonSay(result.session, result.reason ?? "unknown_product");
  const line =
    result.session.lines.find((candidate) => candidate.productId === productId && candidate.temperature === temperature) ??
    result.session.lines[result.session.lines.length - 1];
  const item = line ? getItem(line.productId) : undefined;
  const name = item?.name ?? t(langOf(result.session), "that_item");
  if (result.missing.length > 0) {
    const pendingNames = result.missing.map((field) => getItem(field.productId)?.name ?? name);
    const listed = pendingNames.length === 1 ? pendingNames[0] : `${pendingNames.slice(0, -1).join(", ")} and ${pendingNames[pendingNames.length - 1]}`;
    const addedNeedsTemp = result.missing.length === 1 && result.missing[0]?.productId === productId;
    if (addedNeedsTemp) return t(langOf(result.session), "added_need_temp", { name: listed });
    const addedLine = t(langOf(result.session), "added", { temp: tempLabel(line?.temperature), name });
    const key = pendingNames.length === 1 ? "needs_temp" : "need_temps";
    return `${addedLine} ${t(langOf(result.session), key, { name: listed, names: listed })}`;
  }
  return t(langOf(result.session), "added", { temp: tempLabel(line?.temperature), name });
}

function sayForTemperature(session: OrderSession, lineId: string): string {
  const line = session.lines.find((candidate) => candidate.lineId === lineId) ?? session.lines[0];
  const item = line ? getItem(line.productId) : undefined;
  if (!line?.temperature || !item) return t(langOf(session), "temp_saved");
  return `${item.name}, ${line.temperature}.`;
}

export function sayForReadBack(session: OrderSession, readBack: ReadBack): string {
  const lines = readBack.lines
    .map((line) => {
      const temp = line.temperature ? `${line.temperature} ` : "";
      const qty = line.quantity > 1 ? ` times ${line.quantity}` : "";
      return `${temp}${line.name}${qty}`;
    })
    .join(", ");
  return t(langOf(session), "read_back", { lines, total: money(readBack.totalCents) });
}

function scoreItem(item: CatalogItem, query: string, tokens: string[]): number {
  const name = item.name.toLowerCase();
  const words = name.split(/\s+/);
  const phrase = tokens.join(" ");
  let score = 0;
  if (phrase && (name === phrase || sameSound(phrase, name))) score += 10;
  for (const token of tokens) {
    if (words.includes(token) || sameSound(token, name) || words.some((word) => sameSound(token, word))) score += 3;
    else if (name.includes(token)) score += 1;
    if (item.tasteTags.includes(token as TasteTag)) score += 1;
  }
  if (query.trim().toLowerCase() === name) score += 2;
  return Math.max(score, itemScore(item, query));
}

/**
 * The product was the thing they said.
 * Every content word has to belong to that name, so a latte mentioned in passing does not count.
 */
export function productMentioned(text: string, productId: string): boolean {
  const item = getItem(productId);
  if (!item) return false;
  const tokens = queryTokens(text).filter((token) => token.length >= 4 && !ORDER_FILLER.has(token));
  if (tokens.length === 0 || tokens.length > 6) return false;
  return tokens.every((token) => mentionsWord(token, nameWords(item)));
}

/** True when any content word is a menu name, even inside a longer sentence. */
export function namesAProduct(text: string): boolean {
  const tokens = queryTokens(text).filter((token) => token.length >= 4);
  return tokens.some((token) => CATALOG.some((item) => mentionsWord(token, nameWords(item))));
}

function nameWords(item: CatalogItem): Set<string> {
  return new Set(
    [item.name, ...aliasesFor(item.id)]
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4),
  );
}

const ORDER_FILLER = new Set(["another", "more", "extra", "couple", "pair", "second", "third", "again", "also"]);

function mentionsWord(token: string, words: Set<string>): boolean {
  if (words.has(token) || [...words].some((word) => sameSound(token, word))) return true;
  if (token.endsWith("s") && token.length > 4) return mentionsWord(token.slice(0, -1), words);
  return false;
}

/** Name, customer phrase, or a taste word. A taste word stays below a precise name. */
export function itemScore(item: CatalogItem, query: string): number {
  const phrases = [item.name, ...aliasesFor(item.id)];
  const named = Math.max(...phrases.map((phrase) => nameScore(phrase, query)));
  const tokens = queryTokens(query);
  const taste =
    tokens.length > 0 && tokens.every((token) => item.tasteTags.includes(token as TasteTag)) ? 4 : 0;
  return Math.max(named, taste);
}

/** How well a product name matches the words the customer actually used. */
export function nameScore(name: string, query: string): number {
  const tokens = queryTokens(query);
  const normalized = name.toLowerCase();
  const words = normalized.split(/\s+/);
  let score = 0;
  const heard = tokens.join(" ");
  const titled = words.filter((word) => word.length > 2 && !STOP.has(word)).join(" ");
  if (tokens.length > 0 && (heard === normalized || heard === titled || tokens.includes(normalized) || tokens.some((token) => sameSound(token, normalized)))) {
    score += 10;
  }
  for (const token of tokens) {
    if (words.includes(token) || words.some((word) => sameSound(token, word))) score += 3;
  }
  return score;
}

/** Shared consonants, so a clipped "maricano" still lines up with "americano". */
function sameSound(heard: string, name: string): boolean {
  const heardSound = consonants(heard);
  const nameSound = consonants(name);
  return heardSound.length >= 4 && heardSound === nameSound;
}

function consonants(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");
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

/** Known Whisper/STT mishears of "confirm" when reviewing the order. */
const CONFIRM_STT_ALIASES = new Set([
  "couldnt farm",
  "couldnt form",
  "could not farm",
  "could not form",
  "come firm",
  "come form",
  "corn firm",
  "con firm",
  "conf arm",
  "conf farm",
  "can firm",
  "confirmed",
]);

const YES = new Set([
  "yes",
  "yes please",
  "yeah",
  "yep",
  "yup",
  "ok",
  "okay",
  "confirm",
  "confirmed",
  "please confirm",
  "proceed",
  "proceed please",
  "go ahead",
  "go for it",
  "do it",
  "send it",
  "sounds good",
  "sounds great",
  "that works",
  "thats fine",
  "that is fine",
  "thats right",
  "that is right",
  "thats correct",
  "that is correct",
  "correct",
  "perfect",
  "absolutely",
  "for sure",
  "sure",
  "sure thing",
  "why not",
  "alright",
  "fine by me",
  "works for me",
  "deal",
  "sold",
  "im in",
  "that will do",
  "lets do it",
  "lets go",
  "good to go",
  "place the order",
  "place my order",
  "ill take it",
  "i will take it",
  "im ready",
  "i am ready",
  "ring it up",
  "uh huh",
  "mm hmm",
  "mhm",
  "looks good",
  "looks great",
  "that looks good",
  "approved",
  "yessir",
  "yes sir",
  "you bet",
  "right on",
  "affirmative",
]);

const YES_WORD = new Set(["yes", "yeah", "yep", "yup", "ok", "okay", "confirm", "confirmed", "proceed", "correct", "sure", "perfect", "absolutely", "huh", "mhm", "hmm", "mm"]);

const NO_MORE = new Set([
  "no",
  "nope",
  "nah",
  "no thanks",
  "no thank you",
  "nothing",
  "nothing else",
  "no more",
  "thats it",
  "thats all",
  "that is all",
  "that is it",
  "im good",
  "im done",
  "all good",
  "all set",
  "just that",
  "only that",
  "thats everything",
  "im all set",
  "no i dont",
  "i dont",
  "i dont want anything else",
  "i dont want anything",
  "i am done",
  "i am good",
  "i am all set",
  "done",
  "checkout",
  "check out",
  "lets checkout",
  "lets check out",
  "ready to pay",
  "thats enough",
  "that is enough",
  "nothing more",
]);

const YES_FILLER = new Set([
  "please",
  "thanks",
  "thank",
  "you",
  "that",
  "thats",
  "is",
  "right",
  "i",
  "do",
  "it",
  "sounds",
  "good",
  "go",
  "ahead",
  "uh",
  "um",
]);
