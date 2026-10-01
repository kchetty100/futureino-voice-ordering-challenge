import { aliasesFor, getItem, type MachineId, type Temperature } from "../catalog/index";
import { apply, MAX_QUANTITY, type OrderSession, type CartLine, type ReadBack } from "../order/engine";
import { machineIntro, requestedMachine } from "./arrive";
import { asksAllergens, isClearNo, isClearYes, itemScore, money, runTool, searchCatalog, wantsChange, wantsNoMore, type ToolEffect } from "./tools";

export type TurnResult = {
  session: OrderSession;
  say: string;
  spotlightIds: string[];
  readBack: ReadBack | null;
  /** Show this machine's menu. The cart stays the same. */
  switchTo: MachineId | null;
};

/** Yes, no, allergens, and a bare temperature. These never go to the model. */
export function customerGuard(session: OrderSession, text: string, now: number): TurnResult | null {
  return directReply(session, text, now);
}

/** The engine confirms. Call this only after a yes has already been decided. */
export function acceptOrder(session: OrderSession, now: number): TurnResult {
  if (session.phase === "ready_to_pay") {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, "This order is already ready to pay.", [], null);
  }
  const result = apply(session, {
    type: "confirm",
    cartVersion: session.cartVersion,
    source: "voice_yes",
    now,
  });
  if (result.ok && result.readBack) {
    return done(result.session, `Ready to pay ${money(result.readBack.totalCents)}.`, [], result.readBack);
  }
  const say =
    result.reason === "stale_cart"
      ? "That yes was for an older cart. Ask me to read the order again."
      : "I need to read the order back before a yes counts.";
  return done(result.session, say, [], null);
}

export function declineOrder(session: OrderSession, now: number): TurnResult {
  const result = apply(session, { type: "revise", now });
  return done(result.session, "Okay. What do you want to change?", [], null);
}

/** Rule replies used in tests, and whenever no model key is configured. */
export function answerWithRules(session: OrderSession, text: string, now: number): TurnResult {
  return customerGuard(session, text, now) ?? interpret(session, text, now);
}

function directReply(session: OrderSession, text: string, now: number): TurnResult | null {
  if (isClearYes(text)) return acceptOrder(session, now);

  const reviewing = session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay";
  if (reviewing && wantsNoMore(text) && !wantsChange(text)) return acceptOrder(session, now);

  if (isClearNo(text) && reviewing) {
    return declineOrder(session, now);
  }

  const edited = editCartBySpeech(session, text, now);
  if (edited) return edited;

  const destination = requestedMachine(text);
  if (destination) {
    const opening = destination !== session.machineId;
    const intro = machineIntro(destination);
    const stayed =
      opening && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")
        ? apply(session, { type: "revise", now })
        : apply(session, { type: "activity", now });
    return { ...done(stayed.session, intro.say, intro.spotlightIds, null), switchTo: destination };
  }

  if (wantsSomethingElse(text) && session.lines.length > 0 && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")) {
    const result = apply(session, { type: "revise", now });
    return done(result.session, "What else would you like?", [], null);
  }

  if (asksAllergens(text)) {
    const stayed = apply(session, { type: "activity", now });
    return done(
      stayed.session,
      "I don't have allergen information. Nothing on this machine has an ingredient list.",
      [],
      null,
    );
  }

  const missing = session.lines.filter(needsTemperature);
  const spoken = spokenTemperature(text);
  if (spoken === "many" && missing.length > 0) {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, "Say one: hot, iced, or room.", [], null);
  }
  if (spoken && spoken !== "many" && missing.length === 1) {
    const line = missing[0];
    if (!line) return null;
    const saved = runTool(session, "set_temperature", { lineId: line.lineId, temperature: spoken }, now);
    if (saved.session.lines.every((candidate) => !needsTemperature(candidate))) {
      return finishIfComplete(saved, now);
    }
    return fromEffect(saved);
  }

  return null;
}

function interpret(session: OrderSession, text: string, now: number): TurnResult {
  const normalized = text.trim().toLowerCase();
  if (/^(that'?s all|that is all|done|checkout|check out)$/.test(normalized)) {
    return fromEffect(runTool(session, "read_back", {}, now));
  }

  const joined = addJoined(session, normalized, now);
  if (joined) return joined;

  const temperature = findTemperature(normalized);
  const query = stripTemperature(normalized);
  if (/\b(light|not too heavy)\b/.test(normalized)) {
    return offerVague(session, query || "sweet", now, { light: true });
  }

  const hits = searchCatalog(query || normalized);
  if (hits.length === 0) {
    const stayed = apply(session, { type: "activity", now });
    const say =
      session.phase === "awaiting_confirmation" && !namesAMissingItem(normalized)
        ? "Add another item, or say yes to confirm."
        : "This machine doesn't carry that.";
    return done(stayed.session, say, [], null);
  }

  const ranked = hits;
  const best = ranked[0];
  const second = ranked[1];
  const bestScore = best ? itemScore(best, query || normalized) : 0;
  const secondScore = second ? itemScore(second, query || normalized) : 0;
  const precise = best && bestScore >= 5 && bestScore - secondScore >= 3;
  if (!precise || !best) {
    const stayed = apply(session, { type: "activity", now });
    const close = ranked.filter((item) => itemScore(item, query || normalized) >= bestScore - 2).slice(0, 3);
    const names = close.map((item) => item.name).join(", ");
    return done(stayed.session, `I can offer ${names}.`, close.map((item) => item.id), null);
  }

  const added = runTool(
    session,
    "add_to_cart",
    {
      productId: best.id,
      ...(temperature && best.requiresTemperature ? { temperature } : {}),
    },
    now,
  );
  return finishIfComplete(added, now);
}

/** "latte and chips" is two items. "cookies and cream" stays one product. */
function addJoined(session: OrderSession, text: string, now: number): TurnResult | null {
  const parts = text
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length < 2) return null;
  const hits = parts.map(preciseItem);
  if (hits.some((hit) => hit === null)) return null;

  let current = session;
  let last: ToolEffect | null = null;
  const ids: string[] = [];
  for (const hit of hits) {
    if (!hit) return null;
    const added = runTool(
      current,
      "add_to_cart",
      {
        productId: hit.item.id,
        ...(hit.temperature && hit.item.requiresTemperature ? { temperature: hit.temperature } : {}),
      },
      now,
    );
    if (!added.ok) return fromEffect(added);
    current = added.session;
    last = added;
    ids.push(hit.item.id);
  }
  if (!last) return null;
  const finished = finishIfComplete({ ...last, spotlightIds: ids }, now);
  const missing = finished.session.lines.filter(needsTemperature);
  if (missing.length === 0) return finished;
  const names = missing.map((line) => getItem(line.productId)?.name ?? "A drink");
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "needs" : "need";
  return { ...finished, say: `${listed} still ${verb} a temperature. Hot, iced, or room?` };
}

function preciseItem(text: string): { item: { id: string; name: string; requiresTemperature: boolean }; temperature: Temperature | null } | null {
  const temperature = findTemperature(text);
  const query = stripTemperature(text);
  const hits = searchCatalog(query || text);
  const best = hits[0];
  if (!best) return null;
  const second = hits[1];
  const bestScore = itemScore(best, query || text);
  const secondScore = second ? itemScore(second, query || text) : 0;
  if (bestScore >= 5 && bestScore - secondScore >= 3) return { item: best, temperature };
  return null;
}

function offerVague(
  session: OrderSession,
  query: string,
  now: number,
  prefs: { light?: boolean },
): TurnResult {
  let hits = searchCatalog(query);
  if (prefs.light) {
    const lighter = hits.filter((item) => item.tasteTags.includes("light") && !item.tasteTags.includes("rich"));
    hits = lighter.length > 0 ? lighter : hits.filter((item) => !item.tasteTags.includes("rich"));
  }
  const stayed = apply(session, { type: "activity", now });
  if (hits.length === 0) {
    return done(stayed.session, "This machine doesn't carry that.", [], null);
  }
  const names = hits
    .slice(0, 3)
    .map((item) => item.name)
    .join(", ");
  return done(stayed.session, `I can offer ${names}.`, hits.slice(0, 3).map((item) => item.id), null);
}

export function finishIfComplete(effect: ToolEffect, now: number): TurnResult {
  const missing = effect.session.lines.some(needsTemperature);
  if (!effect.ok || !effect.session.lines.length || missing || effect.session.phase === "abandoned") return fromEffect(effect);
  if (effect.readBack) return fromEffect(effect);
  const read = runTool(effect.session, "read_back", {}, now);
  return fromEffect({
    ...read,
    spotlightIds: effect.spotlightIds.length > 0 ? effect.spotlightIds : read.spotlightIds,
  });
}

function fromEffect(effect: ToolEffect): TurnResult {
  return {
    session: effect.session,
    say: effect.say,
    spotlightIds: effect.spotlightIds,
    readBack: effect.session.phase === "awaiting_confirmation" || effect.session.phase === "ready_to_pay" ? effect.readBack : null,
    switchTo: null,
  };
}

function namesAMissingItem(text: string): boolean {
  const ignore = new Set([
    "the", "and", "for", "you", "your", "else", "more", "anything", "something", "nothing",
    "thanks", "thank", "please", "good", "done", "all", "that", "this", "just", "only",
    "want", "dont", "not", "yes", "yeah", "no", "nope", "its", "its", "im", "okay", "ok",
  ]);
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => token.length > 3 && !ignore.has(token));
}

function needsTemperature(line: CartLine): boolean {
  return getItem(line.productId)?.requiresTemperature === true && line.temperature === undefined;
}

/** Spoken cart edits stay on the review. They do not open a menu. */
function editCartBySpeech(session: OrderSession, text: string, now: number): TurnResult | null {
  const verb = cartVerb(text);
  if (!verb || session.lines.length === 0) return null;
  const named = cartLineFor(session, text);
  const only = session.lines.length === 1 ? session.lines[0] : undefined;
  const stray = strayWords(session, text);
  const line = named ?? (only && stray.length === 0 && !pointsElsewhere(text, only) ? only : undefined);
  const spotlightIds = session.lines.map((candidate) => candidate.productId);
  if (!line) {
    const names = session.lines.map((candidate) => getItem(candidate.productId)?.name ?? "that item").join(" or ");
    const say = stray.length > 0 ? "That isn't in this order." : `Which item? ${names}.`;
    return withCart(session, say, now, spotlightIds);
  }

  const name = getItem(line.productId)?.name ?? "That item";
  if (verb === "heat") {
    const temperature = findTemperature(text);
    if (!temperature) return null;
    const item = getItem(line.productId);
    if (!item?.requiresTemperature) return withCart(session, "Snacks do not take a temperature.", now, spotlightIds);
    const saved = apply(session, { type: "set_temperature", lineId: line.lineId, temperature, now });
    if (!saved.ok) return withCart(saved.session, "Choose hot, iced, or room.", now, spotlightIds);
    return withCart(saved.session, `${name} is ${temperature}.`, now, [line.productId]);
  }
  if (verb === "more") {
    if (line.quantity >= MAX_QUANTITY) return withCart(session, `${name} is already ${MAX_QUANTITY}.`, now, [line.productId]);
    const saved = apply(session, { type: "set_quantity", lineId: line.lineId, quantity: line.quantity + 1, now });
    if (!saved.ok) return withCart(session, "I can't add another of that.", now, [line.productId]);
    return withCart(saved.session, `Added one more ${name}.`, now, [line.productId]);
  }
  if (verb === "less" && line.quantity > 1) {
    const saved = apply(session, { type: "set_quantity", lineId: line.lineId, quantity: line.quantity - 1, now });
    if (!saved.ok) return withCart(session, "I can't remove one of that.", now, [line.productId]);
    return withCart(saved.session, `Removed one ${name}.`, now, [line.productId]);
  }
  const removed = apply(session, { type: "remove_line", lineId: line.lineId, now });
  if (!removed.ok) return withCart(session, "I can't remove that.", now, spotlightIds);
  if (removed.session.lines.length === 0) return done(removed.session, `Removed ${name}. The cart is empty.`, [], null);
  return withCart(removed.session, `Removed ${name}.`, now, []);
}

function withCart(session: OrderSession, say: string, now: number, spotlightIds: string[]): TurnResult {
  if (session.lines.length === 0 || session.lines.some(needsTemperature)) return done(session, say, spotlightIds, null);
  const read = runTool(session, "read_back", {}, now);
  if (!read.readBack) return done(read.session, say, spotlightIds, null);
  const summary = read.say ? ` ${read.say}` : "";
  return { session: read.session, say: `${say}${summary}`, spotlightIds, readBack: read.readBack, switchTo: null };
}

const CART_FILLER = new Set([
  "the", "a", "an", "please", "item", "items", "one", "more", "another", "extra", "add", "remove", "delete",
  "take", "off", "out", "away", "rid", "get", "of", "it", "that", "this", "make", "change", "switch", "less",
  "fewer", "hot", "iced", "ice", "cold", "room", "yes", "but", "my", "order", "cart", "to", "just", "can", "you",
]);

function cartVerb(text: string): "remove" | "less" | "more" | "heat" | null {
  const normalized = text.toLowerCase();
  if (/\b(one less|one fewer|remove one|take one off|take one away)\b/.test(normalized)) return "less";
  if (/\b(one more|another one|add another|add one more|add one|one extra|add more)\b/.test(normalized)) return "more";
  if (/\b(remove|delete|take off|take out|take away|get rid of)\b/.test(normalized)) return "remove";
  if (findTemperature(normalized) && /\b(make|change|switch)\b/.test(normalized)) return "heat";
  return null;
}

function cartLineFor(session: OrderSession, text: string): CartLine | undefined {
  const temperature = findTemperature(text);
  const matches = session.lines.filter((line) => {
    const item = getItem(line.productId);
    return item ? itemScore(item, text) >= 5 : false;
  });
  const cooled = temperature ? matches.filter((line) => line.temperature === temperature) : matches;
  if (cooled.length === 1) return cooled[0];
  if (matches.length === 1) return matches[0];
  return undefined;
}

function strayWords(session: OrderSession, text: string): string[] {
  const known = new Set(
    session.lines.flatMap((line) => {
      const item = getItem(line.productId);
      if (!item) return [];
      return [item.name, ...aliasesFor(item.id)].join(" ").toLowerCase().split(/[^a-z0-9]+/);
    }),
  );
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !CART_FILLER.has(token) && !known.has(token));
}

function pointsElsewhere(text: string, line: CartLine): boolean {
  const hit = preciseItem(text);
  if (hit && hit.item.id !== line.productId) return true;
  const machine = requestedMachine(text);
  const item = getItem(line.productId);
  return Boolean(machine && item && item.machineId !== machine);
}

function wantsSomethingElse(text: string): boolean {
  return /\b(something else|anything else|another one|what else|add something|add another|add more)\b/.test(text.toLowerCase());
}

function done(session: OrderSession, say: string, spotlightIds: string[], readBack: ReadBack | null): TurnResult {
  return { session, say, spotlightIds, readBack, switchTo: null };
}

const TEMP_FILLER = new Set([
  "please",
  "thanks",
  "thank",
  "make",
  "want",
  "like",
  "just",
  "can",
  "could",
  "have",
  "get",
  "that",
  "this",
  "one",
  "the",
  "and",
  "for",
  "yeah",
  "yep",
  "okay",
  "drink",
  "coffee",
]);

/** A temperature, when the customer is not also naming a product. "many" means more than one was heard. */
function spokenTemperature(text: string): Temperature | "many" | null {
  const normalized = text.trim().toLowerCase().replace(/[.?!,]/g, " ");
  const temps = new Set<Temperature>();
  if (/\b(iced|ice|icy|cold)\b/.test(normalized)) temps.add("iced");
  if (/\bhot\b/.test(normalized)) temps.add("hot");
  if (/\broom\b/.test(normalized)) temps.add("room");
  if (temps.size > 1) return "many";
  if (temps.size === 0) return null;
  const leftover = normalized
    .replace(/\b(room temperature|room temp|iced|ice|icy|cold|hot|room)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !TEMP_FILLER.has(token));
  if (leftover.length > 0) return null;
  return [...temps][0] ?? null;
}

function findTemperature(text: string): Temperature | null {
  if (/\b(iced|ice|cold)\b/.test(text)) return "iced";
  if (/\bhot\b/.test(text)) return "hot";
  if (/\broom\b/.test(text)) return "room";
  return null;
}

function stripTemperature(text: string): string {
  return text.replace(/\b(hot|iced|ice|cold|room temperature|room temp|room)\b/g, " ").replace(/\s+/g, " ").trim();
}

