import type { OrderSession } from "../order/engine";
import { classifyConfirmation } from "./confirm";
import { acceptOrder, answerWithRules, declineOrder, isCartEditUtterance, type TurnResult } from "./rules";
import { changesOrder, wantsChange } from "./tools";
import { applyHeard, understandUtterance } from "./understand";

/**
 * A model may only call menu tools. Confirm is not one of them.
 * With no OPENAI_API_KEY, the same tools are driven by rules.
 */
export async function takeTurn(session: OrderSession, text: string, now: number): Promise<TurnResult> {
  const ruled = answerWithRules(session, text, now);
  if (ruled.switchTo || ruled.ui || orderMoved(session, ruled.session)) return ruled;
  // Named remove/quantity/heat stays with the rule reply. Do not revise to a vague "what do you want to change?"
  if (isCartEditUtterance(text)) return ruled;

  const waiting = session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay";
  if (process.env.OPENAI_API_KEY && waiting) {
    try {
      const intent = await classifyConfirmation(text);
      if ((intent === "confirm" || intent === "decline") && !wantsChange(text) && !changesOrder(text)) return acceptOrder(session, now);
      if (intent === "decline" && wantsChange(text)) return declineOrder(session, now);
    } catch (error) {
      console.error("Confirmation check failed, using menu rules.", error instanceof Error ? error.message : "unknown error");
    }
  }

  if (ruled.spotlightIds.length > 0) return ruled;
  if (!process.env.OPENAI_API_KEY) return ruled;

  try {
    const heard = await understandUtterance(session, text);
    const mapped = heard ? applyHeard(session, heard, now) : null;
    if (mapped && (mapped.switchTo || mapped.spotlightIds.length > 0 || orderMoved(session, mapped.session))) return mapped;
  } catch (error) {
    console.error("Menu mapping failed, using menu rules.", error instanceof Error ? error.message : "unknown error");
  }
  return ruled;
}

/** A model draft that adds items the rules refused is discarded. */
export function chooseTurn(before: OrderSession, ruled: TurnResult, modeled: TurnResult | null): TurnResult {
  if (!modeled) return ruled;
  if (orderMoved(before, ruled.session)) return ruled;
  if (orderMoved(ruled.session, modeled.session)) return ruled;
  return modeled;
}

function orderMoved(before: OrderSession, after: OrderSession): boolean {
  if (before.phase !== after.phase) return true;
  if (before.lines.length !== after.lines.length) return true;
  return before.lines.some((line, index) => {
    const next = after.lines[index];
    return (
      !next ||
      next.lineId !== line.lineId ||
      next.productId !== line.productId ||
      next.quantity !== line.quantity ||
      next.temperature !== line.temperature
    );
  });
}

