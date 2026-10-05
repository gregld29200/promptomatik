// Async document generation jobs (Documents module, D1 phase).
// Same lifecycle as interview jobs: create row -> enqueue -> consumer
// calls the LLM -> result stored on the row -> frontend polls.

import { nanoid } from "nanoid";
import type { Env } from "../env";
import { buildDocument, type DocumentsLlmConfig } from "./documents/generate";
import {
  DocumentDesignSchema,
  DocumentOrientationSchema,
  DocumentTypeSchema,
  SimpleTemplateSchema,
  type SimpleTransformMaterial,
  type TransformResponse,
} from "./documents/types";

export interface DocumentRequest {
  content: string;
  title?: string;
  level?: string;
  languageFocus?: string;
  customRequest?: string;
  emphasisTerms?: string[];
  templateId?: string;
  documentType?: string;
  orientation?: string;
  design?: unknown;
  locale?: string;
  /** Legacy field from the retired simple/lesson mode split; still present in old stored payloads. */
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
  buildDocument(config, request.content, {
    title: request.title,
    level: request.level,
    languageFocus: request.languageFocus,
    customRequest: request.customRequest,
    emphasisTerms: request.emphasisTerms ?? [],
    templateId: SimpleTemplateSchema.catch("editorial_reader").parse(request.templateId),
    // Legacy queued jobs (mode: "simple"/"lesson") fall back to "reading":
    // formatting the content is always safe, unlike failing the job.
    documentType: DocumentTypeSchema.catch("reading").parse(request.documentType),
    orientation: DocumentOrientationSchema.optional().catch(undefined).parse(request.orientation),
    design: DocumentDesignSchema.optional().catch(undefined).parse(request.design),
    locale: request.locale,
  });

/** A full teacher guide with answer keys runs past 15,000 characters. */
export const MAX_DOCUMENT_CHARS = 30_000;
/** Short enough for a checklist or a pair of role cards. */
export const MIN_DOCUMENT_WORDS = 8;

function countWords(input: string): number {
  return input.trim().split(/\s+/).filter(Boolean).length;
}

export function validateDocumentRequest(request: DocumentRequest): string | null {
  const content = request.content?.trim() ?? "";
  if (request.documentType !== undefined && !DocumentTypeSchema.safeParse(request.documentType).success) {
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
  if (request.orientation !== undefined && !DocumentOrientationSchema.safeParse(request.orientation).success) {
    return "invalid_request";
  }
  if (request.design !== undefined && !DocumentDesignSchema.safeParse(request.design).success) {
    return "invalid_request";
  }
  if (countWords(content) < MIN_DOCUMENT_WORDS) {
    return "content_too_short";
  }
  if (content.length > MAX_DOCUMENT_CHARS) {
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
    // Formatting is deterministic and needs no key; the LLM (and therefore the
    // key) only comes into play for structure rescue and requested additions.
    const request = JSON.parse(row.request_payload) as DocumentRequest;
    const result = await generator(
      { apiKey: env.OPENROUTER_API_KEY ?? "", model: env.DOCS_MODEL, structureModel: env.DOCS_STRUCTURE_MODEL },
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

export interface PresentationUpdate {
  templateId?: string;
  design?: unknown;
  orientation?: string;
}

/**
 * Re-styles a finished document in place: style, design overrides and page
 * orientation are presentation only, so no regeneration is needed and the
 * teacher's text is never touched. Returns the updated job, or null when the
 * job or material does not belong to the user.
 */
export async function updateDocumentPresentation(
  env: Env,
  jobId: string,
  userId: string,
  materialIndex: number,
  update: PresentationUpdate,
): Promise<DocumentJobResponse | "invalid" | null> {
  const template = update.templateId === undefined ? undefined : SimpleTemplateSchema.safeParse(update.templateId);
  const design = update.design === undefined ? undefined : DocumentDesignSchema.safeParse(update.design);
  const orientation = update.orientation === undefined ? undefined : DocumentOrientationSchema.safeParse(update.orientation);
  if ((template && !template.success) || (design && !design.success) || (orientation && !orientation.success)) {
    return "invalid";
  }

  const row = await env.DB.prepare("SELECT * FROM document_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<DocumentJobRow>();
  if (!row || row.status !== "completed" || !row.result_payload) return null;
  const result = JSON.parse(row.result_payload) as TransformResponse;
  const found = result.materials[materialIndex];
  if (!found || found.material_type !== "clean_handout") return null;
  const material = found as SimpleTransformMaterial;

  if (template?.success) material.template_id = template.data;
  if (orientation?.success) material.orientation = orientation.data;
  if (design?.success) {
    const cleaned = Object.fromEntries(
      Object.entries(design.data).filter(([, value]) => value !== undefined && value !== ""),
    );
    if (Object.keys(cleaned).length > 0) material.design = cleaned;
    else delete material.design;
  }

  await env.DB.prepare(
    "UPDATE document_jobs SET result_payload = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?"
  ).bind(JSON.stringify(result), jobId, userId).run();
  return rowToResponse({ ...row, result_payload: JSON.stringify(result) });
}
