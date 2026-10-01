import { chatUsage } from "../operator/cost";
import { noteUsage } from "../operator/log";

export type ConfirmationIntent = "confirm" | "decline" | "other";

const PROMPT = [
  "The customer was asked: would you like to add anything else, or say yes to confirm the order?",
  "Classify that reply. Return JSON with one field, intent, set to confirm, decline, or other.",
  "confirm: they are done adding. Examples: yes, yeah, confirm, proceed, no, nope, nah, no thanks, nothing, nothing else, no more, that's it, that's all, I'm good, I'm done, all set.",
  "decline: they want this order changed. Examples: change it, make it hot, remove that, wrong item, no make it iced.",
  "other: they are naming something to add, or asking what is on a menu.",
  "A yes that also changes the order is decline or other, never confirm.",
  "A misspelling of confirm or proceed is still confirm.",
].join("\n");

/** Ask the model whether this reply accepts the order. It cannot change the cart. */
export async function classifyConfirmation(text: string): Promise<ConfirmationIntent> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return "other";
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 20,
      messages: [
        { role: "system", content: PROMPT },
        { role: "user", content: text },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "confirmation",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: { intent: { type: "string", enum: ["confirm", "decline", "other"] } },
            required: ["intent"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`Confirmation check failed (${response.status}).`);
  const payload = (await response.json()) as {
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  noteUsage(chatUsage("gpt-4o-mini", payload));
  const raw = payload.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(raw) as { intent?: string };
    if (parsed.intent === "confirm" || parsed.intent === "decline" || parsed.intent === "other") return parsed.intent;
  } catch {
    // Fall through to the menu rules.
  }
  return "other";
}
