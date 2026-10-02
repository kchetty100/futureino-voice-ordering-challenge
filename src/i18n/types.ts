/** Languages the kiosk can speak and hear in this MVP. */
export const APP_LANGUAGES = ["en", "es", "he", "fr", "af"] as const;

export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<AppLanguage, string> = {
  en: "English",
  es: "Spanish",
  he: "Hebrew",
  fr: "French",
  af: "Afrikaans",
};

/** ISO-639-1 codes for OpenAI transcription. */
export function sttLanguageCode(language: AppLanguage): string {
  return language;
}

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (APP_LANGUAGES as readonly string[]).includes(value);
}
