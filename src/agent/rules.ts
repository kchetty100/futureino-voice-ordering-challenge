import type { Temperature } from "../catalog/index";
import { apply, type OrderSession, type ReadBack } from "../order/engine";
import { asksAllergens, isClearNo, isClearYes, money, runTool, searchMenu, type ToolEffect } from "./tools";

export type TurnResult = {
  session: OrderSession;
  say: string;
  spotlightIds: string[];
  readBack: ReadBack | null;
};

/** Yes, no, allergens, and a bare temperature. These never go to the model. */
export function customerGuard(session: OrderSession, text: string, now: number): TurnResult | null {
  return directReply(session, text, now);
}

/** Rule replies used in tests, and whenever no model key is configured. */
export function answerWithRules(session: OrderSession, text: string, now: number): TurnResult {
  return customerGuard(session, text, now) ?? interpret(session, text, now);
}

function directReply(session: OrderSession, text: string, now: number): TurnResult | null {
  if (isClearYes(text)) {
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

  if (isClearNo(text) && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")) {
    const result = apply(session, { type: "revise", now });
    return done(result.session, "Okay. What do you want to change?", [], null);
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

  const onlyTemp = temperatureOnly(text);
  const missing = session.lines.filter((line) => {
    const needs = session.machineId === "coffee";
    return needs && line.temperature === undefined;
  });
  if (onlyTemp && missing.length === 1) {
    const line = missing[0];
    if (!line) return null;
    const saved = runTool(session, "set_temperature", { lineId: line.lineId, temperature: onlyTemp }, now);
    if (saved.session.lines.every((candidate) => candidate.temperature || session.machineId !== "coffee")) {
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

  const temperature = findTemperature(normalized);
  const query = stripTemperature(normalized);
  if (/\b(light|not too heavy)\b/.test(normalized)) {
    return offerVague(session, query || "sweet", now, { light: true });
  }

  const hits = searchMenu(session.machineId, query || normalized);
  if (hits.length === 0) {
    const stayed = apply(session, { type: "activity", now });
    return done(stayed.session, "This machine doesn't carry that.", [], null);
  }

  const ranked = hits;
  const best = ranked[0];
  const second = ranked[1];
  const bestScore = scoreName(best?.name ?? "", query || normalized);
  const secondScore = second ? scoreName(second.name, query || normalized) : 0;
  const precise = best && bestScore >= 5 && bestScore - secondScore >= 3;
  if (!precise || !best) {
    const stayed = apply(session, { type: "activity", now });
    const names = ranked
      .slice(0, 3)
      .map((item) => item.name)
      .join(", ");
    return done(stayed.session, `I can offer ${names}.`, ranked.slice(0, 3).map((item) => item.id), null);
  }

  const added = runTool(
    session,
    "add_to_cart",
    {
      productId: best.id,
      ...(temperature ? { temperature } : {}),
    },
    now,
  );
  return finishIfComplete(added, now);
}

function offerVague(
  session: OrderSession,
  query: string,
  now: number,
  prefs: { light?: boolean },
): TurnResult {
  let hits = searchMenu(session.machineId, query);
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

function finishIfComplete(effect: ToolEffect, now: number): TurnResult {
  const missing = effect.session.lines.some((line) => line.temperature === undefined && effect.session.machineId === "coffee");
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
  };
}

function done(session: OrderSession, say: string, spotlightIds: string[], readBack: ReadBack | null): TurnResult {
  return { session, say, spotlightIds, readBack };
}

function temperatureOnly(text: string): Temperature | null {
  const normalized = text.trim().toLowerCase().replace(/[.!]/g, "");
  if (normalized === "hot") return "hot";
  if (normalized === "iced" || normalized === "ice" || normalized === "cold") return "iced";
  if (normalized === "room" || normalized === "room temp" || normalized === "room temperature") return "room";
  return null;
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

function scoreName(name: string, query: string): number {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
  const normalized = name.toLowerCase();
  let score = 0;
  if (tokens.join(" ") === normalized) score += 10;
  for (const token of tokens) {
    if (normalized.split(/\s+/).includes(token)) score += 3;
  }
  return score;
}
