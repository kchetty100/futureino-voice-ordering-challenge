/**
 * Multilingual yes / no / temperature / nav cues for the rules path.
 * Product search still uses English catalog names and aliases.
 */

export function clearYesCue(normalized: string): boolean {
  if (YES_EXACT.has(normalized)) return true;
  if (/^(sí|si|oui|כן|ja)([!?.,\s]*)$/i.test(normalized)) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length <= 3 && /^(sí|si|oui|כן|ja)\b/.test(normalized)) return true;
  return false;
}

export function clearNoCue(normalized: string): boolean {
  return NO_EXACT.has(normalized);
}

export function noMoreCue(normalized: string): boolean {
  if (NO_MORE_EXACT.has(normalized)) return true;
  return /^(nada más|nada mas|rien de plus|rien d autre|לא תודה|niks meer|geen meer)$/i.test(normalized);
}

/** Temperature from multilingual words when the utterance is otherwise bare. */
export function temperatureFromCue(text: string): "hot" | "iced" | "room" | "many" | null {
  const normalized = text.trim().toLowerCase().replace(/[.?!,]/g, " ");
  const temps = new Set<"hot" | "iced" | "room">();
  if (/\b(iced|ice|icy|cold|helado|hielo|fr[ií]o|glac[eé]|froid|קרח|קר|ys|koud)\b/i.test(normalized)) {
    temps.add("iced");
  }
  if (/\b(hot|caliente|chaud|חם|warm)\b/i.test(normalized)) temps.add("hot");
  if (
    /\b(room|ambiente|ambiant|חדר|kamer|room temperature|room temp|temperatura ambiente|température ambiante)\b/i.test(
      normalized,
    )
  ) {
    temps.add("room");
  }
  if (temps.size > 1) return "many";
  if (temps.size === 0) return null;
  return [...temps][0] ?? null;
}

export function openCartCue(normalized: string): boolean {
  if (/\b(remove|delete|add|change|make|clear|empty|vaciar|vider|skoonmaak)\b/.test(normalized)) return false;
  if (/^(the )?cart$/.test(normalized) || /^my (cart|order)$/.test(normalized)) return true;
  if (/^(el )?carrito$/.test(normalized) || /^(le )?panier$/.test(normalized) || /^die mandjie$/.test(normalized)) {
    return true;
  }
  if (
    /\b(show|open|view|see|check|display|muestra|mostrar|abre|ver|ouvrir|montre|wys|oop)\b/.test(normalized) &&
    /\b(cart|order|carrito|panier|mandjie|pedido|commande|bestelling)\b/.test(normalized)
  ) {
    return true;
  }
  return false;
}

export function clearCartCue(normalized: string): boolean {
  if (
    /\b(clear|empty|wipe|vaciar|vider|skoonmaak|leegmaak)\b/.test(normalized) &&
    /\b(cart|order|carrito|panier|mandjie|pedido|commande|bestelling)\b/.test(normalized)
  ) {
    return true;
  }
  return /^(clear|empty|vaciar|vider)( (it|everything|all|todo|tout))?$/.test(normalized);
}

export function scrollUpCue(normalized: string): boolean {
  return (
    /\bscroll\s+up\b/.test(normalized) ||
    /^(page\s+)?up$/.test(normalized) ||
    /^(go|move)\s+up$/.test(normalized) ||
    /\b(sube|arriba|monte|opwaarts)\b/.test(normalized) ||
    /\brol op\b/.test(normalized)
  );
}

export function scrollDownCue(normalized: string): boolean {
  return (
    /\bscroll\s+down\b/.test(normalized) ||
    /^(page\s+)?down$/.test(normalized) ||
    /^(go|move)\s+down$/.test(normalized) ||
    /\b(baja|abajo|descends|afwaarts)\b/.test(normalized) ||
    /\brol af\b/.test(normalized)
  );
}

const YES_EXACT = new Set([
  "sí",
  "si",
  "si por favor",
  "sí por favor",
  "claro",
  "vale",
  "de acuerdo",
  "oui",
  "oui s il vous plait",
  "d accord",
  "כן",
  "בטח",
  "בסדר",
  "ja",
  "ja asseblief",
]);

const NO_EXACT = new Set([
  "no",
  "nope",
  "nah",
  "change it",
  "change",
  "no thanks",
  "no thank you",
  "non",
  "non merci",
  "לא",
  "nee",
  "nee dankie",
  "no gracias",
]);

const NO_MORE_EXACT = new Set([
  "nada mas",
  "nada más",
  "no mas",
  "no más",
  "rien de plus",
  "rien d autre",
  "c est tout",
  "זהו",
  "זה הכל",
  "די",
  "niks meer",
  "dis alles",
]);
