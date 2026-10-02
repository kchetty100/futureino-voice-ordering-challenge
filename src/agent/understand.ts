import { aliasesFor, CATALOG, getItem, type MachineId, type Temperature } from "../catalog/index";
import { chatUsage } from "../operator/cost";
import { noteUsage } from "../operator/log";
import { apply, type OrderSession } from "../order/engine";
import { langOf } from "../i18n";
import { machineIntro } from "./arrive";
import { finishIfComplete, type TurnResult } from "./rules";
import { runTool, type ToolEffect } from "./tools";

export type HeardLine = {
  productId: string;
  temperature: Temperature | null;
};

export type Heard = {
  action: "add" | "clarify" | "menu" | "none";
  lines: HeardLine[];
  choices: string[];
  menu: MachineId | null;
};

const MENU = CATALOG.map((item) => {
  const phrases = aliasesFor(item.id);
  const words = phrases.length > 0 ? ` | also: ${phrases.join(", ")}` : "";
  const kind = item.requiresTemperature ? "needs temperature" : "snack";
  return `${item.id} | ${item.name}${words} | ${kind} | ${item.tasteTags.join(", ")}`;
}).join("\n");

const PROMPT = [
  "Map the customer's sentence onto this menu. Return JSON only.",
  "action add: one clear product per line they asked for. Use a real productId from the menu.",
  "action clarify: two or more products fit and you cannot tell which. Put those ids in choices. Do not add.",
  "action menu: they asked to see coffee or snacks, without naming one product.",
  "action none: nothing on the menu fits. Leave lines and choices empty.",
  "temperature is hot, iced, or room only when they said it and the item needs a temperature. Otherwise none.",
  "Never confirm an order. Never invent a product id. Allergens are unknown. Do not guess ingredients.",
  `Menu:\n${MENU}`,
].join("\n");

/** Turn a model object into menu ids. Unknown ids are dropped. */
export function parseHeard(value: unknown): Heard | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const action = raw.action;
  if (action !== "add" && action !== "clarify" && action !== "menu" && action !== "none") return null;
  const lines = Array.isArray(raw.lines) ? raw.lines.flatMap(readLine) : [];
  const choices = Array.isArray(raw.choices) ? raw.choices.filter((id): id is string => typeof id === "string" && Boolean(getItem(id))) : [];
  const menu = raw.menu === "coffee" || raw.menu === "snacks" ? raw.menu : null;
  return { action, lines, choices, menu };
}

/** Apply a mapped sentence. Returns null when there is nothing safe to do. */
export function applyHeard(session: OrderSession, heard: Heard, now: number): TurnResult | null {
  if (heard.action === "none") return null;
  if (heard.action === "menu" && heard.menu) {
    const opening = heard.menu !== session.machineId;
    const intro = machineIntro(heard.menu, langOf(session));
    const stayed =
      opening && (session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay")
        ? apply(session, { type: "revise", now })
        : apply(session, { type: "activity", now });
    return {
      session: stayed.session,
      say: intro.say,
      spotlightIds: intro.spotlightIds,
      readBack: null,
      switchTo: opening ? heard.menu : null,
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
      say: `I can offer ${shown.map((item) => item.name).join(", ")}.`,
      spotlightIds: shown.map((item) => item.id),
      readBack: null,
      switchTo: null,
      ui: null,
    };
  }
  if (heard.action !== "add" || heard.lines.length === 0) return null;

  let current = session;
  let last: ToolEffect | null = null;
  const ids: string[] = [];
  for (const line of heard.lines) {
    const item = getItem(line.productId);
    if (!item) continue;
    const temperature = line.temperature && item.requiresTemperature ? line.temperature : undefined;
    const added = runTool(
      current,
      "add_to_cart",
      { productId: item.id, ...(temperature ? { temperature } : {}) },
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
        { role: "user", content: `Cart: ${cart}\nCustomer: ${text}` },
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
              action: { type: "string", enum: ["add", "clarify", "menu", "none"] },
              lines: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    productId: { type: "string" },
                    temperature: { type: "string", enum: ["hot", "iced", "room", "none"] },
                  },
                  required: ["productId", "temperature"],
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
  return [{ productId: raw.productId, temperature }];
}
