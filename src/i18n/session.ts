import { detectLanguage, parseLanguageChoice } from "./detect";
import { languageDisplayName, t } from "./phrases";
import type { AppLanguage } from "./types";

export type LanguageFields = {
  preferredLanguage: AppLanguage;
  /** Once true, only an explicit language choice may change preferredLanguage. */
  languageSet: boolean;
};

export const DEFAULT_LANGUAGE: AppLanguage = "en";

export function defaultLanguageFields(): LanguageFields {
  return { preferredLanguage: DEFAULT_LANGUAGE, languageSet: false };
}

/**
 * Apply detection / explicit choice onto session language fields.
 * Returns the updated fields and an optional acknowledgement line when the user switched language.
 */
export function applyLanguageCue(
  fields: LanguageFields,
  text: string,
): { fields: LanguageFields; ack: string | null } {
  const choice = parseLanguageChoice(text);
  if (choice) {
    const changed = !fields.languageSet || fields.preferredLanguage !== choice;
    const next = { preferredLanguage: choice, languageSet: true };
    if (!changed) return { fields: next, ack: null };
    return {
      fields: next,
      ack: t(choice, "language_set", { language: languageDisplayName(choice, choice) }),
    };
  }

  if (fields.languageSet) return { fields, ack: null };

  const detected = detectLanguage(text);
  if (!detected) return { fields, ack: null };

  // Bare English product names should not lock the session; only lock non-English
  // or an explicit English sentence (handled inside detectLanguage).
  if (detected === "en") {
    return { fields: { preferredLanguage: "en", languageSet: true }, ack: null };
  }

  return {
    fields: { preferredLanguage: detected, languageSet: true },
    ack: null,
  };
}

export function langOf(session: { preferredLanguage?: AppLanguage | null }): AppLanguage {
  return session.preferredLanguage ?? DEFAULT_LANGUAGE;
}
