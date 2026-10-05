/**
 * Multilingual yes / no / temperature / nav cues for the rules path.
 * Product search still uses English catalog names and aliases.
 */

export function clearYesCue(normalized: string): boolean {
  if (YES_EXACT.has(normalized)) return true;
  if (/^(sí|si|oui|כן|ja)([!?.,\s]*)$/i.test(normalized)) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length <= 3 && /^(sí|si|oui|כן|ja)\b/.test(normalized)) return true;
  // English affirmatives that never change the cart (qualified "ok make it hot" stays false).
  if (
    /^(yes|yeah|yep|yup|sure|ok|okay|confirm|proceed|alright|perfect|absolutely)( please| thanks| thank you)?$/.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(sounds|looks) (good|great|fine)$/.test(normalized)) return true;
  if (/^(ill|i will) take it$/.test(normalized)) return true;
  if (/^(go ahead|go for it|ring it up|place (the|my) order)$/.test(normalized)) return true;
  return false;
}

export function clearNoCue(normalized: string): boolean {
  return NO_EXACT.has(normalized);
}

export function noMoreCue(normalized: string): boolean {
  if (NO_MORE_EXACT.has(normalized)) return true;
  if (/^(nada más|nada mas|rien de plus|rien d autre|לא תודה|niks meer|geen meer)$/i.test(normalized)) {
    return true;
  }
  // English "done adding" — not a cart change ("no, make it hot" stays out via wantsChange).
  if (
    /^(done|all set|all good|im done|i am done|im good|i am good|im all set|i am all set)$/.test(normalized)
  ) {
    return true;
  }
  if (/^(thats|that is) (it|all|enough|everything)$/.test(normalized)) return true;
  if (/^(checkout|check out|lets checkout|lets check out|ready to pay)$/.test(normalized)) return true;
  if (/^(nothing|no) (else|more)( please| thanks| thank you)?$/.test(normalized)) return true;
  return false;
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
  if (/^(clear|empty|vaciar|vider)( (it|everything|all|todo|tout))?$/.test(normalized)) return true;
  if (/\b(start over|start again|scratch that|scratch this|scratch the order)\b/.test(normalized)) return true;
  if (/\b(forget everything|forget the order|forget this order|cancel everything)\b/.test(normalized)) return true;
  if (/\b(quita|quitar|borra|borrar|enlever|efface|verwyder)\b/.test(normalized) && /\b(todo|tout|alles)\b/.test(normalized)) {
    return true;
  }
  return (
    /\b(remove|removed|delete|deleted|clear|empty|wipe|get rid of)\b/.test(normalized) &&
    /\b(everything|every item|the whole cart|the whole order|whole cart|whole order|it all|all of it|all of them|all of this|all of these)\b/.test(
      normalized,
    )
  ) || /^(please )?(remove|delete|clear|empty) all$/.test(normalized);
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
  "yes",
  "yes please",
  "yeah",
  "yep",
  "yup",
  "sure",
  "ok",
  "okay",
  "confirm",
  "proceed",
  "sounds good",
  "looks good",
  "ill take it",
  "i will take it",
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
  "done",
  "all set",
  "all good",
  "im done",
  "i am done",
  "im good",
  "i am good",
  "checkout",
  "check out",
  "thats it",
  "thats all",
  "that is all",
  "that is it",
  "nothing else",
  "no more",
]);
