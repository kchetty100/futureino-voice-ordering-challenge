/** Screen actions the kiosk applies after a turn. Cart writes stay in the engine. */
import { clearCartCue, openCartCue, scrollDownCue, scrollUpCue } from "../i18n";

export type UiCommand = "open_cart" | "scroll_up" | "scroll_down" | "go_back";

export type NavIntent =
  | { kind: "ui"; ui: UiCommand }
  | { kind: "clear_cart" };

/**
 * Movement and cart-screen phrases. Machine switches stay in arrive.requestedMachine.
 * Order and confirm stay in rules/tools. Returns null when this is not navigation.
 */
export function parseNavIntent(text: string): NavIntent | null {
  const normalized = spoken(text);
  if (!normalized) return null;

  if (wantsBack(normalized)) return { kind: "ui", ui: "go_back" };

  if (wantsClearCart(normalized)) return { kind: "clear_cart" };

  if (scrollUpCue(normalized)) return { kind: "ui", ui: "scroll_up" };
  if (scrollDownCue(normalized)) return { kind: "ui", ui: "scroll_down" };

  if (wantsOpenCart(normalized)) return { kind: "ui", ui: "open_cart" };

  return null;
}

/** Bare back / previous page. "Go back to coffee" stays a machine switch. */
function wantsBack(normalized: string): boolean {
  if (/\b(coffee|snack|snacks|drink|drinks|boost)\b/.test(normalized)) return false;
  const bare = normalized.replace(/^(please|can you|could you)\s+/, "").replace(/\s+please$/, "");
  if (/^(go |take me |page )?(back|return)$/.test(bare)) return true;
  if (/^(previous|last)( page| screen)?$/.test(bare)) return true;
  if (bare === "page back" || bare === "go backwards") return true;
  if (/\b(go back|take me back|previous page|previous screen|last page|last screen|page back)\b/.test(bare)) {
    return true;
  }
  return /^(atrás|atras|volver|regresa|retour|revenir|חזור|אחורה|terug|vorige|vorige bladsy)$/.test(bare);
}

function wantsClearCart(normalized: string): boolean {
  if (clearCartCue(normalized)) return true;
  if (/\b(clear|empty|wipe)\b/.test(normalized) && /\b(cart|order)\b/.test(normalized)) return true;
  return /^(clear|empty)( (it|everything|all))?$/.test(normalized);
}

function wantsOpenCart(normalized: string): boolean {
  if (openCartCue(normalized)) return true;
  // Edits like "remove from cart" are handled earlier; still avoid claiming them.
  if (/\b(remove|delete|add|change|make|clear|empty)\b/.test(normalized)) return false;
  if (/^(the )?cart$/.test(normalized) || /^my (cart|order)$/.test(normalized)) return true;
  if (/\b(show|open|view|see|check|display)\b/.test(normalized) && /\b(cart|order)\b/.test(normalized)) {
    return true;
  }
  return /\b(whats in|what is in|what is on)\b.*\b(cart|order)\b/.test(normalized);
}

function spoken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
