import type { Env } from '../env';
import { ZodError } from 'zod';
import { AttachmentError } from './attachments/errors';
import { requireContext } from './attachments/context';
import type { IntentAnalysis } from './llm/types';
import type { LLMCallMeta } from './openrouter';
import type { Language } from './language';
import type { Tier } from './tier';
import { processAnalyzeJob, processQuestionsJob, processAssembleJob, processRefineJob } from './interview-execution';

export type InterviewJobKind = "analyze" | "questions" | "assemble" | "refine";
export type InterviewJobStatus = "queued" | "processing" | "completed" | "failed";

// `tier` is resolved at enqueue time and carried in the payload — never
// re-queried at consume time. Optional because jobs enqueued before the
// tiering deploy lack it; those default to participant behavior.
export interface AnalyzeJobRequest {
  document_context_id?: string;
  text: string;
  language: Language;
  tier?: Tier;
}

export interface QuestionsJobRequest {
  document_context_id?: string;
  original_text?: string;
  intent: IntentAnalysis;
  language: Language;
  tier?: Tier;
}

export interface AssembleJobRequest {
  document_context_id?: string;
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

function nowSql(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
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

  if (row) {
    const payload = JSON.parse(row.request_payload) as { document_context_id?: string };
    if (payload.document_context_id) {
      try { await requireContext(db, userId, payload.document_context_id); } catch (error) {
        if (!(error instanceof AttachmentError)) throw error;
        return { ...rowToInterviewJob<T>(row), status: 'failed', result: null, error: 'expired' };
      }
    }
  }
  return row ? rowToInterviewJob<T>(row) : null;
}

export async function processInterviewJob(env: Env, jobId: string): Promise<void> {
  const row = await getJobRow(env.DB, jobId);
  if (!row) {
    console.info("interview_job_missing", { jobId });
    return;
  }

  if (row.status === "completed" || row.status === "failed") {
    console.info("interview_job_skipped", {
      jobId,
      kind: row.kind,
      status: row.status,
    });
    return;
  }

  const startedAt = Date.now();
  console.info("interview_job_started", {
    jobId,
    kind: row.kind,
    createdAt: row.created_at,
  });
  await markProcessing(env.DB, jobId);

  const payload = JSON.parse(row.request_payload) as AnalyzeJobRequest | QuestionsJobRequest | AssembleJobRequest | RefineJobRequest;

  if (row.kind === "analyze") {
    const { result, error, llmMeta } = await processAnalyzeJob(env, jobId, row.user_id, payload as AnalyzeJobRequest);
    if (error) {
      console.info("interview_job_failed", {
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
    console.info("interview_job_completed", {
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
      console.info("interview_job_failed", {
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
    console.info("interview_job_completed", {
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
      console.info("interview_job_failed", {
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
    console.info("interview_job_completed", {
      jobId,
      kind: row.kind,
      durationMs: Date.now() - startedAt,
      ...llmLogDetails(llmMeta),
    });
    return;
  }

  const { result, error, llmMeta } = await processRefineJob(env, jobId, row.user_id, payload as RefineJobRequest);
  if (error) {
    console.info("interview_job_failed", {
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
  console.info("interview_job_completed", {
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
      if (error instanceof AttachmentError) {
        await markFailed(env.DB, message.body.jobId, error.code);
        message.ack();
        continue;
      }
      // Never log exception messages: validation errors can contain source data.
      // Persist a fixed diagnostic code so failed jobs remain diagnosable even
      // when historical Worker logs are unavailable.
      const diagnosticCode = error instanceof ZodError ? 'ai_response_schema_invalid'
        : error instanceof Error && error.message === 'Invalid document reference from AI.' ? 'ai_document_reference_invalid'
        : error instanceof TypeError ? 'processing_type_error'
        : error instanceof SyntaxError ? 'processing_json_invalid'
        : error instanceof Error && error.message.startsWith('D1_') ? 'database_error'
        : 'processing_exception';
      const errorType = error instanceof ZodError ? 'ZodError'
        : error instanceof TypeError ? 'TypeError'
        : error instanceof SyntaxError ? 'SyntaxError' : 'Error';
      const failureMessage = `Interview job processing failed. (${diagnosticCode})`;
      console.error("Interview job consumer failure", {
        jobId: message.body.jobId,
        attempts: message.attempts,
        error: failureMessage,
        diagnosticCode,
        errorType,
      });

      if (message.attempts < 3) {
        await markQueued(env.DB, message.body.jobId, failureMessage);
        message.retry({ delaySeconds: Math.min(30, message.attempts * 5) });
        continue;
      }

      await markFailed(env.DB, message.body.jobId, `Background processing failed. Please try again. (${diagnosticCode})`);
      message.ack();
    }
  }
}
