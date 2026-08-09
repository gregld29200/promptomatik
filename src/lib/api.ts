/**
 * Typed API client for /api/* endpoints.
 * Returns { data, error } instead of throwing — keeps error handling explicit.
 */

import { getLanguage, type Language } from "@/lib/i18n";
// Structural mirror of the Worker's `NormalisedTranscript`, declared once in
// the component layer so the reading UI and this client cannot drift apart.
import type { TranscriptData } from "@/components/transcription/types";

export interface ApiError {
  error: string;
  status: number;
  code?: string;
  /**
   * Machine-readable failure detail, when the endpoint sends one. Only the
   * Transcription Studio does today: its errors are objects, not sentences, so
   * the page can say "this episode is 2 h 14, the limit is 90 minutes" instead
   * of a generic message. See `TranscriptionFailure`.
   */
  failure?: TranscriptionFailure;
}

type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  // `json: false` lets a caller send FormData — the browser must set its own
  // multipart boundary, and a hardcoded application/json header would break it.
  config: { timeoutMs?: number; json?: boolean } = {}
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(path, {
      credentials: "same-origin",
      headers: config.json === false
        ? { ...options.headers }
        : { "Content-Type": "application/json", ...options.headers },
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        data: null,
        error: {
          error: "Request timed out. Please try again.",
          status: 408,
          code: "request_timeout",
        },
      };
    }

    return {
      data: null,
      error: {
        error: "Network error. Please try again.",
        status: 0,
        code: "network_error",
      },
    };
  }

  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    const errorBody = body as { error?: string; code?: string; failure?: TranscriptionFailure };
    return {
      data: null,
      error: {
        error: errorBody.error ?? "Request failed",
        status: res.status,
        code: errorBody.code,
        failure: errorBody.failure,
      },
    };
  }

  const data = (await res.json()) as T;
  return { data, error: null };
}

// ---- Auth types ----

export type Tier = "free" | "participant";

export interface User {
  id: string;
  email: string;
  name: string;
  role: "teacher" | "admin";
  languagePreference: Language;
  tier: Tier;
}

export interface Quota {
  used: number;
  limit: number;
}

interface LoginResponse {
  user: User;
}

interface MeResponse {
  user: User;
  quota: Quota | null;
}

// ---- Auth endpoints ----

export function login(email: string, password: string) {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function logout() {
  return request<{ success: boolean }>("/api/auth/logout", {
    method: "POST",
  });
}

export function me() {
  return request<MeResponse>("/api/auth/me");
}

export function updateLanguagePreference(language: Language) {
  return request<{ user: User }>("/api/auth/language", {
    method: "PUT",
    body: JSON.stringify({ language }),
  });
}

export function signup(email: string, language: Language) {
  return request<{ ok: boolean }>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, language }),
  });
}

export function forgotPassword(email: string) {
  return request<{ success: boolean }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, password: string) {
  return request<{ success: boolean }>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, password }),
  });
}

// ---- Profile types ----

export interface TeacherProfile {
  languages_taught: string[];
  typical_levels: string[];
  typical_audience: string[];
  typical_duration: string;
  teaching_context: string;
  setup_completed: boolean;
  onboarding_completed: boolean;
  onboarding_version: number;
  profile_onboarding_completed: boolean;
  profile_onboarding_version: number;
}

// ---- Profile endpoints ----

export function getProfile() {
  return request<{ profile: TeacherProfile }>("/api/profile");
}

export function updateProfile(data: Partial<TeacherProfile>) {
  return request<{ profile: TeacherProfile }>("/api/profile", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

// ---- Interview types ----

export type Technique =
  | "role"
  | "context"
  | "examples"
  | "constraints"
  | "steps"
  | "think_first";

export interface PromptBlock {
  technique: Technique;
  content: string;
  annotation: string;
  order: number;
}

export interface IntentAnalysis {
  level: string | null;
  topic: string | null;
  activity_type: string | null;
  audience: string | null;
  duration: string | null;
  source_type: "from_scratch" | "from_source";
  missing_fields: string[];
  summary: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  field: string;
  options: { label: string; value: string; recommended?: boolean }[];
  multi_select?: boolean;
  allow_other?: boolean;
  other_placeholder?: string;
  // Back-compat (older question schema)
  allow_freetext?: boolean;
}

export interface AssembledPrompt {
  name: string;
  blocks: PromptBlock[];
  tips: string[];
  source_type: "from_scratch" | "from_source";
  suggested_tags: string[];
}

export type AssembleResult =
  | { kind: "prompt"; prompt: AssembledPrompt }
  | { kind: "ask_user"; questions: InterviewQuestion[] };

export type InterviewJobKind = "analyze" | "questions" | "assemble" | "refine";
export type InterviewJobStatus = "queued" | "processing" | "completed" | "failed";

export interface InterviewJob<T = unknown> {
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

export interface Prompt {
  id: string;
  user_id: string;
  name: string;
  language: Language;
  tags: string[];
  blocks: PromptBlock[];
  tips: string[];
  source_type: string;
  is_template: boolean;
  template_id: string | null;
  template_kind: "official" | "community";
  template_status: "pending" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

// ---- Interview endpoints ----

export function analyzeIntent(text: string, language: Language) {
  return request<{ job: InterviewJob }>("/api/interview/analyze", {
    method: "POST",
    body: JSON.stringify({ text, language }),
  });
}

export function getQuestions(intent: IntentAnalysis, language: Language) {
  return request<{ job: InterviewJob }>("/api/interview/questions", {
    method: "POST",
    body: JSON.stringify({ intent, language }),
  });
}

export function assemblePrompt(
  intent: IntentAnalysis,
  answers: Record<string, string>,
  originalText: string,
  language: Language
) {
  return request<{ job: InterviewJob }>("/api/interview/assemble", {
    method: "POST",
    body: JSON.stringify({
      intent,
      answers,
      original_text: originalText,
      language,
    }),
  });
}

// ---- Refinement types ----

export interface RefinementChange {
  technique: Technique;
  type: "modified" | "added" | "removed";
  reason: string;
}

export interface RefinedPrompt {
  blocks: PromptBlock[];
  changes: RefinementChange[];
  tips: string[];
}

// ---- Refinement endpoint ----

export function refinePrompt(
  promptId: string,
  issueType: string,
  issueDescription: string | null,
  outputSample: string | null,
  language: Language
) {
  return request<{ job: InterviewJob }>("/api/interview/refine", {
    method: "POST",
    body: JSON.stringify({
      promptId,
      issueType,
      issueDescription: issueDescription || undefined,
      outputSample: outputSample || undefined,
      language,
    }),
  });
}

export function getInterviewJob<T>(jobId: string) {
  return request<{ job: InterviewJob<T> }>(`/api/jobs/${jobId}`, {}, { timeoutMs: 10_000 });
}

export async function waitForInterviewJobResult<T>(
  jobId: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<ApiResult<InterviewJob<T>>> {
  const timeoutMs = options.timeoutMs ?? 380_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const res = await getInterviewJob<T>(jobId);
    if (res.error) {
      if (res.error.code === "request_timeout" || res.error.code === "network_error") {
        await sleep(pollIntervalMs);
        continue;
      }
      return res;
    }

    const job = res.data.job;
    if (job.status === "completed") {
      return { data: job, error: null };
    }

    if (job.status === "failed") {
      return {
        data: null,
        error: {
          error: job.error ?? "Background processing failed.",
          status: 502,
          code: "job_failed",
        },
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    data: null,
    error: {
      error: "This request is taking too long. Please try again.",
      status: 408,
      code: "job_timeout",
    },
  };
}

// ---- Prompt CRUD endpoints ----

export function createPrompt(data: {
  name: string;
  language?: Language;
  tags?: string[];
  blocks: PromptBlock[];
  tips?: string[];
  source_type?: string;
}) {
  return request<{ prompt: Prompt }>("/api/prompts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getPrompts(q?: string) {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  return request<{ prompts: Prompt[] }>(`/api/prompts${params}`);
}

export function getPrompt(id: string) {
  return request<{ prompt: Prompt }>(`/api/prompts/${id}`);
}

export function updatePrompt(
  id: string,
  data: {
    name?: string;
    tags?: string[];
    blocks?: PromptBlock[];
    tips?: string[];
  }
) {
  return request<{ prompt: Prompt }>(`/api/prompts/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export function deletePrompt(id: string) {
  return request<{ success: boolean }>(`/api/prompts/${id}`, {
    method: "DELETE",
  });
}

export function duplicatePrompt(id: string) {
  return request<{ prompt: Prompt }>(`/api/prompts/${id}/duplicate`, {
    method: "POST",
  });
}

export function submitPromptTemplate(id: string) {
  return request<{ prompt: Prompt }>(`/api/prompts/${id}/submit-template`, {
    method: "POST",
  });
}

// ---- Template types ----

export interface Template extends Prompt {
  author_name?: string;
}

// ---- Template endpoints ----

export function getTemplates(kind?: "official" | "community") {
  const query = kind ? `?kind=${kind}` : "";
  return request<{ templates: Template[] }>(`/api/templates${query}`);
}

export function getTemplate(id: string) {
  return request<{ template: Template }>(`/api/templates/${id}`);
}

export function useTemplate(id: string) {
  return request<{ prompt: Prompt }>(`/api/templates/${id}/use`, {
    method: "POST",
  });
}

// ---- Admin template endpoints ----

export interface AdminTemplate {
  id: string;
  name: string;
  tags: string[];
  updated_at: string;
  author_name: string;
  template_kind: "official" | "community";
  template_status: "pending" | "approved" | "rejected";
}

export interface AdminTemplateSubmission {
  id: string;
  name: string;
  tags: string[];
  updated_at: string;
  author_name: string;
  template_kind: "official" | "community";
  template_status: "pending" | "approved" | "rejected";
}

export function getAdminTemplates() {
  return request<{ templates: AdminTemplate[] }>("/api/admin/templates");
}

export function getAdminTemplateSubmissions() {
  return request<{ submissions: AdminTemplateSubmission[] }>("/api/admin/templates/submissions");
}

export function publishTemplate(id: string) {
  return request<{ success: boolean }>(`/api/admin/templates/${id}/publish`, {
    method: "POST",
  });
}

export function unpublishTemplate(id: string) {
  return request<{ success: boolean }>(`/api/admin/templates/${id}/unpublish`, {
    method: "POST",
  });
}

export function approveTemplateSubmission(id: string) {
  return request<{ success: boolean }>(`/api/admin/templates/${id}/approve`, {
    method: "POST",
  });
}

export function rejectTemplateSubmission(id: string) {
  return request<{ success: boolean }>(`/api/admin/templates/${id}/reject`, {
    method: "POST",
  });
}

// ---- Auth: register ----

export function register(token: string, name: string, password: string) {
  return request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ token, name, password }),
  });
}

// ---- Admin types ----

export interface Invitation {
  id: string;
  email: string;
  token: string;
  status: string;
  tier: Tier;
  kind: "admin" | "self";
  expires_at: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tier: Tier;
  is_active: number;
  created_at: string;
}

// ---- Admin endpoints ----

export function sendInvitation(email: string, tier: Tier = "participant") {
  return request<{ invitation: Invitation; email_sent: boolean }>(
    "/api/admin/invitations",
    { method: "POST", body: JSON.stringify({ email, tier }) }
  );
}

export function setUserTier(id: string, tier: Tier) {
  return request<{ success: boolean }>(`/api/admin/users/${id}/tier`, {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
}

export function getInvitations() {
  return request<{ invitations: Invitation[] }>("/api/admin/invitations");
}

export function getUsers() {
  return request<{ users: AdminUser[] }>("/api/admin/users");
}

export function deactivateUser(id: string) {
  return request<{ success: boolean }>(`/api/admin/users/${id}/deactivate`, {
    method: "POST",
  });
}

export function reactivateUser(id: string) {
  return request<{ success: boolean }>(`/api/admin/users/${id}/reactivate`, {
    method: "POST",
  });
}

// ---- Audio Studio types ----

export type AudioMode = "monologue" | "dialogue";
export type AudioQuality = "draft" | "final";
export type AudioJobStatus = "queued" | "generating" | "assembling" | "ready" | "failed";
export type CefrLevel = "A1" | "A2" | "B1" | "B2" | "C1";

export interface AudioSpeakerDirection {
  accent?: string;
  accentDetail?: string;
  style?: string;
  notes?: string;
}

export interface AudioDirection {
  level: CefrLevel;
  accent: string;
  accentDetail?: string;
  pace: string;
  style: string;
  scene?: string;
  notes?: string;
  speakers?: Record<string, AudioSpeakerDirection>;
}

export interface AudioVoice {
  name: string;
  descriptor: string;
  previewUrl: string;
}

export interface AudioSegment {
  idx: number;
  text: string;
  status: string;
  durationSeconds: number | null;
  retryCount: number;
}

export interface AudioWaveform {
  peaks: number[];
  blocks: {
    idx: number;
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
  }[];
}

export interface AudioJob {
  id: string;
  mode: AudioMode;
  quality: AudioQuality;
  title: string | null;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
  status: AudioJobStatus;
  estimatedSeconds: number;
  actualSeconds: number | null;
  error: string | null;
  modelUsed: string | null;
  genMs: number | null;
  retryCount: number;
  apiCostUsd: number | null;
  expiresAt: string | null;
  createdAt: string;
  segments?: AudioSegment[];
  waveform?: AudioWaveform;
  downloads?: {
    mp3: string;
    wav: string;
    transcript: string;
  };
}

export interface AudioQuota {
  includedRemaining: number;
  credits: number;
  monthResetsOn: string;
}

export interface AudioPrepareChange {
  type: "speaker_rename" | "tag_added" | "stage_direction_converted" | "direction_hint" | "removed_stage_direction" | "cleanup";
  before: string;
  after: string;
  line: number;
  rationale: string;
}

export interface AudioPrepareResult {
  speaker_count: number;
  formatted_script: string;
  changes: AudioPrepareChange[];
  warnings: string[];
}

export function getAudioQuota() {
  return request<AudioQuota>("/api/audio/quota");
}

export function getAudioVoices() {
  return request<{ voices: AudioVoice[] }>("/api/audio/voices");
}

export function getAudioJobs(limit = 10, offset = 0) {
  return request<{ jobs: AudioJob[] }>(`/api/audio/jobs?limit=${limit}&offset=${offset}`);
}

export function getAudioJob(id: string) {
  return request<{ job: AudioJob }>(`/api/audio/jobs/${id}`);
}

export function renameAudioJob(id: string, title: string) {
  return request<{ title: string | null }>(`/api/audio/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteAudioJob(id: string) {
  return request<{ deleted: boolean }>(`/api/audio/jobs/${id}`, {
    method: "DELETE",
  });
}

// `language` drives the language of the rationales the model writes back — the
// panel renders them verbatim, so it must match the interface language.
export function prepareAudioScript(data: { script: string; mode: AudioMode }) {
  return request<AudioPrepareResult>("/api/audio/prepare", {
    method: "POST",
    body: JSON.stringify({ ...data, language: getLanguage() }),
  }, { timeoutMs: 60_000 });
}

export function createAudioJob(data: {
  mode: AudioMode;
  quality: AudioQuality;
  script: string;
  direction: AudioDirection;
  voices: Record<string, string>;
}) {
  return request<{ jobId: string; estimatedSeconds: number }>("/api/audio/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function regenerateAudioSegment(jobId: string, segmentIdx: number) {
  return request<{ accepted: boolean }>(`/api/audio/jobs/${jobId}/segments/${segmentIdx}/regenerate`, {
    method: "POST",
  });
}

// ---- Audio Studio credit purchases ----

export interface CreditPack {
  id: string;
  minutes: number;
  amountCents: number | null;
  currency: string | null;
}

export function getCreditPacks() {
  return request<{ packs: CreditPack[] }>("/api/audio/credits/packs");
}

export function startCreditCheckout(packId: string) {
  return request<{ url: string }>("/api/audio/credits/checkout", {
    method: "POST",
    body: JSON.stringify({ packId }),
  });
}

// ---- Documents types ----

export type DocumentJobStatus = "queued" | "processing" | "completed" | "failed";
export type DocumentType = "reading" | "worksheet" | "teacher_guide" | "lesson_plan";
export type DocumentPresetId = "studio_academic" | "modern_training" | "warm_coaching";
export type SimpleDocumentTemplateId = "editorial_reader" | "classroom_handout" | "compact_professional";
export type DocumentMaterialType =
  | "gap_fill"
  | "comprehension_quiz"
  | "role_play_cards"
  | "sentence_reordering"
  | "matching_exercise"
  | "dictogloss_notes"
  | "vocabulary_in_context"
  | "summary_completion"
  | "headline_matching"
  | "discussion_cards"
  | "text_reconstruction"
  | "categorization_grid"
  | "gap_fill_sentences"
  | "odd_one_out"
  | "word_formation_table"
  | "flashcard_sheet"
  | "rule_summary_card"
  | "controlled_practice"
  | "error_correction"
  | "sorting_exercise"
  | "guided_production"
  | "register_analysis"
  | "reply_template"
  | "phrase_bank_extraction"
  | "sequencing_exercise"
  | "imperative_extraction"
  | "comprehension_check"
  | "transformation_exercise"
  | "timeline_exercise"
  | "character_analysis_card"
  | "prediction_exercise"
  | "clean_handout";
export type DocumentSkillFocus =
  | "reading"
  | "writing"
  | "speaking"
  | "listening"
  | "grammar"
  | "vocabulary"
  | "mixed";
export type DocumentInteractionPattern =
  | "individual"
  | "teacher_student"
  | "pairs"
  | "group"
  | "small_group"
  | "whole_class";

export interface TransformDocumentPayload {
  content: string;
  title?: string;
  level?: string;
  languageFocus?: string;
  customRequest?: string;
  emphasisTerms?: string[];
  templateId?: SimpleDocumentTemplateId;
  documentType?: DocumentType;
  locale?: string;
}

export interface DocumentBlockItem {
  prompt?: string;
  answer?: string;
  term?: string;
  detail?: string;
  example?: string;
  sentence?: string;
}

export interface DocumentBlockCard {
  role: string;
  situation: string;
  goal: string;
  bullets?: string[];
  prompts?: string[];
}

export interface DocumentBlock {
  type: string;
  heading?: string;
  title?: string;
  text?: string;
  paragraphs?: string[];
  bullets?: string[];
  word_bank?: string[];
  items?: DocumentBlockItem[];
  pairs?: { left: string; right: string }[];
  cards?: DocumentBlockCard[];
}

interface DocumentMaterialBase {
  id: string;
  preset_id: DocumentPresetId;
  title: string;
  blocks: DocumentBlock[];
}

export interface SimpleDocumentMaterial extends DocumentMaterialBase {
  material_type: "clean_handout";
  source_text?: string;
  bold_phrases?: string[];
  heading_phrases?: string[];
  template_id?: SimpleDocumentTemplateId;
  document_type?: DocumentType;
  level?: string;
  language_focus?: string;
}

export interface LessonDocumentMaterial extends DocumentMaterialBase {
  material_type: Exclude<DocumentMaterialType, "clean_handout">;
  skill_focus: DocumentSkillFocus;
  interaction_pattern: DocumentInteractionPattern;
  estimated_minutes: number;
}

export type DocumentMaterial = SimpleDocumentMaterial | LessonDocumentMaterial;

export interface DocumentJob {
  id: string;
  status: DocumentJobStatus;
  result: { materials: DocumentMaterial[] } | null;
  error: string | null;
  createdAt: string;
}

export interface DocumentJobSummary {
  id: string;
  status: DocumentJobStatus;
  label: string;
  createdAt: string;
}

export function transformDocument(payload: TransformDocumentPayload) {
  return request<{ jobId: string }>("/api/documents/transform", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getDocumentJob(id: string) {
  return request<{ job: DocumentJob }>(`/api/documents/jobs/${id}`, {}, { timeoutMs: 10_000 });
}

export function getDocumentJobs() {
  return request<{ jobs: DocumentJobSummary[] }>("/api/documents/jobs");
}

export function deleteDocumentJob(id: string) {
  return request<{ ok: boolean }>(`/api/documents/jobs/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---- Audio Studio admin ----

export interface AudioAdminJobCounts {
  total: number;
  ready: number;
  failed: number;
  active: number;
  failureRate: number | null;
}

export interface AudioAdminSpeedStats {
  medianMsPerAudioSecond: number | null;
  sampleCount: number;
}

export interface AudioAdminUserUsage {
  userId: string;
  email: string;
  name: string;
  tier: string;
  includedUsedMonth: number;
  creditsUsed: number;
  creditsRemaining: number;
}

export interface AudioAdminRateLimitPressure {
  windowHours: number;
  segmentsAttempted: number;
  rateLimited: number;
  gatewayErrors: number;
}

export interface AudioAdminMetrics {
  month: string;
  jobs: Record<AudioQuality | "overall", AudioAdminJobCounts>;
  speed: Record<AudioQuality, AudioAdminSpeedStats>;
  cost: {
    cumulativeApiCostUsd: number;
    chargedSeconds: number;
    costPerGeneratedHourUsd: Record<AudioQuality, number | null>;
  };
  users: AudioAdminUserUsage[];
  rateLimitPressure: AudioAdminRateLimitPressure;
}

export function getAudioAdminMetrics() {
  return request<{ metrics: AudioAdminMetrics }>("/api/audio/admin/metrics");
}

export function grantAudioCredits(userId: string, seconds: number) {
  return request<{ success: boolean; credits: number }>("/api/audio/admin/credits", {
    method: "POST",
    body: JSON.stringify({ userId, seconds }),
  });
}

// ---- Transcription Studio ----
//
// Every path is under /api/transcriptions. The `downloads` map on a completed
// job is built server-side (`rowToTranscriptionJob`), so those hrefs are used
// verbatim rather than rebuilt here.

/** Three tiers: Groq (free), Deepgram, AssemblyAI. The cascade picks; the row records. */
export type TranscriptionProviderId = "groq" | "deepgram" | "assemblyai";
export type TranscriptionSourceKind = "upload" | "direct_url" | "podcast" | "youtube";

/**
 * Five statuses, not four: resolving a podcast feed and running the
 * transcription are visibly different waits, so each gets its own sentence.
 */
export type TranscriptionJobStatus =
  | "queued"
  | "resolving"
  | "transcribing"
  | "completed"
  | "failed";

export type TranscriptionFailureCode =
  | "unsupported_source"
  | "youtube_not_yet_supported"
  | "spotify_not_supported"
  | "source_unreachable"
  | "no_audio_found"
  | "source_too_long"
  | "source_too_large"
  | "unsupported_media_type"
  | "provider_unavailable"
  | "provider_failed"
  | "quota_exceeded"
  | "internal";

/**
 * Errors are objects, never strings. `code` is the i18n key suffix
 * (`transcription.error_<code>`) and the rest are the numbers a specific
 * message needs. Flat optional fields rather than a discriminated union,
 * because the UI reads them opportunistically and the wire shape is whatever
 * the Worker's `TranscriptionFailure` serialised to.
 */
export interface TranscriptionFailure {
  code: TranscriptionFailureCode;
  detail?: string;
  url?: string;
  status?: number;
  provider?: TranscriptionProviderId;
  contentType?: string;
  durationSeconds?: number;
  maxSeconds?: number;
  bytes?: number;
  maxBytes?: number;
  requestedSeconds?: number;
  remainingSeconds?: number;
}

export interface TranscriptionJob {
  id: string;
  status: TranscriptionJobStatus;
  title: string | null;
  sourceKind: TranscriptionSourceKind;
  sourceUrl: string | null;
  /** What the teacher asked for — not what ran. Groq can never diarize. */
  diarizeRequested: boolean;
  provider: TranscriptionProviderId | null;
  providerModel: string | null;
  /**
   * Machine value naming why the cascade chose `provider` ("groq_free_tier",
   * "groq_rate_limited", …). Diagnostics and the admin split — never rendered to
   * a teacher, and deliberately not translated.
   */
  providerChoiceReason: string | null;
  /** True only when the stored words really carry speakers. */
  diarization: boolean;
  detectedLanguage: string | null;
  detectedLanguages: string[];
  durationSeconds: number | null;
  billedSeconds: number | null;
  transcript: TranscriptData | null;
  error: TranscriptionFailure | null;
  createdAt: string;
  completedAt: string | null;
  /**
   * Completion + 7 days. Transcripts are kept a week and then deleted — see
   * `expiresLabel` / `isTranscriptExpired` in `@/lib/transcription-display`.
   */
  expiresAt: string | null;
  /** Server-side verdict on that date. Trust it over local arithmetic. */
  expired: boolean;
  /** Only present once the job is completed AND still inside its seven days. */
  downloads?: Record<"txt" | "srt" | "vtt" | "json", string>;
}

export interface TranscriptionJobSummary {
  id: string;
  status: TranscriptionJobStatus;
  /**
   * Server-derived label: the teacher's title, else the URL leaf or the uploaded
   * filename. "" when nothing could be derived — the Worker has no i18n, so the
   * caller renders `transcription.untitled_transcript` for an empty string.
   */
  title: string;
  sourceKind: TranscriptionSourceKind;
  provider: TranscriptionProviderId | null;
  durationSeconds: number | null;
  createdAt: string;
  /** Completion + 7 days, so the row can count down. Null when nothing was stored. */
  expiresAt: string | null;
  /** Server-side verdict: the row reads as expired and offers no download. */
  expired: boolean;
}

export interface TranscriptionQuota {
  includedLimit: number;
  includedUsed: number;
  includedRemaining: number;
  month: string;
  monthResetsOn: string;
}

export type PodcastSourceHint = "apple" | "rss" | "episode_page" | "generic";

export interface ClassifiedTranscriptionSource {
  kind: TranscriptionSourceKind;
  url: string | null;
  supported: boolean;
  failure: TranscriptionFailure | null;
  podcastHint: PodcastSourceHint | null;
}

export interface PodcastEpisode {
  title: string | null;
  audioUrl: string;
  contentType: string | null;
  bytes: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  guid: string | null;
}

export interface PodcastFeed {
  feedUrl: string;
  title: string | null;
  episodes: PodcastEpisode[];
}

export interface CreateTranscriptionInput {
  url: string;
  diarize: boolean;
  languageHint?: string | null;
  title?: string | null;
}

export function getTranscriptionQuota() {
  return request<TranscriptionQuota>("/api/transcriptions/quota");
}

/** Pure classification, no network on the provider side — safe to call on paste. */
export function inspectTranscriptionSource(input: string) {
  return request<{ source: ClassifiedTranscriptionSource }>("/api/transcriptions/inspect", {
    method: "POST",
    body: JSON.stringify({ input }),
  });
}

/** Reads a feed so the teacher picks an episode instead of us guessing one. */
export function getPodcastEpisodes(url: string) {
  return request<{ feed: PodcastFeed }>(
    "/api/transcriptions/episodes",
    { method: "POST", body: JSON.stringify({ url }) },
    { timeoutMs: 30_000 }
  );
}

export function createTranscriptionJob(data: CreateTranscriptionInput) {
  return request<{ jobId: string }>("/api/transcriptions/jobs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Uploads the media itself. Generous timeout: a 64 MB file over a home
 * connection is minutes, not seconds, and aborting it at 15 s would look like
 * a bug rather than a slow upload.
 */
export function uploadTranscriptionFile(
  file: File,
  options: { diarize: boolean; languageHint?: string | null; title?: string | null }
) {
  const form = new FormData();
  form.append("file", file);
  form.append("diarize", options.diarize ? "true" : "false");
  if (options.languageHint) form.append("languageHint", options.languageHint);
  if (options.title) form.append("title", options.title);

  return request<{ jobId: string }>(
    "/api/transcriptions/jobs/upload",
    { method: "POST", body: form },
    { timeoutMs: 600_000, json: false }
  );
}

export function getTranscriptionJobs(limit = 20, offset = 0) {
  return request<{ jobs: TranscriptionJobSummary[] }>(
    `/api/transcriptions/jobs?limit=${limit}&offset=${offset}`
  );
}

export function getTranscriptionJob(id: string) {
  return request<{ job: TranscriptionJob }>(`/api/transcriptions/jobs/${id}`);
}

/**
 * The audio behind a transcript, for the reader's player. Whether there is any
 * left is a server-side question — an uploaded file is in R2, a pasted link may
 * have died since — so this always returns the URL for a finished job and the
 * player reports honestly when the media does not load.
 */
export function transcriptionMediaUrl(job: TranscriptionJob): string | null {
  if (job.status !== "completed" || job.expired) return null;
  return `/api/transcriptions/jobs/${job.id}/media`;
}

export function renameTranscriptionJob(id: string, title: string) {
  return request<{ title: string | null }>(`/api/transcriptions/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function deleteTranscriptionJob(id: string) {
  return request<{ deleted: boolean }>(`/api/transcriptions/jobs/${id}`, { method: "DELETE" });
}

/**
 * A download is a plain <a download>, so the interface language travels as a
 * query parameter — it is the only way the Worker can localise the one string
 * it renders (the "Speaker N" fallback).
 */
export function transcriptionDownloads(
  job: TranscriptionJob
): Record<"txt" | "srt" | "vtt" | "json", string> | null {
  if (!job.downloads) return null;
  const lang = getLanguage();
  return {
    txt: `${job.downloads.txt}?lang=${lang}`,
    srt: `${job.downloads.srt}?lang=${lang}`,
    vtt: `${job.downloads.vtt}?lang=${lang}`,
    json: `${job.downloads.json}?lang=${lang}`,
  };
}
