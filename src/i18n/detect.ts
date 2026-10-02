import { APP_LANGUAGES, type AppLanguage, isAppLanguage } from "./types";

/**
 * Explicit "speak Spanish" / "en español" style switches.
 * These always win over heuristics and can change a locked session language.
 */
export function parseLanguageChoice(text: string): AppLanguage | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;

  const patterns: Array<{ language: AppLanguage; re: RegExp }> = [
    { language: "es", re: /\b(speak|talk|switch|change|use|in)\s+(spanish|español|espanol)\b|^(español|espanol|spanish)\s*$|\ben\s+español\b|\ben\s+espanol\b/i },
    { language: "fr", re: /\b(speak|talk|switch|change|use|in)\s+(french|français|francais)\b|^(français|francais|french)\s*$|\ben\s+français\b|\ben\s+francais\b/i },
    { language: "he", re: /\b(speak|talk|switch|change|use|in)\s+(hebrew|ivrit)\b|^(עברית|hebrew|ivrit)\s*$|\bבעברית\b/i },
    { language: "af", re: /\b(speak|talk|switch|change|use|in)\s+(afrikaans)\b|^(afrikaans)\s*$|\bin\s+afrikaans\b/i },
    { language: "en", re: /\b(speak|talk|switch|change|use|in)\s+(english)\b|^(english)\s*$|\bin\s+english\b|\ben\s+inglés\b|\ben\s+ingles\b/i },
  ];
  for (const row of patterns) {
    if (row.re.test(normalized) || row.re.test(text)) return row.language;
  }
  return null;
}

/**
 * Best-effort language from customer text. Product names stay English, so a lone
 * "latte" does not count as English. Non-Latin scripts and function words do.
 */
export function detectLanguage(text: string): AppLanguage | null {
  const choice = parseLanguageChoice(text);
  if (choice) return choice;

  const trimmed = text.trim();
  if (!trimmed) return null;

  if (/[\u0590-\u05FF]/.test(trimmed)) return "he";

  const lower = trimmed.toLowerCase();

  // Strong Spanish signals
  if (
    /\b(hola|gracias|por\s+favor|quiero|quisiera|añade|agrega|carrito|helado|caliente|sí|algo\s+más|confirmar|pedido|máquina|máquina)\b/i.test(
      lower,
    ) ||
    /\b(el|la|un|una|del|para|con)\b.+\b(quiero|dame|pon|añade|agrega)\b/i.test(lower)
  ) {
    return "es";
  }

  // Strong French signals
  if (
    /\b(bonjour|merci|s'?il\s+vous\s+pla[iî]t|je\s+voudrais|ajoute|panier|chaud|glac[eé]|oui|non|commander)\b/i.test(lower)
  ) {
    return "fr";
  }

  // Strong Afrikaans signals
  if (/\b(hallo|asseblief|ek\s+wil|mandjie|warm|ysa|bevestig|dankie|ja\s+asseblief)\b/i.test(lower)) {
    return "af";
  }

  // Obvious English sentence glue (not bare product names)
  if (
    /\b(i\s+want|i'?d\s+like|please|can\s+i|show\s+me|add\s+(a|an|the)|remove|scroll|confirm|allergens?|something\s+else|that'?s\s+all)\b/i.test(
      lower,
    )
  ) {
    return "en";
  }

  return null;
}

/** Map a Whisper / verbose_json language label onto our MVP set. */
export function languageFromSttLabel(label: string | null | undefined): AppLanguage | null {
  if (!label) return null;
  const raw = label.trim().toLowerCase();
  if (isAppLanguage(raw)) return raw;
  const map: Record<string, AppLanguage> = {
    english: "en",
    spanish: "es",
    castilian: "es",
    hebrew: "he",
    french: "fr",
    afrikaans: "af",
  };
  return map[raw] ?? null;
}

export function supportedLanguageList(): AppLanguage[] {
  return [...APP_LANGUAGES];
}
