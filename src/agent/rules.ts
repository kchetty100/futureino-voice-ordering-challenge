import { aliasesFor, CATALOG, getItem, type CatalogItem, type MachineId, type Temperature } from "../catalog/index";
import { applyLanguageCue, langOf, t, temperatureFromCue } from "../i18n";
import { apply, MAX_QUANTITY, type OrderSession, type CartLine, type ReadBack } from "../order/engine";
import { machineIntro, requestedMachine } from "./arrive";
import { parseNavIntent, type UiCommand } from "./nav";
import { foldCloseTemperatures } from "../speech/near";
import { asksAllergens, isClearNo, isClearYes, itemScore, money, namesAProduct, productMentioned, runTool, searchCatalog, wantsChange, wantsCorrection, wantsNoMore, type ToolEffect } from "./tools";

export type { UiCommand };

export type TurnResult = {
  session: OrderSession;
  say: string;
  spotlightIds: string[];
  readBack: ReadBack | null;
  /** Show this machine's menu. The cart stays the same. */
  switchTo: MachineId | null;
  /** Screen-only action for the kiosk (cart overlay, scroll). */
  ui: UiCommand | null;
};

/** Yes, no, allergens, and a bare temperature. These never go to the model. */
export function customerGuard(session: OrderSession, text: string, now: number): TurnResult | null {
  return directReply(session, text, now);
}

/** The engine confirms. Call this only after a yes has already been decided. */
export function acceptOrder(session: OrderSession, now: number): TurnResult {
  if (session.phase === "ready_to_pay") {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, t(langOf(session), "already_ready"), [], null);
  }
  const result = apply(session, {
    type: "confirm",
    cartVersion: session.cartVersion,
    source: "voice_yes",
    now,
  });
  if (result.ok && result.readBack) {
    return done(result.session, t(langOf(result.session), "ready_to_pay", { total: money(result.readBack.totalCents) }), [], result.readBack);
  }
  const say =
    result.reason === "stale_cart"
      ? t(langOf(result.session), "stale_yes")
      : t(langOf(result.session), "need_readback");
  return done(result.session, say, [], null);
}

export function declineOrder(session: OrderSession, now: number): TurnResult {
  const result = apply(session, { type: "revise", now });
  return done(result.session, t(langOf(result.session), "okay_change"), [], null);
}

/** Rule replies used in tests, and whenever no model key is configured. */
export function answerWithRules(session: OrderSession, text: string, now: number): TurnResult {
  text = foldCloseTemperatures(text);
  const { fields, ack } = applyLanguageCue(
    { preferredLanguage: session.preferredLanguage, languageSet: session.languageSet },
    text,
  );
  const localized: OrderSession = {
    ...session,
    preferredLanguage: fields.preferredLanguage,
    languageSet: fields.languageSet,
  };
  if (ack && parseLanguageOnly(text)) {
    const stayed = apply(localized, { type: "activity", now });
    return done(stayed.session, ack, [], null);
  }
  const guarded = customerGuard(localized, text, now);
  const turn = guarded ?? (mentionsOrder(text) ? interpret(localized, text, now) : roomTalk(localized, now));
  if (ack && turn.session.preferredLanguage === fields.preferredLanguage) {
    return { ...turn, say: `${ack} ${turn.say}`.trim() };
  }
  return turn;
}

/**
 * Talk aimed at the machine: an order, a menu question, a yes or no, or a cart edit.
 * A nearby conversation is none of those, so it must not change the cart.
 */
export function mentionsOrder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (parseNavIntent(trimmed)) return true;
  if (isCartEditUtterance(trimmed)) return true;
  if (isClearYes(trimmed) || isClearNo(trimmed) || wantsNoMore(trimmed) || wantsCorrection(trimmed) || wantsChange(trimmed)) return true;
  if (asksAllergens(trimmed)) return true;
  if (spokenTemperature(trimmed)) return true;
  if (requestedMachine(trimmed)) return true;
  if (parseLanguageOnly(trimmed)) return true;
  if (/\b(sweet|salty|chocolate|crunchy|chewy|crispy|nutty|fruity|creamy|spiced|mild|rich|light|heavy|snack|snacks|coffee|menu|recommend)\b/i.test(trimmed)) return true;
  if (/^(that'?s all|that is all|done|checkout|check out)$/i.test(trimmed)) return true;
  if (namesAProduct(trimmed)) return true;
  return looksLikeItemAttempt(trimmed);
}

/** A short phrase such as "a burger", which should be answered as a missing item. */
function looksLikeItemAttempt(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (/^(what|when|where|why|who|how|did|does|do|is|are|was|were|can|could)\b/.test(normalized)) return false;
  const filler = new Set(["a", "an", "the", "some", "please", "just", "um", "uh", "and", "oh", "so", "yeah", "yep", "ok"]);
  const tokens = normalized.split(/[^a-z0-9]+/).filter((token) => token.length > 2 && !filler.has(token));
  return tokens.length === 1;
}

function roomTalk(session: OrderSession, now: number): TurnResult {
  const stayed = apply(session, { type: "activity", now });
  const reviewing = session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay";
  const say = reviewing ? t(langOf(stayed.session), "add_or_confirm") : t(langOf(stayed.session), "didnt_catch");
  return done(stayed.session, say, [], null);
}

/** True when the utterance is only a language switch, not an order. */
function parseLanguageOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // "speak Spanish" / "en español" / bare language name — not "quiero un latte en español"
  return (
    /^(speak|talk|switch|change|use)\s+(to\s+)?(english|spanish|español|espanol|french|français|francais|hebrew|ivrit|afrikaans)\s*[.!]?$/i.test(
      trimmed,
    ) ||
    /^(english|spanish|español|espanol|french|français|francais|hebrew|ivrit|afrikaans|עברית)\s*[.!]?$/i.test(trimmed) ||
    /^(en español|en espanol|en français|en francais|in english|in afrikaans|בעברית)\s*[.!]?$/i.test(trimmed)
  );
}

/** True when the utterance is a spoken cart edit (remove, quantity, temperature). */
export function isCartEditUtterance(text: string): boolean {
  return cartVerb(text) !== null;
}

/** A remove or quantity sentence that named no cart line. The model may still map it. */
export function isUnresolvedCartEdit(session: OrderSession, text: string): boolean {
  if (parseNavIntent(text)?.kind === "clear_cart") return false;
  const verb = cartVerb(text);
  if (!verb || session.lines.length === 0) return false;
  if (verb === "remove" && mentionsEvery(text) && productTarget(text)) return false;
  return spokenCartLine(session, text, verb) === undefined;
}

function directReply(session: OrderSession, text: string, now: number): TurnResult | null {
  if (isClearYes(text)) return acceptOrder(session, now);

  const reviewing = session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay";
  if (reviewing && wantsNoMore(text) && !wantsChange(text)) return acceptOrder(session, now);

  if (isClearNo(text) && reviewing) {
    return declineOrder(session, now);
  }

  if (reviewing && wantsCorrection(text) && !preciseItem(text)) {
    return declineOrder(session, now);
  }

  const every = temperatureForEvery(text);
  if (every && session.lines.some(needsTemperature)) {
    return setTemperatures(
      session,
      session.lines.filter(needsTemperature).map((line) => ({ line, temperature: every })),
      now,
    );
  }

  const edited = editCartBySpeech(session, text, now);
  if (edited) return edited;

  const nav = handleNav(session, text, now);
  if (nav) return nav;

  const destination = requestedMachine(text);
  if (destination) {
    const opening = destination !== session.machineId;
    const intro = machineIntro(destination, langOf(session));
    const stayed =
      opening && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")
        ? apply(session, { type: "revise", now })
        : apply(session, { type: "activity", now });
    return { ...done(stayed.session, intro.say, intro.spotlightIds, null), switchTo: destination };
  }

  if (wantsSomethingElse(text) && session.lines.length > 0 && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")) {
    const result = apply(session, { type: "revise", now });
    return done(result.session, t(langOf(result.session), "what_else"), [], null);
  }

  if (asksAllergens(text)) {
    const stayed = apply(session, { type: "activity", now });
    return done(
      stayed.session,
      t(langOf(stayed.session), "allergens_unknown"),
      [],
      null,
    );
  }

  const temperatures = temperaturesForWaiting(session, text, now);
  if (temperatures) return temperatures;

  return null;
}

function interpret(session: OrderSession, text: string, now: number): TurnResult {
  const normalized = text.trim().toLowerCase();
  if (/^(that'?s all|that is all|done|checkout|check out)$/.test(normalized)) {
    return fromEffect(runTool(session, "read_back", {}, now));
  }

  const joined = addJoined(session, normalized, now);
  if (joined) return joined;

  const quantity = spokenCount(normalized);
  const counted = stripCount(normalized);
  const temperature = findTemperature(counted);
  const query = catalogQuery(stripTemperature(counted), quantity > 1);
  if (/\b(light|not too heavy)\b/.test(normalized)) {
    return offerVague(session, query || "sweet", now, { light: true });
  }

  const hits = searchCatalog(query || normalized);
  if (hits.length === 0) {
    const stayed = apply(session, { type: "activity", now });
    const say =
      session.phase === "awaiting_confirmation" && !namesAMissingItem(normalized)
        ? t(langOf(session), "add_or_confirm")
        : t(langOf(session), "not_carried");
    return done(stayed.session, say, [], null);
  }

  const ranked = hits;
  const best = ranked[0];
  const second = ranked[1];
  const bestScore = best ? itemScore(best, query || normalized) : 0;
  const secondScore = second ? itemScore(second, query || normalized) : 0;
  const precise = best && bestScore >= 5 && bestScore - secondScore >= 3;
  if (precise && best && !productMentioned(normalized, best.id)) return roomTalk(session, now);
  if (!precise || !best) {
    const stayed = apply(session, { type: "activity", now });
    const close = ranked.filter((item) => itemScore(item, query || normalized) >= bestScore - 2).slice(0, 3);
    const names = close.map((item) => item.name).join(", ");
    return done(stayed.session, t(langOf(session), "can_offer", { names }), close.map((item) => item.id), null);
  }

  if (quantity === 1 && sameDrinkAlreadyWaiting(session, best.id, temperature)) {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, t(langOf(stayed.session), "needs_temp", { name: best.name }), [], null);
  }

  const added = runTool(
    session,
    "add_to_cart",
    {
      productId: best.id,
      ...(quantity > 1 ? { quantity } : {}),
      ...(temperature && best.requiresTemperature ? { temperature } : {}),
    },
    now,
  );
  return finishIfComplete(added, now);
}

/** "latte and chips" is two items. "americano, mocha and cappuccino" is three. "cookies and cream" stays one product. */
function addJoined(session: OrderSession, text: string, now: number): TurnResult | null {
  const shared = peelSharedTemperature(text);
  const parts = listParts(shared.text);
  if (parts.length < 2) return null;
  const hits = parts.map(preciseItem);
  if (hits.some((hit) => hit === null)) return null;

  let current = session;
  let last: ToolEffect | null = null;
  const ids: string[] = [];
  for (const hit of hits) {
    if (!hit) return null;
    const temperature = hit.temperature ?? (hit.item.requiresTemperature ? shared.temperature : null);
    const added = runTool(
      current,
      "add_to_cart",
      {
        productId: hit.item.id,
        ...(hit.quantity > 1 ? { quantity: hit.quantity } : {}),
        ...(temperature ? { temperature } : {}),
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
  const names = missing.map((line) => getItem(line.productId)?.name ?? t(langOf(finished.session), "that_item"));
  const listed = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const key = names.length === 1 ? "needs_temp" : "need_temps";
  return { ...finished, say: t(langOf(finished.session), key, { name: listed, names: listed }) };
}

const LIST_FILLER = new Set([
  "a", "an", "the", "i", "me", "my", "want", "like", "please", "can", "get", "have", "one", "of", "to", "for", "with", "also", "just",
]);

function listParts(text: string): string[] {
  const split = text
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const merged = mergeNamedParts(split.length > 0 ? split : [text]);
  const expanded = merged.flatMap((part) => expandNamedPart(part));
  return expanded.length >= 2 ? expanded : split;
}

/** "cookies" + "cream" is one snack. A bare "and" split must not break that name. */
function mergeNamedParts(parts: string[]): string[] {
  const merged: string[] = [];
  let index = 0;
  while (index < parts.length) {
    const here = parts[index] ?? "";
    const next = parts[index + 1];
    if (next && !preciseItem(here) && preciseItem(`${here} and ${next}`)) {
      merged.push(`${here} and ${next}`);
      index += 2;
      continue;
    }
    merged.push(here);
    index += 1;
  }
  return merged;
}

/** "americano mocha" is two drinks when the words were not separated by and or a comma. */
function expandNamedPart(part: string): string[] {
  if (preciseItem(part)) return [part];
  const tokens = part
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0 && !LIST_FILLER.has(token));
  const spans: string[] = [];
  let index = 0;
  while (index < tokens.length) {
    let end = index;
    const room = Math.min(tokens.length, index + 4);
    for (let cursor = room; cursor > index; cursor -= 1) {
      if (preciseItem(tokens.slice(index, cursor).join(" "))) {
        end = cursor;
        break;
      }
    }
    if (end === index) {
      const token = tokens[index] ?? "";
      const previous = spans[spans.length - 1];
      if (previous && findTemperature(token) && !findTemperature(previous)) {
        spans[spans.length - 1] = `${previous} ${token}`;
        index += 1;
        continue;
      }
      return [part];
    }
    spans.push(tokens.slice(index, end).join(" "));
    index = end;
  }
  return spans.length > 1 ? spans : [part];
}

function preciseItem(text: string): { item: { id: string; name: string; requiresTemperature: boolean }; temperature: Temperature | null; quantity: number } | null {
  const quantity = spokenCount(text);
  const counted = stripCount(text);
  const temperature = findTemperature(counted);
  const bare = stripTemperature(counted);
  const query = catalogQuery(bare, quantity > 1);
  const looked = query || counted;
  const hits = searchCatalog(looked);
  const best = hits[0];
  const second = hits[1];
  const bestScore = best ? itemScore(best, looked) : 0;
  const secondScore = second ? itemScore(second, looked) : 0;
  if (best && bestScore >= 5 && bestScore - secondScore >= 3) return { item: best, temperature, quantity };
  if (bestScore >= 5) return null;
  const fuzzy = fuzzyItem(bare);
  if (!fuzzy) return null;
  return { item: fuzzy, temperature, quantity };
}

/** "all hot" at the end of a list applies to every drink that did not name its own temperature. */
function peelSharedTemperature(text: string): { text: string; temperature: Temperature | null } {
  const match = text.match(
    /\b(?:all|everything|every one|all of them|all of these)\s+(hot|iced|ice|cold|room(?:\s+temp(?:erature)?)?)\s*$/i,
  );
  if (!match || match.index == null) return { text, temperature: null };
  const temperature = findTemperature(match[0]);
  const stripped = text.slice(0, match.index).replace(/[,\s]+$/, "").trim();
  if (!temperature || !stripped) return { text, temperature: null };
  return { text: stripped, temperature };
}

/** A one-letter miss such as "mocas" for Mocha, when the exact name score found nothing. */
function fuzzyItem(query: string): CatalogItem | null {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !LIST_FILLER.has(token));
  if (tokens.length === 0) return null;
  const ranks: Array<{ item: CatalogItem; rank: number }> = [];
  for (const item of CATALOG) {
    const rank = fuzzyRank(tokens, item);
    if (rank == null) continue;
    ranks.push({ item, rank });
  }
  ranks.sort((a, b) => a.rank - b.rank || a.item.name.localeCompare(b.item.name));
  const best = ranks[0];
  const second = ranks[1];
  if (!best || best.rank > 1) return null;
  if (second && second.rank <= best.rank) return null;
  return best.item;
}

function fuzzyRank(tokens: string[], item: CatalogItem): number | null {
  const phrases = [item.name, ...aliasesFor(item.id)];
  let best: number | null = null;
  for (const token of tokens) {
    const stem = token.replace(/s$/i, "");
    const heard = [token, stem].filter((word, index, all) => word.length >= 4 && all.indexOf(word) === index && skeleton(word).length >= 3);
    if (heard.length === 0) continue;
    for (const phrase of phrases) {
      const phraseWords = phrase.toLowerCase().split(/\s+/).filter((word) => word.length > 0);
      const penalty = phraseWords.length > 1 ? 2 : 0;
      for (const word of phraseWords) {
        if (word.length < 4 || skeleton(word).length < 3) continue;
        const distance = Math.min(...heard.map((candidate) => editDistance(skeleton(candidate), skeleton(word))));
        const prefix = heard.some((candidate) => sharedPrefix(candidate, word) >= 3);
        if (distance > 1 || !prefix) continue;
        const rank = distance + penalty;
        if (best == null || rank < best) best = rank;
      }
    }
  }
  return best;
}

function sharedPrefix(left: string, right: string): number {
  const end = Math.min(left.length, right.length);
  let count = 0;
  while (count < end && left[count] === right[count]) count += 1;
  return count;
}

function skeleton(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/[aeiou]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function editDistance(left: string, right: string): number {
  if (Math.abs(left.length - right.length) > 1) return 2;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const next = [row];
    for (let column = 1; column <= right.length; column += 1) {
      const cost = left[row - 1] === right[column - 1] ? 0 : 1;
      next[column] = Math.min((previous[column] ?? 2) + 1, (next[column - 1] ?? 2) + 1, (previous[column - 1] ?? 2) + cost);
    }
    previous = next;
  }
  return previous[right.length] ?? 2;
}

const COUNT_WORD: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
};

/** "two lattes" is quantity 2. Two different counts in one phrase stay at 1. */
function spokenCount(text: string): number {
  const normalized = text.toLowerCase();
  const picks: Array<{ index: number; count: number }> = [];
  const couple = /\b(?:a\s+)?(?:couple|pair)(?:\s+of)?\b/.exec(normalized);
  if (couple?.index != null) picks.push({ index: couple.index, count: 2 });
  const digit = /\b([2-9])\b/.exec(normalized);
  if (digit?.index != null && digit[1]) picks.push({ index: digit.index, count: Number(digit[1]) });
  const word = /\b(two|three|four|five|six|seven|eight|nine)\b/.exec(normalized);
  if (word?.index != null && word[1]) picks.push({ index: word.index, count: COUNT_WORD[word[1]] ?? 1 });
  if (picks.length === 0) return 1;
  picks.sort((a, b) => a.index - b.index);
  const first = picks[0];
  if (!first || picks.some((pick) => pick.count !== first.count)) return 1;
  return first.count;
}

/** "two lattes" can mean Latte. A bare "chips" is not rewritten into "chip". */
function catalogQuery(text: string, counted: boolean): string {
  const trimmed = text.trim();
  if (!trimmed || !counted) return trimmed;
  const hits = searchCatalog(trimmed);
  const best = hits[0];
  if (best && itemScore(best, trimmed) >= 5) return trimmed;
  const singular = trimmed.replace(/\b([a-z]{3,})s\b/gi, "$1");
  return singular === trimmed ? trimmed : singular;
}

function stripCount(text: string): string {
  if (spokenCount(text) === 1) return text;
  return text
    .replace(/\b(?:a\s+)?(?:couple|pair)(?:\s+of)?\b/gi, " ")
    .replace(/\b(two|three|four|five|six|seven|eight|nine|[2-9])\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    return done(stayed.session, t(langOf(session), "not_carried"), [], null);
  }
  const names = hits
    .slice(0, 3)
    .map((item) => item.name)
    .join(", ");
  return done(stayed.session, t(langOf(session), "can_offer", { names }), hits.slice(0, 3).map((item) => item.id), null);
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
    ui: null,
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

/** The customer repeated the drink that is already waiting for hot, iced, or room. */
function sameDrinkAlreadyWaiting(session: OrderSession, productId: string, temperature: Temperature | null | undefined): boolean {
  if (temperature) return false;
  const missing = session.lines.filter(needsTemperature);
  return missing.length === 1 && missing[0]?.productId === productId;
}

function mentionsEvery(text: string): boolean {
  return /\b(all|every|everything)\b/.test(text.toLowerCase());
}

function productTarget(text: string): { item: { id: string; name: string }; temperature: Temperature | null } | null {
  const direct = preciseItem(text);
  if (direct) return direct;
  const singular = text.replace(/\b([a-z]{3,})s\b/gi, "$1");
  if (singular === text) return null;
  return preciseItem(singular);
}

function spokenCartLine(
  session: OrderSession,
  text: string,
  verb: "remove" | "less" | "more" | "heat",
): CartLine | undefined {
  const named = cartLineFor(session, text, {
    ignoreTemperature: verb === "heat",
    allowTempMismatch: verb === "remove" || verb === "less",
  });
  const only = session.lines.length === 1 ? session.lines[0] : undefined;
  const stray = strayWords(session, text);
  return named ?? (only && stray.length === 0 && !pointsElsewhere(text, only) ? only : undefined);
}

function removeMatching(
  session: OrderSession,
  hit: { item: { id: string; name: string }; temperature: Temperature | null },
  now: number,
): TurnResult {
  const matching = session.lines.filter((line) => {
    if (line.productId !== hit.item.id) return false;
    return !hit.temperature || line.temperature === hit.temperature;
  });
  const spotlightIds = session.lines.map((candidate) => candidate.productId);
  if (matching.length === 0) return withCart(session, t(langOf(session), "not_in_order"), now, spotlightIds);
  let current = session;
  for (const line of matching) {
    const removed = apply(current, { type: "remove_line", lineId: line.lineId, now });
    if (!removed.ok) return withCart(current, t(langOf(current), "cant_remove"), now, spotlightIds);
    current = removed.session;
  }
  const lang = langOf(current);
  const said = t(lang, "removed_name", { name: hit.item.name });
  if (current.lines.length === 0) return done(current, `${said} ${t(lang, "cart_empty")}`, [], null);
  return withCart(current, said, now, []);
}

/** Spoken cart edits stay on the review. They do not open a menu. */
function editCartBySpeech(session: OrderSession, text: string, now: number): TurnResult | null {
  if (parseNavIntent(text)?.kind === "clear_cart") return null;
  const verb = cartVerb(text);
  if (!verb || session.lines.length === 0) return null;
  if (verb === "remove" && mentionsEvery(text)) {
    const hit = productTarget(text);
    if (!hit) return null;
    return removeMatching(session, hit, now);
  }
  const line = spokenCartLine(session, text, verb);
  const spotlightIds = session.lines.map((candidate) => candidate.productId);
  if (!line) {
    const stray = strayWords(session, text);
    const names = session.lines.map((candidate) => getItem(candidate.productId)?.name ?? "that item").join(" or ");
    const say = stray.length > 0 ? t(langOf(session), "not_in_order") : t(langOf(session), "which_item", { names });
    return withCart(session, say, now, spotlightIds);
  }

  const name = getItem(line.productId)?.name ?? "That item";
  if (verb === "heat") {
    const temperature = findTemperature(text);
    if (!temperature) return null;
    const item = getItem(line.productId);
    if (!item?.requiresTemperature) return withCart(session, t(langOf(session), "temperature_not_allowed"), now, spotlightIds);
    const saved = apply(session, { type: "set_temperature", lineId: line.lineId, temperature, now });
    if (!saved.ok) return withCart(saved.session, t(langOf(saved.session), "choose_temp"), now, spotlightIds);
    return withCart(saved.session, t(langOf(saved.session), "is_temp", { name, temperature }), now, [line.productId]);
  }
  if (verb === "more") {
    const spokenTemp = findTemperature(text);
    if (spokenTemp && line.temperature !== spokenTemp) {
      const item = getItem(line.productId);
      if (item?.requiresTemperature) {
        const added = runTool(session, "add_to_cart", { productId: item.id, temperature: spokenTemp }, now);
        return finishIfComplete(added, now);
      }
    }
    if (line.quantity >= MAX_QUANTITY) return withCart(session, t(langOf(session), "already_max", { name, max: MAX_QUANTITY }), now, [line.productId]);
    const saved = apply(session, { type: "set_quantity", lineId: line.lineId, quantity: line.quantity + 1, now });
    if (!saved.ok) return withCart(session, t(langOf(session), "cant_add"), now, [line.productId]);
    return withCart(saved.session, t(langOf(saved.session), "added_one_more", { name }), now, [line.productId]);
  }
  if (verb === "less" && line.quantity > 1) {
    const saved = apply(session, { type: "set_quantity", lineId: line.lineId, quantity: line.quantity - 1, now });
    if (!saved.ok) return withCart(session, t(langOf(session), "cant_less"), now, [line.productId]);
    return withCart(saved.session, t(langOf(saved.session), "removed_one", { name }), now, [line.productId]);
  }
  const removed = apply(session, { type: "remove_line", lineId: line.lineId, now });
  if (!removed.ok) return withCart(session, t(langOf(session), "cant_remove"), now, spotlightIds);
  if (removed.session.lines.length === 0) {
    const lang = langOf(removed.session);
    return done(removed.session, `${t(lang, "removed_name", { name })} ${t(lang, "cart_empty")}`, [], null);
  }
  return withCart(removed.session, t(langOf(removed.session), "removed_name", { name }), now, []);
}

function withCart(session: OrderSession, say: string, now: number, spotlightIds: string[]): TurnResult {
  if (session.lines.length === 0 || session.lines.some(needsTemperature)) return done(session, say, spotlightIds, null);
  const read = runTool(session, "read_back", {}, now);
  if (!read.readBack) return done(read.session, say, spotlightIds, null);
  const summary = read.say ? ` ${read.say}` : "";
  return { session: read.session, say: `${say}${summary}`, spotlightIds, readBack: read.readBack, switchTo: null, ui: null };
}

const CART_FILLER = new Set([
  "the", "a", "an", "please", "item", "items", "one", "more", "another", "extra", "add", "remove", "removed",
  "removing", "delete", "deleted", "deleting", "take", "off", "out", "away", "rid", "get", "of", "it", "that",
  "this", "make", "change", "switch", "less", "fewer", "hot", "iced", "ice", "cold", "room", "yes", "but", "my",
  "order", "cart", "to", "just", "can", "you",
]);

function cartVerb(text: string): "remove" | "less" | "more" | "heat" | null {
  const normalized = text.toLowerCase();
  if (/\b(one less|one fewer|remove one|take one off|take one away)\b/.test(normalized)) return "less";
  if (/\b(one more|another one|add another|add one more|add one|one extra|add more)\b/.test(normalized)) {
    // "add one iced americano" is a new line, not a bare quantity bump on the cart.
    if (findTemperature(normalized) && preciseItem(normalized)) return null;
    return "more";
  }
  if (
    /\b(remove|removed|removing|delete|deleted|deleting)\b/.test(normalized) ||
    /\b(take\s+off|take\s+out|take\s+away|get\s+rid\s+of)\b/.test(normalized) ||
    /\btake\b.{0,40}\b(off|out|away)\b/.test(normalized) ||
    /\bget\b.{0,20}\brid\s+of\b/.test(normalized)
  ) {
    return "remove";
  }
  if (findTemperature(normalized) && /\b(make|change|switch)\b/.test(normalized)) return "heat";
  return null;
}

function cartLineFor(
  session: OrderSession,
  text: string,
  opts: { ignoreTemperature?: boolean; allowTempMismatch?: boolean } = {},
): CartLine | undefined {
  const temperature = opts.ignoreTemperature ? null : findTemperature(text);
  const matches = session.lines.filter((line) => {
    const item = getItem(line.productId);
    return item ? itemScore(item, text) >= 5 : false;
  });
  const cooled = temperature ? matches.filter((line) => line.temperature === temperature) : matches;
  if (cooled.length === 1) return cooled[0];
  // "Remove Spiced Iced Chai" still names Spiced Chai when the cart line is that drink.
  if (opts.allowTempMismatch && matches.length === 1) return matches[0];
  // Spoken temperature with no matching cart line must not fall back to another temp.
  if (temperature) return undefined;
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
  // A named product (e.g. "add another iced americano") is an add, not a vague revise.
  if (preciseItem(text)) return false;
  return /\b(something else|anything else|another one|what else|add something|add another|add more)\b/.test(text.toLowerCase());
}

function handleNav(session: OrderSession, text: string, now: number): TurnResult | null {
  const intent = parseNavIntent(text);
  if (!intent) return null;

  if (intent.kind === "clear_cart") {
    const hadItems = session.lines.length > 0;
    const result = apply(session, { type: "clear", now });
    return done(result.session, hadItems ? t(langOf(result.session), "cart_cleared") : t(langOf(result.session), "cart_empty"), [], null);
  }

  if (intent.ui === "go_back") {
    const stayed = apply(session, { type: "activity", now });
    return { ...done(stayed.session, t(langOf(stayed.session), "going_back"), [], null), ui: "go_back" };
  }

  if (intent.ui === "open_cart") {
    const stayed = apply(session, { type: "activity", now });
    if (stayed.session.lines.length === 0) {
      return { ...done(stayed.session, t(langOf(stayed.session), "cart_empty"), [], null), ui: "open_cart" };
    }
    if (stayed.session.phase === "awaiting_confirmation") {
      const read = runTool(stayed.session, "read_back", {}, now);
      return { ...done(read.session, t(langOf(read.session), "heres_cart"), [], read.readBack), ui: "open_cart" };
    }
    if (stayed.session.phase === "ready_to_pay") {
      return { ...done(stayed.session, t(langOf(stayed.session), "heres_cart"), [], null), ui: "open_cart" };
    }
    return {
      ...done(stayed.session, t(langOf(stayed.session), "heres_cart"), stayed.session.lines.map((line) => line.productId), null),
      ui: "open_cart",
    };
  }

  const stayed = apply(session, { type: "activity", now });
  const say = intent.ui === "scroll_up" ? t(langOf(stayed.session), "scroll_up") : t(langOf(stayed.session), "scroll_down");
  return { ...done(stayed.session, say, [], null), ui: intent.ui };
}

function done(session: OrderSession, say: string, spotlightIds: string[], readBack: ReadBack | null): TurnResult {
  return { session, say, spotlightIds, readBack, switchTo: null, ui: null };
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

type TempAssignment = { line: CartLine; temperature: Temperature };

/** Each drink from an "and" order can take its own temperature, or one word can move to the next drink. */
function temperaturesForWaiting(session: OrderSession, text: string, now: number): TurnResult | null {
  const missing = session.lines.filter(needsTemperature);
  if (missing.length === 0) return null;

  const parts = text
    .split(/\s*(?:,|&|\band\b|\bplus\b)\s*/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length >= 2) {
    const planned = planTemperatureParts(missing, parts);
    if (planned) return setTemperatures(session, planned, now);
  }

  const named = preciseItem(text);
  if (named?.temperature) {
    const line = missing.find((candidate) => candidate.productId === named.item.id);
    if (line) return setTemperatures(session, [{ line, temperature: named.temperature }], now);
  }

  const spoken = spokenTemperature(text);
  if (spoken === "many") {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, t(langOf(stayed.session), "say_one_temp"), [], null);
  }
  if (spoken) {
    const line = missing[0];
    if (!line) return null;
    return setTemperatures(session, [{ line, temperature: spoken }], now);
  }
  return null;
}

/** "hot for both", "cold for both", "make them both iced". One temperature for every waiting drink. */
function temperatureForEvery(text: string): Temperature | null {
  const normalized = text.trim().toLowerCase().replace(/[.?!,']/g, " ");
  if (!/\b(both|all|them|every|everything)\b/.test(normalized)) return null;
  const spoken = spokenTemperature(
    normalized.replace(
      /\b(both|all|them|every|everything|for|the|of|these|those|drinks|drink|coffees|coffee|make|please|they|are|is|too|want|like)\b/g,
      " ",
    ),
  );
  if (!spoken || spoken === "many") return null;
  return spoken;
}

function planTemperatureParts(missing: CartLine[], parts: string[]): TempAssignment[] | null {
  const bare = parts.map((part) => spokenTemperature(part));
  if (bare.length === missing.length && bare.every((temp): temp is Temperature => temp !== null && temp !== "many")) {
    return missing.map((line, index) => ({ line, temperature: bare[index] as Temperature }));
  }
  const named: TempAssignment[] = [];
  for (const part of parts) {
    const hit = preciseItem(part);
    if (!hit?.temperature) return null;
    const line = missing.find((candidate) => candidate.productId === hit.item.id && !named.some((pick) => pick.line.lineId === candidate.lineId));
    if (!line) return null;
    named.push({ line, temperature: hit.temperature });
  }
  return named.length > 0 ? named : null;
}

function setTemperatures(session: OrderSession, pairs: TempAssignment[], now: number): TurnResult {
  let current = session;
  let last: ToolEffect | null = null;
  for (const pair of pairs) {
    last = runTool(current, "set_temperature", { lineId: pair.line.lineId, temperature: pair.temperature }, now);
    if (!last.ok) return fromEffect(last);
    current = last.session;
  }
  if (!last) return done(session, t(langOf(session), "choose_temp"), [], null);
  const still = current.lines.filter(needsTemperature);
  if (still.length === 0) return finishIfComplete(last, now);
  const doneLine = pairs
    .map((pair) =>
      t(langOf(current), "is_temp", {
        name: getItem(pair.line.productId)?.name ?? t(langOf(current), "that_item"),
        temperature: pair.temperature,
      }),
    )
    .join(" ");
  const waiting = still.map((line) => getItem(line.productId)?.name ?? t(langOf(current), "that_item"));
  const listed = waiting.length === 1 ? waiting[0] : `${waiting.slice(0, -1).join(", ")} and ${waiting[waiting.length - 1]}`;
  const key = waiting.length === 1 ? "needs_temp" : "need_temps";
  return done(current, `${doneLine} ${t(langOf(current), key, { name: listed, names: listed })}`, [], null);
}

/** A temperature, when the customer is not also naming a product. "many" means more than one was heard. */
function spokenTemperature(text: string): Temperature | "many" | null {
  const cued = temperatureFromCue(text);
  if (cued === "many") return "many";
  const normalized = text.trim().toLowerCase().replace(/[.?!,]/g, " ");
  const temps = new Set<Temperature>();
  if (cued) temps.add(cued);
  if (/\b(iced|ice|icy|cold)\b/.test(normalized)) temps.add("iced");
  if (/\bhot\b/.test(normalized)) temps.add("hot");
  if (/\broom\b/.test(normalized)) temps.add("room");
  if (temps.size > 1) return "many";
  if (temps.size === 0) return null;
  const leftover = normalized
    .replace(/\b(room temperature|room temp|temperatura ambiente|température ambiante|iced|ice|icy|cold|hot|room|caliente|helado|hielo|fr[ií]o|glac[eé]|froid|חם|קרח|קר|warm|ys|koud|ambiente|ambiant|חדר|kamer)\b/gi, " ")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 2 && !TEMP_FILLER.has(token));
  if (leftover.length > 0) return null;
  return [...temps][0] ?? null;
}

function findTemperature(text: string): Temperature | null {
  const cued = temperatureFromCue(text);
  if (cued && cued !== "many") return cued;
  const normalized = text.toLowerCase();
  if (/\b(iced|ice|cold)\b/.test(normalized)) return "iced";
  if (/\bhot\b/.test(normalized)) return "hot";
  if (/\broom\b/.test(normalized)) return "room";
  return null;
}

function stripTemperature(text: string): string {
  return text
    .replace(/\b(hot|iced|ice|cold|room temperature|room temp|room|caliente|helado|hielo|fr[ií]o|glac[eé]|froid|חם|קרח|קר|warm|ys|koud|ambiente|ambiant|חדר|kamer|temperatura ambiente|température ambiante)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

