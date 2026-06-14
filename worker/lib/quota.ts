import type { Env } from "../env";

/**
 * Daily interview-generation quota for free-tier users.
 * Counters live in KV, keyed by UTC day — a new day means a new key,
 * so the quota "resets" at UTC midnight without any cron. KV is eventually
 * consistent: racing requests may squeeze an extra interview. Accepted —
 * this is a cost guardrail, not security.
 */

export const DAILY_INTERVIEW_LIMIT = 5;

// Outlives its UTC day comfortably, then self-deletes.
const QUOTA_TTL_SECONDS = 172_800;

function quotaKey(userId: string): string {
  const utcDay = new Date().toISOString().slice(0, 10);
  return `quota:interview:${userId}:${utcDay}`;
}

export async function getInterviewQuotaUsed(env: Env, userId: string): Promise<number> {
  const raw = await env.SESSIONS.get(quotaKey(userId));
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export async function incrementInterviewQuota(env: Env, userId: string): Promise<number> {
  const used = await getInterviewQuotaUsed(env, userId);
  await env.SESSIONS.put(quotaKey(userId), String(used + 1), {
    expirationTtl: QUOTA_TTL_SECONDS,
  });
  return used + 1;
}

export function nextUtcMidnightIso(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  ).toISOString();
}
