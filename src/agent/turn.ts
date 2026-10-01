import { MACHINES } from "../catalog/index";
import { itemsForMachine } from "../catalog/index";
import type { OrderSession } from "../order/engine";
import { answerWithRules, customerGuard, type TurnResult } from "./rules";
import { runTool } from "./tools";

/**
 * A model may only call menu tools. Confirm is not one of them.
 * With no OPENAI_API_KEY, the same tools are driven by rules.
 */
export async function takeTurn(session: OrderSession, text: string, now: number): Promise<TurnResult> {
  const guarded = customerGuard(session, text, now);
  if (guarded) return guarded;
  const key = process.env.OPENAI_API_KEY;
  if (!key) return answerWithRules(session, text, now);

  try {
    const modeled = await modelTurn(session, text);
    if (!modeled) return answerWithRules(session, text, now);
    return modeled;
  } catch (error) {
    console.error("Text model failed, using menu rules.", error instanceof Error ? error.message : "unknown error");
    return answerWithRules(session, text, now);
  }
}

async function modelTurn(session: OrderSession, text: string): Promise<TurnResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const menu = itemsForMachine(session.machineId)
    .map((item) => `${item.id} | ${item.name} | $${(item.priceCents / 100).toFixed(2)} | ${item.requiresTemperature ? "needs temperature" : "snack"} | ${item.tasteTags.join(", ")}`)
    .join("\n");
  const cart = session.lines
    .map((line) => `${line.lineId} ${line.productId} x${line.quantity} ${line.temperature ?? "no temperature"}`)
    .join("\n");
  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: [
        `You are the ${MACHINES[session.machineId].name} vending machine.`,
        "Use tools only. Never confirm an order. Never invent a product id.",
        "Allergens are unknown for every item. Say so. Do not guess ingredients.",
        "For a vague request, call search_menu and do not add until one item is clear.",
        "Add with add_to_cart only. Then call read_back when every drink has a temperature.",
        `Menu:\n${menu}`,
        `Cart:\n${cart || "(empty)"}`,
      ].join("\n"),
    },
    { role: "user", content: text },
  ];

  let say = "";
  let spotlightIds: string[] = [];
  let readBack: TurnResult["readBack"] = null;
  let usedTool = false;
  for (let round = 0; round < 4; round += 1) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        messages,
        tools: TOOL_SCHEMA,
      }),
    });
    if (!response.ok) throw new Error(`Model request failed (${response.status}).`);
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const message = payload.choices?.[0]?.message;
    const toolCalls = message?.tool_calls ?? [];
    if (toolCalls.length === 0) break;
    messages.push(message as Record<string, unknown>);
    for (const toolCall of toolCalls) {
      usedTool = true;
      const args = parseArgs(toolCall.function.arguments);
      if (toolCall.function.name === "confirm") {
        say = "I can't confirm that. Say yes after I read the order, or tap Confirm.";
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: "confirm is not available" }),
        });
        continue;
      }
      const effect = runTool(session, toolCall.function.name, args, Date.now());
      session = effect.session;
      say = effect.say;
      if (effect.spotlightIds.length > 0) spotlightIds = effect.spotlightIds;
      readBack = effect.readBack;
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify({ say: effect.say, spotlightIds: effect.spotlightIds, phase: effect.session.phase }),
      });
    }
  }
  if (!usedTool) return null;
  if (session.phase !== "awaiting_confirmation" && session.phase !== "ready_to_pay") readBack = null;
  return { session, say, spotlightIds, readBack };
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "search_menu",
      description: "Find products on this machine. Does not change the cart.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_to_cart",
      description: "Draft a line from a menu product id. Does not confirm the order.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          productId: { type: "string" },
          quantity: { type: "integer" },
          temperature: { type: "string", enum: ["hot", "iced", "room"] },
        },
        required: ["productId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_temperature",
      description: "Set hot, iced, or room on a drink line.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          lineId: { type: "string" },
          temperature: { type: "string", enum: ["hot", "iced", "room"] },
        },
        required: ["lineId", "temperature"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_line",
      description: "Remove one cart line.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { lineId: { type: "string" } },
        required: ["lineId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_back",
      description: "Read the finished cart back and ask for a yes. Refuses an incomplete drink.",
      parameters: { type: "object", additionalProperties: false, properties: {} },
    },
  },
] as const;
