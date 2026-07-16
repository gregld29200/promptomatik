// Async document generation jobs (Documents module, D1 phase).
// Same lifecycle as interview jobs: create row -> enqueue -> consumer
// calls the LLM -> result stored on the row -> frontend polls.

import { nanoid } from "nanoid";
import type { Env } from "../env";
import { callLLM, type DocumentsLlmConfig } from "./documents/generate";
import {
  DocumentModeSchema,
  InputKindSchema,
  OutputIntentSchema,
  SimpleTemplateSchema,
  type TransformResponse,
} from "./documents/types";

export interface DocumentRequest {
  content: string;
  title?: string;
  level?: string;
  languageFocus?: string;
  inputKind?: string;
  outputIntent?: string;
  customRequest?: string;
  emphasisTerms?: string[];
  templateId?: string;
  mode?: string;
}

export interface DocumentJobRow {
  id: string;
  user_id: string;
  status: "queued" | "processing" | "completed" | "failed";
  request_payload: string;
  result_payload: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentJobResponse {
  id: string;
  status: DocumentJobRow["status"];
  result: TransformResponse | null;
  error: string | null;
  createdAt: string;
}

export interface DocumentJobSummary {
  id: string;
  status: DocumentJobRow["status"];
  label: string;
  createdAt: string;
}

export type DocumentGenerator = (config: DocumentsLlmConfig, request: DocumentRequest) => Promise<TransformResponse>;

const DEFAULT_GENERATOR: DocumentGenerator = (config, request) =>
  callLLM(
    config,
    request.content,
    request.title,
    request.level,
    request.languageFocus,
    InputKindSchema.catch("auto").parse(request.inputKind),
    OutputIntentSchema.catch("three_materials").parse(request.outputIntent),
    request.customRequest,
    DocumentModeSchema.catch("lesson").parse(request.mode),
    request.emphasisTerms ?? [],
    SimpleTemplateSchema.catch("editorial_reader").parse(request.templateId),
  );

function countWords(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

export function validateDocumentRequest(request: DocumentRequest): string | null {
  const content = request.content?.trim() ?? "";
  if (request.mode !== undefined && !DocumentModeSchema.safeParse(request.mode).success) {
    return "invalid_request";
  }
  if (request.emphasisTerms !== undefined && (
    !Array.isArray(request.emphasisTerms)
    || request.emphasisTerms.length > 50
    || request.emphasisTerms.some((term) => typeof term !== "string" || !term.trim() || term.length > 100)
  )) {
    return "invalid_request";
  }
  if (request.templateId !== undefined && !SimpleTemplateSchema.safeParse(request.templateId).success) {
    return "invalid_request";
  }
  if (countWords(content) < 30) {
    return "content_too_short";
  }
  if (content.length > 15_000) {
    return "content_too_long";
  }
  return null;
}

export async function createDocumentJob(env: Env, userId: string, request: DocumentRequest): Promise<string> {
  const id = nanoid();
  await env.DB.prepare(
    `INSERT INTO document_jobs (id, user_id, request_payload)
     VALUES (?, ?, ?)`
  )
    .bind(id, userId, JSON.stringify({ ...request, content: request.content.trim() }))
    .run();
  await env.DOCUMENT_JOBS_QUEUE.send({ jobId: id }, { contentType: "json" });
  return id;
}

export function rowToResponse(row: DocumentJobRow): DocumentJobResponse {
  return {
    id: row.id,
    status: row.status,
    result: row.result_payload ? JSON.parse(row.result_payload) as TransformResponse : null,
    error: row.error_message,
    createdAt: row.created_at,
  };
}

export async function deleteDocumentJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<boolean> {
  const result = await env.DB.prepare("DELETE FROM document_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .run();
  return result.meta.changes > 0;
}

export async function getDocumentJobForUser(
  env: Env,
  jobId: string,
  userId: string
): Promise<DocumentJobResponse | null> {
  const row = await env.DB.prepare("SELECT * FROM document_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<DocumentJobRow>();
  return row ? rowToResponse(row) : null;
}

function summaryLabel(payload: string): string {
  const request = JSON.parse(payload) as Partial<DocumentRequest>;
  const title = request.title?.trim();
  if (title) return title;

  const words = request.content?.trim().split(/\s+/).filter(Boolean).slice(0, 8) ?? [];
  return words.length > 0 ? words.join(" ") : "Document";
}

export async function listDocumentJobsForUser(
  env: Env,
  userId: string,
  limit = 10
): Promise<DocumentJobSummary[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = await env.DB.prepare(
    `SELECT id, status, request_payload, created_at
     FROM document_jobs
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`
  )
    .bind(userId, safeLimit)
    .all<Pick<DocumentJobRow, "id" | "status" | "request_payload" | "created_at">>();

  return rows.results.map((row) => ({
    id: row.id,
    status: row.status,
    label: summaryLabel(row.request_payload),
    createdAt: row.created_at,
  }));
}

export async function processDocumentJob(
  env: Env,
  jobId: string,
  generator: DocumentGenerator = DEFAULT_GENERATOR
): Promise<void> {
  const row = await env.DB.prepare("SELECT * FROM document_jobs WHERE id = ?")
    .bind(jobId)
    .first<DocumentJobRow>();
  if (!row || row.status === "completed" || row.status === "failed") return;

  await env.DB.prepare(
    "UPDATE document_jobs SET status = 'processing', started_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).bind(jobId).run();

  try {
    if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not configured.");
    const request = JSON.parse(row.request_payload) as DocumentRequest;
    const result = await generator(
      { apiKey: env.OPENROUTER_API_KEY, model: env.DOCS_MODEL, structureModel: env.DOCS_STRUCTURE_MODEL },
      request
    );
    await env.DB.prepare(
      `UPDATE document_jobs
       SET status = 'completed', result_payload = ?, error_message = NULL,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(JSON.stringify(result), jobId)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Document generation failed.";
    await env.DB.prepare(
      `UPDATE document_jobs
       SET status = 'failed', error_message = ?, completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(message, jobId)
      .run();
  }
}

export async function handleDocumentJobBatch(
  batch: MessageBatch<{ jobId: string }>,
  env: Env
): Promise<void> {
  for (const message of batch.messages) {
    try {
      await processDocumentJob(env, message.body.jobId);
      message.ack();
    } catch (error) {
      console.error("Document job consumer failure", {
        jobId: message.body.jobId,
        attempts: message.attempts,
        error: error instanceof Error ? error.message : "unknown",
      });
      if (message.attempts < 3) {
        message.retry({ delaySeconds: Math.min(30, message.attempts * 5) });
        continue;
      }
      await env.DB.prepare(
        "UPDATE document_jobs SET status = 'failed', error_message = 'Background processing failed. Please try again.', updated_at = datetime('now') WHERE id = ?"
      ).bind(message.body.jobId).run();
      message.ack();
    }
  }
}
