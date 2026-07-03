import type { Env } from "../env";
import type { AudioQuality } from "./audio-config";

export interface AudioJobCounts {
  total: number;
  ready: number;
  failed: number;
  active: number;
  failureRate: number | null;
}

export interface AudioSpeedStats {
  medianMsPerAudioSecond: number | null;
  sampleCount: number;
}

export interface AudioUserUsage {
  userId: string;
  email: string;
  name: string;
  tier: string;
  includedUsedMonth: number;
  creditsUsed: number;
  creditsRemaining: number;
}

export interface AudioRateLimitPressure {
  windowHours: number;
  segmentsAttempted: number;
  rateLimited: number;
  gatewayErrors: number;
}

export interface AudioAdminMetrics {
  month: string;
  jobs: Record<AudioQuality | "overall", AudioJobCounts>;
  speed: Record<AudioQuality, AudioSpeedStats>;
  cost: {
    cumulativeApiCostUsd: number;
    chargedSeconds: number;
    costPerGeneratedHourUsd: Record<AudioQuality, number | null>;
  };
  users: AudioUserUsage[];
  rateLimitPressure: AudioRateLimitPressure;
}

function emptyCounts(): AudioJobCounts {
  return { total: 0, ready: 0, failed: 0, active: 0, failureRate: null };
}

function toCounts(row: { total: number; ready: number; failed: number }): AudioJobCounts {
  const settled = row.ready + row.failed;
  return {
    total: row.total,
    ready: row.ready,
    failed: row.failed,
    active: row.total - settled,
    failureRate: settled > 0 ? row.failed / settled : null,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function isQuality(value: string): value is AudioQuality {
  return value === "draft" || value === "final";
}

const RATE_LIMIT_WINDOW_HOURS = 24;
const GATEWAY_ERROR_STATUSES = [500, 502, 503, 504, 524];

export async function getAudioAdminMetrics(env: Env, now = new Date()): Promise<AudioAdminMetrics> {
  const month = now.toISOString().slice(0, 7);
  const monthStart = `${month}-01 00:00:00`;
  const rateLimitWindowStart = new Date(now.getTime() - RATE_LIMIT_WINDOW_HOURS * 60 * 60 * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);

  const [countRows, speedRows, costRows, chargedRow, userRows, pressureRow] = await Promise.all([
    env.DB.prepare(
      `SELECT quality,
              COUNT(*) AS total,
              SUM(status = 'ready') AS ready,
              SUM(status = 'failed') AS failed
       FROM audio_jobs
       GROUP BY quality`
    ).all<{ quality: string; total: number; ready: number; failed: number }>(),
    env.DB.prepare(
      `SELECT quality, gen_ms * 1.0 / actual_seconds AS ms_per_audio_second
       FROM audio_jobs
       WHERE status = 'ready'
         AND gen_ms IS NOT NULL
         AND actual_seconds IS NOT NULL
         AND actual_seconds > 0`
    ).all<{ quality: string; ms_per_audio_second: number }>(),
    env.DB.prepare(
      `SELECT quality,
              COALESCE(SUM(api_cost_usd), 0) AS cost_usd,
              COALESCE(SUM(actual_seconds), 0) AS audio_seconds
       FROM audio_jobs
       WHERE status = 'ready'
       GROUP BY quality`
    ).all<{ quality: string; cost_usd: number; audio_seconds: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(-delta_seconds), 0) AS charged
       FROM quota_ledger
       WHERE delta_seconds < 0`
    ).first<{ charged: number }>(),
    env.DB.prepare(
      `SELECT u.id AS user_id,
              u.email,
              u.name,
              u.tier,
              COALESCE(l.included_used_month, 0) AS included_used_month,
              COALESCE(l.credits_used, 0) AS credits_used,
              COALESCE(cb.seconds, 0) AS credits_remaining
       FROM users u
       LEFT JOIN (
         SELECT user_id,
                SUM(CASE WHEN source = 'included' AND delta_seconds < 0 AND created_at >= ?
                         THEN -delta_seconds ELSE 0 END) AS included_used_month,
                SUM(CASE WHEN source = 'credit' AND delta_seconds < 0
                         THEN -delta_seconds ELSE 0 END) AS credits_used
         FROM quota_ledger
         GROUP BY user_id
       ) l ON l.user_id = u.id
       LEFT JOIN credit_balances cb ON cb.user_id = u.id
       ORDER BY included_used_month DESC, u.email`
    ).bind(monthStart).all<{
      user_id: string;
      email: string;
      name: string;
      tier: string;
      included_used_month: number;
      credits_used: number;
      credits_remaining: number;
    }>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS attempted,
              SUM(s.last_error_status = 429) AS rate_limited,
              SUM(s.last_error_status IN (${GATEWAY_ERROR_STATUSES.join(",")})) AS gateway_errors
       FROM audio_segments s
       JOIN audio_jobs j ON j.id = s.job_id
       WHERE s.status IN ('ok', 'failed')
         AND j.created_at >= ?`
    ).bind(rateLimitWindowStart).first<{ attempted: number; rate_limited: number; gateway_errors: number }>(),
  ]);

  const jobs: AudioAdminMetrics["jobs"] = {
    draft: emptyCounts(),
    final: emptyCounts(),
    overall: emptyCounts(),
  };
  const overallRow = { total: 0, ready: 0, failed: 0 };
  for (const row of countRows.results ?? []) {
    if (!isQuality(row.quality)) continue;
    jobs[row.quality] = toCounts(row);
    overallRow.total += row.total;
    overallRow.ready += row.ready;
    overallRow.failed += row.failed;
  }
  jobs.overall = toCounts(overallRow);

  const speedSamples: Record<AudioQuality, number[]> = { draft: [], final: [] };
  for (const row of speedRows.results ?? []) {
    if (!isQuality(row.quality)) continue;
    speedSamples[row.quality].push(row.ms_per_audio_second);
  }

  const cost: AudioAdminMetrics["cost"] = {
    cumulativeApiCostUsd: 0,
    chargedSeconds: chargedRow?.charged ?? 0,
    costPerGeneratedHourUsd: { draft: null, final: null },
  };
  for (const row of costRows.results ?? []) {
    if (!isQuality(row.quality)) continue;
    cost.cumulativeApiCostUsd += row.cost_usd;
    if (row.audio_seconds > 0) {
      cost.costPerGeneratedHourUsd[row.quality] = row.cost_usd / (row.audio_seconds / 3600);
    }
  }

  return {
    month,
    jobs,
    speed: {
      draft: { medianMsPerAudioSecond: median(speedSamples.draft), sampleCount: speedSamples.draft.length },
      final: { medianMsPerAudioSecond: median(speedSamples.final), sampleCount: speedSamples.final.length },
    },
    cost,
    users: (userRows.results ?? []).map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      tier: row.tier,
      includedUsedMonth: row.included_used_month,
      creditsUsed: row.credits_used,
      creditsRemaining: row.credits_remaining,
    })),
    rateLimitPressure: {
      windowHours: RATE_LIMIT_WINDOW_HOURS,
      segmentsAttempted: pressureRow?.attempted ?? 0,
      rateLimited: pressureRow?.rate_limited ?? 0,
      gatewayErrors: pressureRow?.gateway_errors ?? 0,
    },
  };
}

export async function grantAudioCredits(
  env: Env,
  userId: string,
  seconds: number
): Promise<{ credits: number } | null> {
  const user = await env.DB.prepare("SELECT id FROM users WHERE id = ?")
    .bind(userId)
    .first<{ id: string }>();
  if (!user) return null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO credit_balances (user_id, seconds)
       VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET seconds = seconds + excluded.seconds`
    ).bind(userId, seconds),
    env.DB.prepare(
      `INSERT INTO quota_ledger (user_id, delta_seconds, source, reason, job_id)
       VALUES (?, ?, 'credit', 'credit_grant', NULL)`
    ).bind(userId, seconds),
  ]);

  const row = await env.DB.prepare("SELECT seconds FROM credit_balances WHERE user_id = ?")
    .bind(userId)
    .first<{ seconds: number }>();
  return { credits: row?.seconds ?? seconds };
}
