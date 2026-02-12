import { useSyncExternalStore } from "react";
import fr from "./fr.json";
import en from "./en.json";

type Language = "fr" | "en";
type Translations = typeof fr;

const translations: Record<Language, Translations> = { fr, en };

// Initialize from localStorage
const stored = typeof window !== "undefined" ? localStorage.getItem("lang") : null;
let currentLang: Language = stored === "en" ? "en" : "fr";

const listeners = new Set<() => void>();

function emitChange() {
  for (const fn of listeners) fn();
}

export function setLanguage(lang: Language): void {
  currentLang = lang;
  if (typeof window !== "undefined") {
    localStorage.setItem("lang", lang);
  }
  emitChange();
}

export function getLanguage(): Language {
  return currentLang;
}

export function useLanguage(): [Language, (lang: Language) => void] {
  const lang = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    () => currentLang,
  );
  return [lang, setLanguage];
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
