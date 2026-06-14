export const SUPPORTED_LANGUAGES = ["fr", "en", "es"] as const;

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: Language = "fr";

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && SUPPORTED_LANGUAGES.includes(value as Language);
}

export function normalizeLanguage(value: unknown): Language {
  if (isLanguage(value)) {
    return value as Language;
  }
  return DEFAULT_LANGUAGE;
}

export function languageName(language: Language): string {
  switch (language) {
    case "fr":
      return "French";
    case "en":
      return "English";
    case "es":
      return "Spanish";
  }
}
