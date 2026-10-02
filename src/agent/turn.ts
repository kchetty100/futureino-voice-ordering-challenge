import type { OrderSession } from "../order/engine";
import { classifyConfirmation, type ConfirmationIntent } from "./confirm";
import { acceptOrder, answerWithRules, declineOrder, isCartEditUtterance, isUnresolvedCartEdit, mentionsOrder, type TurnResult } from "./rules";
import { changesOrder, productMentioned, wantsChange } from "./tools";
import { applyHeard, understandUtterance, type Heard } from "./understand";
import { parseNavIntent } from "./nav";

/**
 * A model may only call menu tools. Confirm is not one of them.
 * With no OPENAI_API_KEY, the same tools are driven by rules.
 */
export async function takeTurn(session: OrderSession, text: string, now: number): Promise<TurnResult> {
  const ruled = answerWithRules(session, text, now);
  if (!mentionsOrder(text)) return ruled;
  if (ruled.switchTo || ruled.ui || orderMoved(session, ruled.session)) return ruled;
  // A named edit that already resolved stays with the rules. An unresolved one can still be a clear, remove, or quantity.
  if (isCartEditUtterance(text) && !isUnresolvedCartEdit(session, text)) return ruled;

  const waiting = session.phase === "awaiting_confirmation" || session.phase === "ready_to_pay";
  if (process.env.OPENAI_API_KEY && waiting) {
    try {
      const intent = await classifyConfirmation(text);
      const decision = confirmationDecision(intent, text);
      if (decision === "accept") return acceptOrder(session, now);
      if (decision === "decline") return declineOrder(session, now);
    } catch (error) {
      console.error("Confirmation check failed, using menu rules.", error instanceof Error ? error.message : "unknown error");
    }
  }

  if (ruled.spotlightIds.length > 0) return ruled;
  if (!process.env.OPENAI_API_KEY) return ruled;

  try {
    const heard = await understandUtterance(session, text);
    const safe = heard ? heardForSpeech(text, heard) : null;
    const mapped = safe ? applyHeard(session, safe, now) : null;
    if (mapped && (mapped.switchTo || mapped.spotlightIds.length > 0 || orderMoved(session, mapped.session))) return mapped;
  } catch (error) {
    console.error("Menu mapping failed, using menu rules.", error instanceof Error ? error.message : "unknown error");
  }
  return ruled;
}

/**
 * A decline means they want the order changed, so it never confirms.
 * A confirm still has to be free of a change.
 */
export function confirmationDecision(intent: ConfirmationIntent, text: string): "accept" | "decline" | null {
  if (intent === "decline") return "decline";
  if (intent === "confirm" && !wantsChange(text) && !changesOrder(text)) return "accept";
  return null;
}

/** A model draft that adds items the rules refused is discarded. */
export function chooseTurn(before: OrderSession, ruled: TurnResult, modeled: TurnResult | null): TurnResult {
  if (!modeled) return ruled;
  if (orderMoved(before, ruled.session)) return ruled;
  if (orderMoved(ruled.session, modeled.session)) return ruled;
  return modeled;
}

/** A model may not add, remove, or retarget a product the customer did not name. */
export function heardForSpeech(text: string, heard: Heard): Heard | null {
  if (heard.action === "clear") {
    return isCartEditUtterance(text) || parseNavIntent(text)?.kind === "clear_cart" ? heard : null;
  }
  if (heard.action === "add" || heard.action === "remove" || heard.action === "set_quantity" || heard.action === "set_temperature") {
    const lines = heard.lines.filter((line) => productMentioned(text, line.productId));
    if (lines.length === 0) return null;
    return { ...heard, lines };
  }
  if (heard.action === "clarify") {
    const choices = heard.choices.filter((id) => productMentioned(text, id));
    if (choices.length < 2) return null;
    return { ...heard, choices };
  }
  return heard;
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

