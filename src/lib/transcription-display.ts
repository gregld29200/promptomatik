// Shared display helpers for the Transcription Studio (page + library).
//
// Same role as `audio-display.ts`: the two pages must say the same thing about
// the same job, so every label a teacher reads is produced here once.
//
// Nothing in this file decides anything — the Worker is authoritative on
// limits, statuses and failures. The three constants below are copies of the
// Worker contract used for pre-flight feedback (refusing a 300 MB file before
// uploading it) and as fallbacks when a stored failure lost its numbers.
// `transcription-display.test.ts` asserts each of them against the Worker's own
// value, so none of them can drift.

import { t } from "@/lib/i18n";
import type {
  ApiError,
  TranscriptionFailure,
  TranscriptionFailureCode,
  TranscriptionJob,
  TranscriptionJobStatus,
  TranscriptionJobSummary,
  TranscriptionSourceKind,
} from "@/lib/api";

/**
 * Mirrors TRANSCRIPTION_MAX_UPLOAD_BYTES in worker/lib/transcription/types.ts —
 * set by the Worker's memory, not by the providers: an uploaded file is read out
 * of R2 into a 128 MB isolate before it is posted.
 *
 * DECIMAL megabytes, like the Worker's constant and like Finder: see the note
 * there. `transcription-display.test.ts` asserts this equals the Worker's own
 * value, so the two cannot drift — a comment saying "keep them in step" is not a
 * mechanism, and a UI refusing at a different number than the server is a limit
 * sentence that lies.
 */
export const MAX_UPLOAD_BYTES = 64 * 1_000_000;
/** Mirrors TRANSCRIPTION_MAX_SOURCE_SECONDS — 90 minutes, link or file. */
export const MAX_SOURCE_SECONDS = 5_400;
/**
 * Mirrors TRANSCRIPTION_RETENTION_DAYS — a transcript is kept a week, then the
 * nightly purge deletes it. This is the `{{days}}` in `retention_notice` and
 * `expired_body`, i.e. a promise made to a teacher in three languages, so it is
 * pinned against the Worker's constant by the same parity test as the two above.
 */
export const RETENTION_DAYS = 7;

const FAILURE_CODES: ReadonlySet<string> = new Set<TranscriptionFailureCode>([
  "unsupported_source",
  "youtube_not_yet_supported",
  "youtube_unavailable",
  "youtube_blocked",
  "spotify_not_supported",
  "source_unreachable",
  "no_audio_found",
  "source_too_long",
  "source_too_large",
  "unsupported_media_type",
  "provider_unavailable",
  "provider_failed",
  "quota_exceeded",
  "internal",
]);

export function isTranscriptionFailureCode(value: unknown): value is TranscriptionFailureCode {
  return typeof value === "string" && FAILURE_CODES.has(value);
}

/** Terminal statuses stop the poll. Everything else keeps it running. */
export function isTerminalStatus(status: TranscriptionJobStatus): boolean {
  return status === "completed" || status === "failed";
}

/**
 * A length a teacher reads aloud: "1 h 12" past the hour, "18 min" below it,
 * and "moins d'une minute" for the short tail rather than a bare "0 min".
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return t("transcription.duration_unknown");
  }
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);
  if (hours > 0) {
    return t("transcription.duration_hours_minutes", {
      hours: String(hours),
      minutes: String(minutes).padStart(2, "0"),
    });
  }
  return t("transcription.duration_minutes", { minutes: String(Math.max(minutes, safe > 0 ? 1 : 0)) });
}

/**
 * Megabytes, one decimal below 10 MB — the scale a teacher's file lives on.
 *
 * DECIMAL (1,000,000), not binary. Finder and the iOS Files app both report
 * decimal megabytes, and a teacher checking why their file was refused reads our
 * number next to theirs. Dividing by 1024² made every figure ~5 % smaller than
 * the one on their own screen.
 */
export function formatBytes(bytes: number | null | undefined): string {
  const safe = Number.isFinite(bytes ?? Number.NaN) ? Math.max(0, bytes ?? 0) : 0;
  const mb = safe / 1_000_000;
  const value = mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10;
  return `${value} ${t("transcription.unit_megabytes")}`;
}

export function statusLabel(status: TranscriptionJobStatus): string {
  return t(`transcription.status_${status}`);
}

/** The sentence under the status. Five waits, five explanations. */
export function statusHint(status: TranscriptionJobStatus): string {
  return status === "failed" ? t("transcription.error_title") : t(`transcription.status_hint_${status}`);
}

export function sourceKindLabel(kind: TranscriptionSourceKind): string {
  return t(`transcription.kind_${kind}`);
}

/**
 * Where the media came from, when the caller knows.
 *
 * It changes what a refusal can honestly ask the teacher to do — see
 * `error_source_too_long` below. Omitted, the wording stays the file wording,
 * which is the safe default because it is the one the teacher can always act on.
 */
export interface FailureContext {
  sourceKind?: TranscriptionSourceKind | null;
}

/** A pasted link or a podcast episode: the media is on someone else's server. */
function isRemoteSource(context: FailureContext | undefined): boolean {
  return context?.sourceKind !== undefined && context.sourceKind !== null && context.sourceKind !== "upload";
}

/**
 * The warm sentence for a machine failure code. Codes that carry numbers get a
 * specific message; everything else gets its own line of copy. `error.code` is
 * never rendered raw.
 */
export function failureMessage(failure: TranscriptionFailure, context?: FailureContext): string {
  switch (failure.code) {
    case "source_too_long":
      // The 90 minutes are enforced identically on a link and on a file, but only
      // one of those can be "cut in two and run again". Telling a teacher to trim
      // an episode hosted on someone else's server is an instruction they cannot
      // follow, so the remote variant names what they actually can do.
      return t(
        isRemoteSource(context)
          ? "transcription.error_source_too_long_link"
          : "transcription.error_source_too_long",
        {
          duration: formatDuration(failure.durationSeconds),
          max: formatDuration(failure.maxSeconds ?? MAX_SOURCE_SECONDS),
        }
      );
    case "source_too_large":
      return t("transcription.error_source_too_large", {
        size: formatBytes(failure.bytes),
        max: formatBytes(failure.maxBytes ?? MAX_UPLOAD_BYTES),
      });
    case "quota_exceeded":
      return t("transcription.error_quota_exceeded", {
        remaining: formatDuration(Math.max(0, failure.remainingSeconds ?? 0)),
      });
    default:
      return t(`transcription.error_${failure.code}`);
  }
}

/**
 * Turns any API error into something a teacher can act on. A transcription
 * endpoint sends a `failure` object; a timeout or a dropped connection does
 * not, and gets the network sentence rather than an English string from the
 * fetch layer.
 */
export function apiErrorMessage(error: ApiError, context?: FailureContext): string {
  if (error.failure) return failureMessage(error.failure, context);
  if (isTranscriptionFailureCode(error.code)) return failureMessage({ code: error.code }, context);
  // The feed picker is rate-limited per minute. It is not a TranscriptionFailure
  // code (nothing about the source is wrong), so it gets its own sentence rather
  // than the generic one, which would leave the teacher with nothing to do.
  if (error.code === "rate_limited") return t("transcription.error_rate_limited");
  // 410 from a download link the page had not refreshed yet. Not a
  // TranscriptionFailure code — nothing is wrong with the source — so it gets the
  // retention sentence rather than "the connection failed".
  if (error.code === "transcript_expired") return expiredBody();
  return t("transcription.error_generic");
}

/** Absolute date, in the interface language. Used for the quota reset line. */
export function formatDate(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(language, { day: "numeric", month: "long" });
}

/**
 * Date AND time, for the `title` a countdown carries.
 *
 * "Expire dans 1 jour" is the right thing to read at a glance and the wrong thing
 * to plan around, so the exact moment is one hover (or one screen-reader stop)
 * away — the same pairing the Audio Studio uses on its takes.
 */
export function formatExactMoment(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(language, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Retention — the seven days a transcript lives
// ---------------------------------------------------------------------------
//
// This matters more here than in the Audio Studio, and the difference is worth
// stating: an audio take expires but its SCRIPT is kept forever, so an expired
// take can be regenerated. A transcript IS the deliverable. A teacher who does
// not download it loses the thing they came for, and re-running it spends their
// monthly hours again. So the countdown is prominent, the nudge to download gets
// louder as the deadline nears, and an expired row never offers a dead button.

/** How close a transcript is to its deadline. Drives the tone, not the wording. */
export type ExpiryUrgency = "expired" | "urgent" | "soon" | "calm";

/** Anything at or inside this many days is "urgent" and says so loudly. */
const URGENT_DAYS = 2;
/** Below this, the nudge is visible but calm. */
const SOON_DAYS = 4;

/** Whole days left, rounded up, so a transcript with six hours left reads "1". */
export function daysUntilExpiry(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  return Math.ceil((at - Date.now()) / 86_400_000);
}

/**
 * Has this transcript's week run out?
 *
 * The Worker sends `expired`, computed from the same date with the same rule, and
 * that flag wins: it is the one that decides whether a transcript and its
 * downloads were actually served. The local arithmetic is the fallback for a
 * payload that predates the field.
 */
export function isTranscriptExpired(
  job: Pick<TranscriptionJob | TranscriptionJobSummary, "status" | "expiresAt" | "expired">
): boolean {
  if (job.expired) return true;
  if (job.status !== "completed" || !job.expiresAt) return false;
  return new Date(job.expiresAt).getTime() < Date.now();
}

export function expiryUrgency(expiresAt: string | null): ExpiryUrgency {
  const days = daysUntilExpiry(expiresAt);
  if (days === null) return "calm";
  if (days <= 0) return "expired";
  if (days <= URGENT_DAYS) return "urgent";
  if (days <= SOON_DAYS) return "soon";
  return "calm";
}

/**
 * "Expire dans 6 jours" — the countdown itself, and nothing else.
 *
 * Same arithmetic as `expiresLabel` in audio-display.ts on purpose: a teacher who
 * has both an audio take and a transcript expiring should not have to work out
 * whether the two "3 jours" mean the same thing.
 */
export function expiresLabel(expiresAt: string | null): string {
  const days = daysUntilExpiry(expiresAt);
  if (days === null) return "";
  if (days <= 0) return t("transcription.expires_today");
  if (days === 1) return t("transcription.expires_in_one_day");
  return t("transcription.expires_in_days", { days: String(days) });
}

/**
 * The calm statement of the policy, and the sentence an expired transcript gets.
 *
 * Both take the day count from `RETENTION_DAYS` rather than spelling "7" into
 * three translation files — a retention window that changes in the Worker and not
 * in the copy is how an interface starts lying.
 */
export function retentionNotice(): string {
  return t("transcription.retention_notice", { days: String(RETENTION_DAYS) });
}

export function expiredBody(): string {
  return t("transcription.expired_body", { days: String(RETENTION_DAYS) });
}

/** The nudge under the countdown. Louder the closer the deadline is. */
export function downloadNudge(expiresAt: string | null): string {
  return expiryUrgency(expiresAt) === "urgent"
    ? t("transcription.retention_nudge_urgent")
    : t("transcription.retention_nudge");
}

// ---------------------------------------------------------------------------
// The two limits a teacher can hit, checked before anything is uploaded
// ---------------------------------------------------------------------------

/**
 * A file over the 64 MB ceiling, refused the moment it is picked.
 *
 * Returns the sentence to show, or null when the file is fine. The message names
 * what to DO — paste the link to the audio instead, or upload a shorter extract —
 * because "your file is too big" leaves a teacher with a file and no next step.
 */
export function fileSizeWarning(file: File): string | null {
  if (file.size <= MAX_UPLOAD_BYTES) return null;
  return t("transcription.limit_file_too_large", {
    size: formatBytes(file.size),
    max: formatBytes(MAX_UPLOAD_BYTES),
  });
}

/**
 * A recording over the 90-minute cap, measured in the browser from the file's own
 * metadata (see `readMediaDuration`) rather than after an upload the teacher
 * watched complete.
 */
export function fileDurationWarning(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds <= MAX_SOURCE_SECONDS) return null;
  return t("transcription.limit_file_too_long", {
    duration: formatDuration(seconds),
    max: formatDuration(MAX_SOURCE_SECONDS),
  });
}

/**
 * The media's length, read from its own header without uploading it.
 *
 * Best-effort by design: a container the browser cannot decode resolves to null
 * and the Worker stays the authority. This exists to spare a teacher a ten-minute
 * upload that was always going to be refused, not to become a second gate.
 */
export function readMediaDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof window.Audio !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(value);
    };
    // A stalled decode must never leave the form waiting on us.
    const timer = window.setTimeout(() => finish(null), 5_000);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      window.clearTimeout(timer);
      finish(Number.isFinite(audio.duration) ? audio.duration : null);
    };
    audio.onerror = () => {
      window.clearTimeout(timer);
      finish(null);
    };
    audio.src = url;
  });
}
