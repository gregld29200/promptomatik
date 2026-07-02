import type { Env } from "../env";

export const AUDIO_INCLUDED_SECONDS_PER_MONTH = 3_600;

const AUDIO_QUOTA_TTL_SECONDS = 60 * 60 * 24 * 45;
const PRECHECK_BUFFER_MULTIPLIER = 1.2;

export type AudioQuotaChargeReason = "generation" | "regeneration";

export interface AudioQuotaBalance {
  includedLimit: number;
  includedUsed: number;
  includedRemaining: number;
  credits: number;
  totalRemaining: number;
  month: string;
  monthResetsOn: string;
}

export type AudioQuotaPrecheck =
  | { ok: true; balance: AudioQuotaBalance }
  | {
      ok: false;
      balance: AudioQuotaBalance;
      estimatedSeconds: number;
      allowedSeconds: number;
      reason: "audio_quota_exceeded";
    };

interface AudioQuotaOptions {
  now?: Date;
}

function monthKeyDate(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function audioQuotaKey(userId: string, now = new Date()): string {
  return `audioq:${userId}:${monthKeyDate(now)}`;
}

function nextMonthStartIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  ).toISOString();
}

function normalizeSeconds(value: unknown): number {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

async function getIncludedUsed(env: Env, userId: string, now: Date): Promise<number> {
  const raw = await env.SESSIONS.get(audioQuotaKey(userId, now));
  return normalizeSeconds(raw);
}

async function getCredits(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare("SELECT seconds FROM credit_balances WHERE user_id = ?")
    .bind(userId)
    .first<{ seconds: number }>();
  return normalizeSeconds(row?.seconds ?? 0);
}

export async function getAudioQuotaBalance(
  env: Env,
  userId: string,
  options: AudioQuotaOptions = {}
): Promise<AudioQuotaBalance> {
  const now = options.now ?? new Date();
  const includedUsed = await getIncludedUsed(env, userId, now);
  const credits = await getCredits(env.DB, userId);
  const includedRemaining = Math.max(0, AUDIO_INCLUDED_SECONDS_PER_MONTH - includedUsed);

  return {
    includedLimit: AUDIO_INCLUDED_SECONDS_PER_MONTH,
    includedUsed,
    includedRemaining,
    credits,
    totalRemaining: includedRemaining + credits,
    month: monthKeyDate(now),
    monthResetsOn: nextMonthStartIso(now),
  };
}

export async function precheckAudioQuota(
  env: Env,
  userId: string,
  estimatedSeconds: number,
  options: AudioQuotaOptions = {}
): Promise<AudioQuotaPrecheck> {
  const roundedEstimate = Math.ceil(Math.max(0, estimatedSeconds));
  const balance = await getAudioQuotaBalance(env, userId, options);
  const allowedSeconds = Math.floor(balance.totalRemaining * PRECHECK_BUFFER_MULTIPLIER);

  if (roundedEstimate > allowedSeconds) {
    return {
      ok: false,
      balance,
      estimatedSeconds: roundedEstimate,
      allowedSeconds,
      reason: "audio_quota_exceeded",
    };
  }

  return { ok: true, balance };
}

export async function chargeAudioQuota(
  env: Env,
  userId: string,
  jobId: string,
  seconds: number,
  reason: AudioQuotaChargeReason,
  options: AudioQuotaOptions = {}
): Promise<AudioQuotaBalance> {
  const now = options.now ?? new Date();
  const chargeSeconds = Math.ceil(Math.max(0, seconds));
  if (chargeSeconds === 0) {
    return getAudioQuotaBalance(env, userId, { now });
  }

  const balance = await getAudioQuotaBalance(env, userId, { now });
  if (chargeSeconds > balance.totalRemaining) {
    throw new Error("Insufficient audio quota.");
  }

  const includedSeconds = Math.min(chargeSeconds, balance.includedRemaining);
  const creditSeconds = chargeSeconds - includedSeconds;

  const statements: D1PreparedStatement[] = [];
  if (includedSeconds > 0) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO quota_ledger (user_id, delta_seconds, source, reason, job_id)
         VALUES (?, ?, 'included', ?, ?)`
      ).bind(userId, -includedSeconds, reason, jobId)
    );
  }

  if (creditSeconds > 0) {
    statements.push(
      env.DB.prepare(
        `UPDATE credit_balances
         SET seconds = seconds - ?
         WHERE user_id = ? AND seconds >= ?`
      ).bind(creditSeconds, userId, creditSeconds),
      env.DB.prepare(
        `INSERT INTO quota_ledger (user_id, delta_seconds, source, reason, job_id)
         VALUES (?, ?, 'credit', ?, ?)`
      ).bind(userId, -creditSeconds, reason, jobId)
    );
  }

  if (statements.length > 0) {
    const results = await env.DB.batch(statements);
    if (creditSeconds > 0) {
      const creditUpdate = results[includedSeconds > 0 ? 1 : 0];
      if (!creditUpdate?.meta.changes) {
        throw new Error("Insufficient audio credits.");
      }
    }
  }

  if (includedSeconds > 0) {
    await env.SESSIONS.put(
      audioQuotaKey(userId, now),
      String(balance.includedUsed + includedSeconds),
      { expirationTtl: AUDIO_QUOTA_TTL_SECONDS }
    );
  }

  return getAudioQuotaBalance(env, userId, { now });
}
