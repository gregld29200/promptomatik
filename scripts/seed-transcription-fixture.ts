// Seed a completed transcription into the LOCAL D1 database.
//
// ---------------------------------------------------------------------------
// DEV ONLY. HOW IT IS GATED FROM PRODUCTION.
// ---------------------------------------------------------------------------
// There is no Groq or Deepgram key in this environment, so nothing can produce
// a real transcript here. This script writes the hand-written fixture from
// `src/components/transcription/transcript-fixture.ts` straight into a job row,
// so the library, the job detail view, rename, delete and the four download
// endpoints can all be exercised end to end without an API key.
//
// It is gated three ways, and none of them is a runtime flag:
//   1. It is a script, not a route. Nothing in the Worker or the SPA can reach
//      it — it is never bundled, never deployed, never served.
//   2. `--local` is hardcoded on every wrangler invocation, and the script
//      refuses to run at all if `--remote` or `--preview` appear in argv. There
//      is no code path here that can address the production database.
//   3. The row it writes is marked in its own title, so a seeded transcript is
//      recognisable on sight and can never be mistaken for provider output.
//
// Usage:
//   npm run transcribe:seed              # seeds for the first user in local D1
//   npm run transcribe:seed -- <userId>  # seeds for a specific user

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  frenchInterviewFixture,
  frenchInterviewWithoutSpeakersFixture,
} from "../src/components/transcription/transcript-fixture";
import type { TranscriptData } from "../src/components/transcription/types";

const DB = "promptomatik-db";

const forbidden = process.argv.slice(2).filter((arg) => arg === "--remote" || arg === "--preview");
if (forbidden.length > 0) {
  console.error(`Refusing to run: this seeder only ever writes to local D1 (${forbidden.join(", ")}).`);
  process.exit(1);
}

function wrangler(args: string[]): string {
  return execFileSync("npx", ["wrangler", "d1", "execute", DB, "--local", "--json", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "inherit"],
  });
}

/** wrangler --json wraps results in an array of `{ results: [...] }` batches. */
function queryRows<T>(sql: string): T[] {
  const raw = wrangler(["--command", sql]);
  const start = raw.indexOf("[");
  if (start < 0) return [];
  const parsed = JSON.parse(raw.slice(start)) as { results?: T[] }[];
  return parsed.flatMap((batch) => batch.results ?? []);
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function resolveUserId(): string {
  const explicit = process.argv.slice(2).find((arg) => !arg.startsWith("-"));
  if (explicit) return explicit;

  const rows = queryRows<{ id: string; email: string }>(
    "SELECT id, email FROM users ORDER BY created_at ASC LIMIT 1"
  );
  if (rows.length === 0) {
    console.error("No users in local D1. Run `npm run db:migrate && npm run seed` first.");
    process.exit(1);
  }
  console.log(`Seeding for ${rows[0].email}`);
  return rows[0].id;
}

interface SeedSpec {
  id: string;
  title: string;
  transcript: TranscriptData;
  diarizeRequested: boolean;
  sourceKind: "podcast" | "upload";
  sourceUrl: string | null;
  /**
   * Days left before the 7-day retention deletes this transcript. The two rows
   * deliberately sit on opposite sides of the "urgent" threshold, so the calm
   * countdown and the loud one can both be looked at without waiting a week.
   */
  expiresInDays: number;
  /** `TranscriptionRouteReason` — what the cascade recorded. */
  providerChoiceReason: string;
}

/**
 * Two rows, because the two provider paths look genuinely different to a
 * teacher: Deepgram with speaker turns, and Groq with none at all even though
 * speakers were requested — the state most likely to look like a bug if the
 * reading UI is careless about it.
 */
const SEEDS: SeedSpec[] = [
  {
    id: "seed-transcription-diarized",
    title: "[fixture] Entretien avec Claire — voix séparées",
    transcript: frenchInterviewFixture,
    diarizeRequested: true,
    sourceKind: "podcast",
    sourceUrl: "https://example.com/feed.xml",
    expiresInDays: 6,
    providerChoiceReason: "diarization_required",
  },
  {
    id: "seed-transcription-flat",
    title: "[fixture] Même audio, moteur rapide (sans voix)",
    transcript: frenchInterviewWithoutSpeakersFixture,
    diarizeRequested: true,
    sourceKind: "upload",
    sourceUrl: null,
    expiresInDays: 1,
    providerChoiceReason: "groq_free_tier",
  },
];

function insertStatement(userId: string, seed: SeedSpec): string {
  const { metadata } = seed.transcript;
  const payload = JSON.stringify({
    source:
      seed.sourceKind === "upload"
        ? {
            kind: "upload",
            r2Key: `transcription/uploads/${userId}/${seed.id}/fixture.mp3`,
            filename: "fixture.mp3",
            contentType: "audio/mpeg",
            bytes: 2_400_000,
          }
        : { kind: "podcast", url: seed.sourceUrl },
    diarize: seed.diarizeRequested,
    languageHint: null,
    title: seed.title,
  });
  const billed = Math.ceil(metadata.durationSeconds);

  return `
DELETE FROM transcription_jobs WHERE id = ${sqlString(seed.id)};
INSERT INTO transcription_jobs (
  id, user_id, status, source_kind, source_url, resolved_url, source_r2_key,
  source_content_type, source_bytes, title, requested_provider, diarize_requested,
  provider, provider_model, provider_job_id, provider_choice_reason, diarization,
  detected_language, detected_languages, duration_seconds, billed_seconds,
  request_payload, result_payload, started_at, completed_at, expires_at
) VALUES (
  ${sqlString(seed.id)},
  ${sqlString(userId)},
  'completed',
  ${sqlString(seed.sourceKind)},
  ${seed.sourceUrl ? sqlString(seed.sourceUrl) : "NULL"},
  ${seed.sourceUrl ? sqlString(seed.sourceUrl) : "NULL"},
  ${seed.sourceKind === "upload" ? sqlString(`transcription/uploads/${userId}/${seed.id}/fixture.mp3`) : "NULL"},
  ${seed.sourceKind === "upload" ? "'audio/mpeg'" : "NULL"},
  ${seed.sourceKind === "upload" ? "2400000" : "NULL"},
  ${sqlString(seed.title)},
  ${sqlString(metadata.provider)},
  ${seed.diarizeRequested ? 1 : 0},
  ${sqlString(metadata.provider)},
  ${sqlString(metadata.model)},
  ${sqlString(metadata.providerJobId ?? "fixture")},
  ${sqlString(seed.providerChoiceReason)},
  ${metadata.diarization ? 1 : 0},
  ${sqlString(metadata.detectedLanguages[0] ?? "fr")},
  ${sqlString(JSON.stringify(metadata.detectedLanguages))},
  ${billed},
  ${billed},
  ${sqlString(payload)},
  ${sqlString(JSON.stringify(seed.transcript))},
  datetime('now'),
  datetime('now'),
  ${sqlString(new Date(Date.now() + seed.expiresInDays * 86_400_000).toISOString())}
);`;
}

const userId = resolveUserId();
const sql = SEEDS.map((seed) => insertStatement(userId, seed)).join("\n");

// The transcript JSON is far too large for a shell argument, so the statements
// go through a temp file rather than `--command`.
const file = join(mkdtempSync(join(tmpdir(), "transcription-seed-")), "seed.sql");
writeFileSync(file, sql, "utf-8");
wrangler([`--file=${file}`]);

console.log(`Seeded ${SEEDS.length} fixture transcripts. Open /transcribe/library.`);
