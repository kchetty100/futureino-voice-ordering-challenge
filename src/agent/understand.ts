import { aliasesFor, CATALOG, getItem, type MachineId, type Temperature } from "../catalog/index";
import { chatUsage } from "../operator/cost";
import { noteUsage } from "../operator/log";
import { apply, type OrderSession } from "../order/engine";
import { langOf, t } from "../i18n";
import { machineIntro } from "./arrive";
import { finishIfComplete, type TurnResult } from "./rules";
import { pricedList, runTool, type ToolEffect } from "./tools";

export type HeardAction = "add" | "clarify" | "suggest" | "menu" | "none" | "clear" | "remove" | "set_quantity" | "set_temperature";

export type HeardLine = {
  productId: string;
  temperature: Temperature | null;
  quantity?: number | null;
};

export type Heard = {
  action: HeardAction;
  lines: HeardLine[];
  choices: string[];
  menu: MachineId | null;
};

const MENU = CATALOG.map((item) => {
  const phrases = aliasesFor(item.id);
  const words = phrases.length > 0 ? ` | also: ${phrases.join(", ")}` : "";
  const kind = item.requiresTemperature ? `needs temperature, best ${item.suits?.join("/") || "unknown"}` : "snack";
  return `${item.id} | ${item.name}${words} | ${kind} | ${item.tasteTags.join(", ")}`;
}).join("\n");

const PROMPT = [
  "Map the customer's sentence onto this menu and the cart. Return JSON only.",
  "action add: one clear product per line they asked for. Use a real productId from the menu. quantity is how many they asked for, or 1.",
  "action remove: take named products out of the cart. Put those productIds in lines. This is not a yes.",
  "action clear: empty the whole cart. remove everything, start over, scratch that, get rid of all of it.",
  "action set_quantity: set one cart line to the spoken count, from 1 to 9.",
  "action set_temperature: set hot, iced, or room on a drink already in the cart.",
  "action clarify: two or more products fit and you cannot tell which. Put those ids in choices. Do not add.",
  "action suggest: they want a suggestion, or describe a taste, mood or need (warm, cold, tired, light, a treat) without naming a product. Put up to 3 fitting productIds from the customer's Machine only in choices. Never add.",
  "action menu: they asked to see coffee or snacks, without naming one product.",
  "action none: nothing on the menu fits, or the request is not a cart change. Leave lines and choices empty.",
  "temperature is hot, iced, or room only when they said it and the item needs a temperature. Otherwise none.",
  "quantity is 0 when they did not say a count.",
  "Never confirm an order. Never invent a product id. Allergens are unknown. Do not guess ingredients.",
  `Menu:\n${MENU}`,
].join("\n");

/** Turn a model object into menu ids. Unknown ids are dropped. */
export function parseHeard(value: unknown): Heard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const action = raw.action;
  if (
    action !== "add" &&
    action !== "clarify" &&
    action !== "suggest" &&
    action !== "menu" &&
    action !== "none" &&
    action !== "clear" &&
    action !== "remove" &&
    action !== "set_quantity" &&
    action !== "set_temperature"
  ) {
    return null;
  }
  const lines = Array.isArray(raw.lines) ? raw.lines.flatMap(readLine) : [];
  const choices = Array.isArray(raw.choices) ? raw.choices.filter((id): id is string => typeof id === "string" && Boolean(getItem(id))) : [];
  const menu = raw.menu === "coffee" || raw.menu === "snacks" ? raw.menu : null;
  return { action, lines, choices, menu };
}

/** Apply a mapped sentence. Returns null when there is nothing safe to do. */
export function applyHeard(session: OrderSession, heard: Heard, now: number): TurnResult | null {
  if (heard.action === "none") return null;
  if (heard.action === "clear") {
    const hadItems = session.lines.length > 0;
    const result = apply(session, { type: "clear", now });
    const say = hadItems ? t(langOf(result.session), "cart_cleared") : t(langOf(result.session), "cart_empty");
    return reply(result.session, say);
  }
  if (heard.action === "remove") return removeHeard(session, heard, now);
  if (heard.action === "set_quantity") return quantityHeard(session, heard, now);
  if (heard.action === "set_temperature") return temperatureHeard(session, heard, now);
  if (heard.action === "menu" && heard.menu) {
    const stayed = apply(session, { type: "activity", now });
    if (heard.menu === session.machineId) {
      const intro = machineIntro(heard.menu, langOf(session));
      return {
        session: stayed.session,
        say: intro.say,
        spotlightIds: intro.spotlightIds,
        readBack: null,
        switchTo: null,
        ui: null,
      };
    }
    return {
      session: stayed.session,
      say: t(langOf(stayed.session), "wrong_machine"),
      spotlightIds: [],
      readBack: null,
      switchTo: null,
      ui: null,
    };
  }
  if (heard.action === "suggest") {
    // The model may only point at this machine's items. Nothing is added; prices come from the catalog.
    const items = heard.choices.flatMap((id) => {
      const item = getItem(id);
      return item && item.machineId === session.machineId ? [item] : [];
    }).slice(0, 3);
    if (items.length === 0) return null;
    const stayed = apply(session, { type: "activity", now });
    return {
      session: stayed.session,
      say: t(langOf(stayed.session), "offer_list", { list: pricedList(items, langOf(stayed.session)) }),
      spotlightIds: items.map((item) => item.id),
      readBack: null,
      switchTo: null,
      ui: null,
    };
  }
  if (heard.action === "clarify") {
    if (heard.choices.length === 1) {
      const only = heard.choices[0];
      if (!only) return null;
      return applyHeard(session, { action: "add", lines: [{ productId: only, temperature: null }], choices: [], menu: null }, now);
    }
    const items = heard.choices.flatMap((id) => {
      const item = getItem(id);
      return item ? [item] : [];
    });
    if (items.length < 2) return null;
    const stayed = apply(session, { type: "activity", now });
    const shown = items.slice(0, 3);
    return {
      session: stayed.session,
      say: t(langOf(stayed.session), "can_offer", { names: pricedList(shown, langOf(stayed.session)) }),
      spotlightIds: shown.map((item) => item.id),
      readBack: null,
      switchTo: null,
      ui: null,
    };
  }
  if (heard.action !== "add" || heard.lines.length === 0) return null;

  const pending = session.lines.filter(
    (line) => getItem(line.productId)?.requiresTemperature === true && line.temperature === undefined,
  );
  const onlyPending = pending.length === 1 ? pending[0] : undefined;
  if (
    onlyPending &&
    heard.lines.length === 1 &&
    heard.lines[0]?.productId === onlyPending.productId &&
    !heard.lines[0]?.temperature
  ) {
    const item = getItem(onlyPending.productId);
    const stayed = apply(session, { type: "activity", now });
    return {
      session: stayed.session,
      say: t(langOf(stayed.session), "needs_temp", { name: item?.name ?? "That drink" }),
      spotlightIds: [],
      readBack: null,
      switchTo: null,
      ui: null,
    };
  }

  let current = session;
  let last: ToolEffect | null = null;
  const ids: string[] = [];
  for (const line of heard.lines) {
    const item = getItem(line.productId);
    if (!item) continue;
    const temperature = line.temperature && item.requiresTemperature ? line.temperature : undefined;
    const quantity = line.quantity && line.quantity > 1 ? line.quantity : undefined;
    const added = runTool(
      current,
      "add_to_cart",
      { productId: item.id, ...(quantity ? { quantity } : {}), ...(temperature ? { temperature } : {}) },
      now,
    );
    if (!added.ok) {
      return { session: added.session, say: added.say, spotlightIds: [], readBack: null, switchTo: null, ui: null };
    }
    current = added.session;
    last = added;
    ids.push(item.id);
  }
  if (!last) return null;
  return finishIfComplete({ ...last, spotlightIds: ids }, now);
}

/** Ask the model which menu ids this sentence means. It cannot confirm. */
export async function understandUtterance(session: OrderSession, text: string): Promise<Heard | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const cart =
    session.lines
      .map((line) => `${line.productId} x${line.quantity} ${line.temperature ?? "no temperature"}`)
      .join(", ") || "(empty)";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 300,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: `Machine: ${session.machineId}\nCart: ${cart}\nCustomer: ${text}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "order_map",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              action: {
                type: "string",
                enum: ["add", "clarify", "menu", "none", "clear", "remove", "set_quantity", "set_temperature"],
              },
              lines: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    productId: { type: "string" },
                    temperature: { type: "string", enum: ["hot", "iced", "room", "none"] },
                    quantity: { type: "integer" },
                  },
                  required: ["productId", "temperature", "quantity"],
                },
              },
              choices: { type: "array", items: { type: "string" } },
              menu: { type: "string", enum: ["coffee", "snacks", "none"] },
            },
            required: ["action", "lines", "choices", "menu"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Menu mapping failed (${response.status}).`);
  const payload = (await response.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  noteUsage(chatUsage("gpt-4o-mini", payload));
  const raw = payload.choices?.[0]?.message?.content ?? "";
  try {
    return parseHeard(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function readLine(value: unknown): HeardLine[] {
  if (!value || typeof value !== "object") return [];
  const raw = value as Record<string, unknown>;
  if (typeof raw.productId !== "string" || !getItem(raw.productId)) return [];
  const temperature = raw.temperature === "hot" || raw.temperature === "iced" || raw.temperature === "room" ? raw.temperature : null;
  const quantity = typeof raw.quantity === "number" && raw.quantity >= 1 && raw.quantity <= 9 ? raw.quantity : null;
  return [{ productId: raw.productId, temperature, quantity }];
}

function reply(session: OrderSession, say: string, spotlightIds: string[] = []): TurnResult {
  return { session, say, spotlightIds, readBack: null, switchTo: null, ui: null };
}

function removeHeard(session: OrderSession, heard: Heard, now: number): TurnResult | null {
  const ids = new Set(heard.lines.map((line) => line.productId));
  const matching = session.lines.filter((line) => ids.has(line.productId));
  if (matching.length === 0) return null;
  let current = session;
  for (const line of matching) {
    const removed = apply(current, { type: "remove_line", lineId: line.lineId, now });
    if (!removed.ok) return null;
    current = removed.session;
  }
  const names = [...ids].map((id) => getItem(id)?.name).filter((name): name is string => Boolean(name));
  const said = names.length === 1 ? t(langOf(current), "removed_name", { name: names[0] }) : t(langOf(current), "removed");
  if (current.lines.length === 0) return reply(current, `${said} ${t(langOf(current), "cart_empty")}`.trim());
  return reply(current, said, [...ids]);
}

function quantityHeard(session: OrderSession, heard: Heard, now: number): TurnResult | null {
  const spec = heard.lines[0];
  if (!spec?.quantity) return null;
  const line = session.lines.find((candidate) => candidate.productId === spec.productId && (!spec.temperature || candidate.temperature === spec.temperature));
  if (!line) return null;
  const saved = apply(session, { type: "set_quantity", lineId: line.lineId, quantity: spec.quantity, now });
  if (!saved.ok) return null;
  const name = getItem(line.productId)?.name ?? t(langOf(saved.session), "that_item");
  return reply(saved.session, t(langOf(saved.session), "quantity_set", { name, quantity: spec.quantity }), [line.productId]);
}

function temperatureHeard(session: OrderSession, heard: Heard, now: number): TurnResult | null {
  const spec = heard.lines[0];
  if (!spec?.temperature) return null;
  const item = getItem(spec.productId);
  if (!item?.requiresTemperature) return null;
  const line = session.lines.find((candidate) => candidate.productId === spec.productId);
  if (!line) return null;
  const saved = apply(session, { type: "set_temperature", lineId: line.lineId, temperature: spec.temperature, now });
  if (!saved.ok) return null;
  return reply(saved.session, t(langOf(saved.session), "is_temp", { name: item.name, temperature: spec.temperature }), [item.id]);
}
