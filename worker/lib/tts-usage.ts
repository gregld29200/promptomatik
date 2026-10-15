// Text-to-speech usage log (migrations/0020_tts_usage_log.sql): one row per
// request to a TTS model, full take or free preview. Logging is bookkeeping,
// so a failed write is reported and never fails the teacher's audio.

export type TtsUsageKind = "preview" | "full";

export interface TtsUsageEntry {
  userId: string;
  kind: TtsUsageKind;
  status: "ok" | "failed";
  model: string | null;
  audioSeconds: number;
  charsSent: number;
  cacheHit?: boolean;
  jobId?: string | null;
}

export async function logTtsUsage(db: D1Database, entry: TtsUsageEntry): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO tts_usage_log (user_id, kind, status, model, audio_seconds, chars_sent, cache_hit, job_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        entry.userId,
        entry.kind,
        entry.status,
        entry.model,
        Math.max(0, entry.audioSeconds),
        entry.charsSent,
        entry.cacheHit ? 1 : 0,
        entry.jobId ?? null
      )
      .run();
  } catch (error) {
    console.error("TTS usage log write failed", {
      userId: entry.userId,
      kind: entry.kind,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface PreviewUsage {
  dailyUsed: number;
  monthlyUsed: number;
}

function sqlTimestamp(date: Date): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

// Calendar day and month in UTC, like the monthly audio quota.
function periodStarts(now: Date): { day: string; month: string } {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { day: sqlTimestamp(day), month: sqlTimestamp(month) };
}

// Previews that count toward the caps: voiced by a model (not served from the
// cache) and not failed. `uptoId` counts only the rows before a reservation.
async function countPreviews(db: D1Database, userId: string, now: Date, uptoId?: number): Promise<PreviewUsage> {
  const { day, month } = periodStarts(now);
  const row = await db.prepare(
    `SELECT
       COALESCE(SUM(created_at >= ?), 0) AS daily,
       COUNT(*) AS monthly
     FROM tts_usage_log
     WHERE user_id = ? AND kind = 'preview' AND cache_hit = 0 AND status != 'failed'
       AND created_at >= ? AND id <= ?`
  )
    .bind(day, userId, month, uptoId ?? Number.MAX_SAFE_INTEGER)
    .first<{ daily: number; monthly: number }>();
  return { dailyUsed: row?.daily ?? 0, monthlyUsed: row?.monthly ?? 0 };
}

export function previewUsage(db: D1Database, userId: string, now = new Date()): Promise<PreviewUsage> {
  return countPreviews(db, userId, now);
}

export interface PreviewLimits {
  daily: number;
  monthly: number;
}

export type PreviewReservation =
  | { ok: true; id: number; usage: PreviewUsage }
  | { ok: false; reason: "preview_daily_limit" | "preview_monthly_limit"; usage: PreviewUsage };

// Holds a place under the caps before the model is paid. The row is written
// first and counted with every row before it, so parallel requests each see
// their own rank and cannot all slip under the cap together.
export async function reservePreview(
  db: D1Database,
  userId: string,
  charsSent: number,
  limits: PreviewLimits,
  now = new Date()
): Promise<PreviewReservation> {
  const inserted = await db.prepare(
    `INSERT INTO tts_usage_log (user_id, kind, status, chars_sent, created_at)
     VALUES (?, 'preview', 'pending', ?, ?)
     RETURNING id`
  )
    .bind(userId, charsSent, sqlTimestamp(now))
    .first<{ id: number }>();
  if (!inserted) throw new Error("Preview reservation was not persisted.");

  const usage = await countPreviews(db, userId, now, inserted.id);
  const reason = usage.dailyUsed > limits.daily
    ? "preview_daily_limit"
    : usage.monthlyUsed > limits.monthly
      ? "preview_monthly_limit"
      : null;
  if (reason) {
    await releasePreview(db, inserted.id);
    return { ok: false, reason, usage: { dailyUsed: usage.dailyUsed - 1, monthlyUsed: usage.monthlyUsed - 1 } };
  }
  return { ok: true, id: inserted.id, usage };
}

export async function completePreview(
  db: D1Database,
  id: number,
  model: string,
  audioSeconds: number
): Promise<void> {
  await db.prepare(
    "UPDATE tts_usage_log SET status = 'ok', model = ?, audio_seconds = ? WHERE id = ?"
  )
    .bind(model, Math.max(0, audioSeconds), id)
    .run();
}

// A refused or failed preview gives its place back.
export async function releasePreview(db: D1Database, id: number): Promise<void> {
  await db.prepare("DELETE FROM tts_usage_log WHERE id = ? AND status = 'pending'").bind(id).run();
}
