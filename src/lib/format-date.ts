import { getLanguage } from "@/lib/i18n";

export function formatDate(dateStr: string): string {
  return new Intl.DateTimeFormat(getLanguage() === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(dateStr));
}
