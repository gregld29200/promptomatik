// Shared display helpers for audio takes (studio page + library page).

import { t } from "@/lib/i18n";
import { SPEAKER_LABEL_WORDS } from "@/lib/audio-script-rules";
import type { AudioJob, AudioMode, AudioQuality } from "@/lib/api";

const SPEAKER_LABEL_RE = new RegExp(`^(${SPEAKER_LABEL_WORDS})\\s+\\d+\\s*:`, "gim");

export function stripTags(text: string) {
  return text.replace(/\[[^\]]+\]/g, " ");
}

export function scriptTitle(script: string) {
  const clean = stripTags(script)
    .replace(SPEAKER_LABEL_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return t("audio.untitled");
  const words = clean.split(" ").slice(0, 8).join(" ");
  return clean.split(" ").length > 8 ? `${words}...` : words;
}

// Display title for a take: the user-chosen name wins, else the derived
// script excerpt (historic behaviour).
export function takeTitle(job: Pick<AudioJob, "title" | "script">) {
  return job.title?.trim() || scriptTitle(job.script);
}

export function qualityLabel(quality: AudioQuality) {
  return quality === "final" ? t("audio.final") : t("audio.draft");
}

export function modeLabel(mode: AudioMode) {
  return mode === "dialogue" ? t("audio.dialogue") : t("audio.monologue");
}

export function formatShort(seconds: number) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return minutes > 0 ? `${minutes} min ${rest}s` : `${rest}s`;
}

export function expiresLabel(expiresAt: string | null) {
  if (!expiresAt) return "";
  const days = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return t("audio.expires_today");
  return t("audio.expires_in_days", { days: String(days) });
}

// A ready take whose files have been removed by the 7-day R2 lifecycle.
export function isExpired(job: AudioJob) {
  return job.status === "ready" && Boolean(job.expiresAt) && new Date(job.expiresAt as string).getTime() < Date.now();
}
