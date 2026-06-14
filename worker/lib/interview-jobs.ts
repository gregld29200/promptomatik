import type { Env } from "../env";
import {
  promptAssemblyPrompt,
  promptRefinementPrompt,
} from "./llm/prompts";
import type {
  AssembleResult,
  AssembledPrompt,
  IntentAnalysis,
  InterviewQuestion,
  RefinedPrompt,
} from "./llm/types";
import { chatCompletion, type LLMCallMeta } from "./openrouter";
import { normalizeQuestions } from "./interview-normalization";
import type { TeacherProfile } from "../routes/profile";
import { normalizeLanguage, type Language } from "./language";
import { normalizeTier, type Tier } from "./tier";
import {
  intentAnalysisPrompt,
  interviewQuestionsPrompt,
} from "./llm/prompts";

export type InterviewJobKind = "analyze" | "questions" | "assemble" | "refine";
export type InterviewJobStatus = "queued" | "processing" | "completed" | "failed";

// `tier` is resolved at enqueue time and carried in the payload — never
// re-queried at consume time. Optional because jobs enqueued before the
// tiering deploy lack it; those default to participant behavior.
export interface AnalyzeJobRequest {
  text: string;
  language: Language;
  tier?: Tier;
}

export interface QuestionsJobRequest {
  intent: IntentAnalysis;
  language: Language;
  tier?: Tier;
}

export interface AssembleJobRequest {
  intent: IntentAnalysis;
  answers: Record<string, string>;
  original_text: string;
  language: Language;
  tier?: Tier;
}

export interface RefineJobRequest {
  promptId: string;
  issueType: string;
  issueDescription?: string;
  outputSample?: string;
  language: Language;
  tier?: Tier;
}

const ANALYZE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 35_000,
  totalTimeoutMs: 90_000,
  modelAttempts: 1,
} as const;

const QUESTIONS_JOB_TIMEOUTS = {
  attemptTimeoutMs: 35_000,
  totalTimeoutMs: 90_000,
  modelAttempts: 1,
} as const;

const ASSEMBLE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 120_000,
  totalTimeoutMs: 360_000,
  modelAttempts: 2,
} as const;

const REFINE_JOB_TIMEOUTS = {
  attemptTimeoutMs: 120_000,
  totalTimeoutMs: 360_000,
  modelAttempts: 2,
} as const;

export interface InterviewJobMessage {
  jobId: string;
}

interface InterviewJobRow {
  id: string;
  user_id: string;
  kind: InterviewJobKind;
  status: InterviewJobStatus;
  request_payload: string;
  result_payload: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InterviewJobResponse<T = unknown> {
  id: string;
  kind: InterviewJobKind;
  status: InterviewJobStatus;
  result: T | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface JobExecutionResult<T> {
  result: T | null;
  error: string | null;
  llmMeta?: LLMCallMeta;
}

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function normalizeModelName(name?: string): string | undefined {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

// Jobs enqueued before the tiering deploy have no tier in the payload —
// they were all created by invited (participant) users.
function isParticipantJob(tier?: Tier): boolean {
  return tier === undefined || normalizeTier(tier) === "participant";
}

// Tier-aware model routing: participants get the premium model first
// (current behavior); free-tier jobs run the economy/fallback model first,
// with the premium model as their fallback.
function llmModels(env: Env, tier?: Tier): { primaryModel?: string; fallbackModel?: string } {
  const premium = normalizeModelName(env.OPENROUTER_MODEL);
  const economy = normalizeModelName(env.OPENROUTER_FALLBACK_MODEL);

  if (!isParticipantJob(tier)) {
    return { primaryModel: economy, fallbackModel: premium };
  }
  return { primaryModel: premium, fallbackModel: economy };
}

function logInterviewJobEvent(
  event: string,
  details: Record<string, unknown>
): void {
  console.info(event, details);
}

function llmLogDetails(meta?: LLMCallMeta): Record<string, unknown> {
  if (!meta) return {};
  return {
    llmProvider: meta.provider,
    llmModel: meta.model,
    llmUsedFallbackModel: meta.usedFallbackModel,
    llmAttempts: meta.attempts,
    llmDurationMs: meta.totalDurationMs,
  };
}

async function fetchProfile(db: D1Database, userId: string): Promise<TeacherProfile | undefined> {
  const row = await db.prepare("SELECT profile FROM users WHERE id = ?")
    .bind(userId)
    .first<{ profile: string }>();

  if (!row) return undefined;

  const parsed = JSON.parse(row.profile) as TeacherProfile;
  return parsed.setup_completed ? parsed : undefined;
}

function rowToInterviewJob<T>(row: InterviewJobRow): InterviewJobResponse<T> {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    result: row.result_payload ? JSON.parse(row.result_payload) as T : null,
    error: row.error_message,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function getJobRow(db: D1Database, id: string): Promise<InterviewJobRow | null> {
  return await db.prepare("SELECT * FROM interview_jobs WHERE id = ?")
    .bind(id)
    .first<InterviewJobRow>();
}

async function markProcessing(db: D1Database, id: string): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE interview_jobs
     SET status = 'processing',
         error_message = NULL,
         started_at = COALESCE(started_at, ?),
         updated_at = ?
     WHERE id = ?`
  )
    .bind(now, now, id)
    .run();
}

async function markQueued(db: D1Database, id: string, error: string): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE interview_jobs
     SET status = 'queued',
         error_message = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(error, now, id)
    .run();
}

async function markCompleted<T>(db: D1Database, id: string, result: T): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE interview_jobs
     SET status = 'completed',
         result_payload = ?,
         error_message = NULL,
         completed_at = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(JSON.stringify(result), now, now, id)
    .run();
}

async function markFailed(db: D1Database, id: string, error: string): Promise<void> {
  const now = nowSql();
  await db.prepare(
    `UPDATE interview_jobs
     SET status = 'failed',
         error_message = ?,
         completed_at = ?,
         updated_at = ?
     WHERE id = ?`
  )
    .bind(error, now, now, id)
    .run();
}

export async function failInterviewJob(db: D1Database, id: string, error: string): Promise<void> {
  await markFailed(db, id, error);
}

export async function createInterviewJob(
  db: D1Database,
  userId: string,
  kind: InterviewJobKind,
  requestPayload: AnalyzeJobRequest | QuestionsJobRequest | AssembleJobRequest | RefineJobRequest
): Promise<InterviewJobResponse> {
  const id = crypto.randomUUID();
  const now = nowSql();

  await db.prepare(
    `INSERT INTO interview_jobs (
      id,
      user_id,
      kind,
      status,
      request_payload,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'queued', ?, ?, ?)`
  )
    .bind(id, userId, kind, JSON.stringify(requestPayload), now, now)
    .run();

  const row = await getJobRow(db, id);
  if (!row) {
    throw new Error("Interview job was not persisted.");
  }

  return rowToInterviewJob(row);
}

export async function enqueueInterviewJob(env: Env, jobId: string): Promise<void> {
  await env.INTERVIEW_JOBS_QUEUE.send({ jobId }, { contentType: "json" });
}

export async function getInterviewJobForUser<T>(
  db: D1Database,
  jobId: string,
  userId: string
): Promise<InterviewJobResponse<T> | null> {
  const row = await db.prepare(
    "SELECT * FROM interview_jobs WHERE id = ? AND user_id = ?"
  )
    .bind(jobId, userId)
    .first<InterviewJobRow>();

  return row ? rowToInterviewJob<T>(row) : null;
}

async function processAnalyzeJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: AnalyzeJobRequest
): Promise<JobExecutionResult<IntentAnalysis>> {
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env, payload.tier);

  const completion = await chatCompletion<IntentAnalysis>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: intentAnalysisPrompt(lang, profile) },
        { role: "user", content: payload.text.trim() },
      ],
      temperature: 0.3,
    },
    models,
    {
      ...ANALYZE_JOB_TIMEOUTS,
      logContext: {
        operation: "interview.analyze",
        jobId,
        jobKind: "analyze",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  return { result: completion.data, error: null, llmMeta: completion.meta };
}

async function processQuestionsJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: QuestionsJobRequest
): Promise<JobExecutionResult<{ questions: InterviewQuestion[] }>> {
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env, payload.tier);

  const userMessage = `Here is the intent analysis:
${JSON.stringify(payload.intent, null, 2)}

Missing fields to ask about: ${payload.intent.missing_fields.join(", ")}

Generate questions ONLY for the missing fields listed above.`;

  const completion = await chatCompletion<{ questions: InterviewQuestion[] }>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: interviewQuestionsPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.6,
    },
    models,
    {
      ...QUESTIONS_JOB_TIMEOUTS,
      logContext: {
        operation: "interview.questions",
        jobId,
        jobKind: "questions",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  return {
    result: { questions: normalizeQuestions(completion.data.questions) },
    error: null,
    llmMeta: completion.meta,
  };
}

async function processAssembleJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: AssembleJobRequest
): Promise<JobExecutionResult<AssembleResult>> {
  const lang = normalizeLanguage(payload.language);
  // Profile context is a participant feature — never injected for free-tier jobs.
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env, payload.tier);

  const userMessage = `Original teacher request:
"${payload.original_text}"

Intent analysis:
${JSON.stringify(payload.intent, null, 2)}

Teacher's answers to follow-up questions:
${JSON.stringify(payload.answers ?? {}, null, 2)}

Assemble a complete, ready-to-use teaching prompt using the appropriate techniques.`;

  const completion = await chatCompletion<AssembleResult>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: promptAssemblyPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.5,
      max_tokens: 4096,
    },
    models,
    {
      ...ASSEMBLE_JOB_TIMEOUTS,
      logContext: {
        operation: "interview.assemble",
        jobId,
        jobKind: "assemble",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  const data = completion.data;
  if (!data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  if (data.kind === "ask_user") {
    return {
      result: { ...data, questions: normalizeQuestions(data.questions) },
      error: null,
      llmMeta: completion.meta,
    };
  }

  if (data.kind === "prompt") {
    return { result: data, error: null, llmMeta: completion.meta };
  }

  return {
    result: { kind: "prompt", prompt: data as AssembledPrompt },
    error: null,
    llmMeta: completion.meta,
  };
}

async function processRefineJob(
  env: Env,
  jobId: string,
  userId: string,
  payload: RefineJobRequest
): Promise<JobExecutionResult<RefinedPrompt>> {
  const lang = normalizeLanguage(payload.language);

  const row = await env.DB.prepare(
    "SELECT blocks FROM prompts WHERE id = ? AND user_id = ?"
  )
    .bind(payload.promptId, userId)
    .first<{ blocks: string }>();

  if (!row) {
    return { result: null, error: "Prompt not found." };
  }

  const currentBlocks = JSON.parse(row.blocks);
  const profile = isParticipantJob(payload.tier)
    ? await fetchProfile(env.DB, userId)
    : undefined;
  const models = llmModels(env, payload.tier);

  const userMessage = `Current prompt blocks:
${JSON.stringify(currentBlocks, null, 2)}

Issue type: ${payload.issueType}
${payload.issueDescription ? `Issue description: ${payload.issueDescription}` : ""}
${payload.outputSample ? `AI output sample:\n${payload.outputSample}` : ""}

Revise the prompt to fix this issue. Only change what needs changing.`;

  const completion = await chatCompletion<RefinedPrompt>(
    env.OPENROUTER_API_KEY,
    {
      messages: [
        { role: "system", content: promptRefinementPrompt(lang, profile) },
        { role: "user", content: userMessage },
      ],
      temperature: 0.4,
      max_tokens: 4096,
    },
    models,
    {
      ...REFINE_JOB_TIMEOUTS,
      logContext: {
        operation: "interview.refine",
        jobId,
        jobKind: "refine",
      },
    }
  );

  if (completion.error) {
    return { result: null, error: completion.error, llmMeta: completion.meta };
  }

  if (!completion.data) {
    return { result: null, error: "Empty response from AI.", llmMeta: completion.meta };
  }

  return { result: completion.data, error: null, llmMeta: completion.meta };
}

export async function processInterviewJob(env: Env, jobId: string): Promise<void> {
  const row = await getJobRow(env.DB, jobId);
  if (!row) {
    logInterviewJobEvent("interview_job_missing", { jobId });
    return;
  }

  if (row.status === "completed" || row.status === "failed") {
    logInterviewJobEvent("interview_job_skipped", {
      jobId,
      kind: row.kind,
      status: row.status,
    });
    return;
  }

  const startedAt = Date.now();
  logInterviewJobEvent("interview_job_started", {
    jobId,
    kind: row.kind,
    createdAt: row.created_at,
  });
  await markProcessing(env.DB, jobId);

  const payload = JSON.parse(row.request_payload) as AnalyzeJobRequest | QuestionsJobRequest | AssembleJobRequest | RefineJobRequest;

  if (row.kind === "analyze") {
    const { result, error, llmMeta } = await processAnalyzeJob(env, jobId, row.user_id, payload as AnalyzeJobRequest);
    if (error) {
      logInterviewJobEvent("interview_job_failed", {
        jobId,
        kind: row.kind,
        durationMs: Date.now() - startedAt,
        error,
        ...llmLogDetails(llmMeta),
      });
      await markFailed(env.DB, jobId, error);
      return;
    }
    await markCompleted(env.DB, jobId, result);
    logInterviewJobEvent("interview_job_completed", {
      jobId,
      kind: row.kind,
      durationMs: Date.now() - startedAt,
      ...llmLogDetails(llmMeta),
    });
    return;
  }

  if (row.kind === "questions") {
    const { result, error, llmMeta } = await processQuestionsJob(env, jobId, row.user_id, payload as QuestionsJobRequest);
    if (error) {
      logInterviewJobEvent("interview_job_failed", {
        jobId,
        kind: row.kind,
        durationMs: Date.now() - startedAt,
        error,
        ...llmLogDetails(llmMeta),
      });
      await markFailed(env.DB, jobId, error);
      return;
    }
    await markCompleted(env.DB, jobId, result);
    logInterviewJobEvent("interview_job_completed", {
      jobId,
      kind: row.kind,
      durationMs: Date.now() - startedAt,
      ...llmLogDetails(llmMeta),
    });
    return;
  }

  if (row.kind === "assemble") {
    const { result, error, llmMeta } = await processAssembleJob(env, jobId, row.user_id, payload as AssembleJobRequest);
    if (error) {
      logInterviewJobEvent("interview_job_failed", {
        jobId,
        kind: row.kind,
        durationMs: Date.now() - startedAt,
        error,
        ...llmLogDetails(llmMeta),
      });
      await markFailed(env.DB, jobId, error);
      return;
    }
    await markCompleted(env.DB, jobId, result);
    logInterviewJobEvent("interview_job_completed", {
      jobId,
      kind: row.kind,
      durationMs: Date.now() - startedAt,
      ...llmLogDetails(llmMeta),
    });
    return;
  }

  const { result, error, llmMeta } = await processRefineJob(env, jobId, row.user_id, payload as RefineJobRequest);
  if (error) {
    logInterviewJobEvent("interview_job_failed", {
      jobId,
      kind: row.kind,
      durationMs: Date.now() - startedAt,
      error,
      ...llmLogDetails(llmMeta),
    });
    await markFailed(env.DB, jobId, error);
    return;
  }
  await markCompleted(env.DB, jobId, result);
  logInterviewJobEvent("interview_job_completed", {
    jobId,
    kind: row.kind,
    durationMs: Date.now() - startedAt,
    ...llmLogDetails(llmMeta),
  });
}

export async function handleInterviewJobBatch(
  batch: MessageBatch<InterviewJobMessage>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processInterviewJob(env, message.body.jobId);
      message.ack();
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "Interview job processing failed.";
      console.error("Interview job consumer failure", {
        jobId: message.body.jobId,
        attempts: message.attempts,
        error: failureMessage,
      });

      if (message.attempts < 3) {
        await markQueued(env.DB, message.body.jobId, failureMessage);
        message.retry({ delaySeconds: Math.min(30, message.attempts * 5) });
        continue;
      }

      await markFailed(env.DB, message.body.jobId, "Background processing failed. Please try again.");
      message.ack();
    }
  }
}
