import fr from "./fr.json";
import en from "./en.json";

type Language = "fr" | "en";
type Translations = typeof fr;

const translations: Record<Language, Translations> = { fr, en };

let currentLang: Language = "fr";

export function setLanguage(lang: Language): void {
  currentLang = lang;
}

export function getLanguage(): Language {
  return currentLang;
}

export function t(key: string, vars?: Record<string, string>): string {
  const keys = key.split(".");
  let value: unknown = translations[currentLang];

  for (const k of keys) {
    if (value && typeof value === "object" && k in value) {
      value = (value as Record<string, unknown>)[k];
    } else {
      return key;
    }
  }

  if (typeof value !== "string") return key;

  if (vars) {
    return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => vars[name] ?? `{{${name}}}`);
  }

  return value;
}
