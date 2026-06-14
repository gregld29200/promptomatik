import { getLanguage } from "@/lib/i18n";

export function formatDate(dateStr: string): string {
  const locale = {
    fr: "fr-FR",
    en: "en-US",
    es: "es-ES",
  }[getLanguage()];

  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(dateStr));
}
