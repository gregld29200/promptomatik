/**
 * Typed API client for /api/* endpoints.
 * Returns { data, error } instead of throwing — keeps error handling explicit.
 */

export interface ApiError {
  error: string;
  status: number;
}

type ApiResult<T> = { data: T; error: null } | { data: null; error: ApiError };

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    return {
      data: null,
      error: { error: (body as { error?: string }).error ?? "Request failed", status: res.status },
    };
  }

  const data = (await res.json()) as T;
  return { data, error: null };
}

// ---- Auth types ----

export interface User {
  id: string;
  email: string;
  name: string;
  role: "teacher" | "admin";
}

interface LoginResponse {
  user: User;
}

interface MeResponse {
  user: User;
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

export interface Prompt {
  id: string;
  user_id: string;
  name: string;
  language: string;
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

export function analyzeIntent(text: string, language: string) {
  return request<{ intent: IntentAnalysis }>("/api/interview/analyze", {
    method: "POST",
    body: JSON.stringify({ text, language }),
  });
}

export function getQuestions(intent: IntentAnalysis, language: string) {
  return request<{ questions: InterviewQuestion[] }>("/api/interview/questions", {
    method: "POST",
    body: JSON.stringify({ intent, language }),
  });
}

export function assemblePrompt(
  intent: IntentAnalysis,
  answers: Record<string, string>,
  originalText: string,
  language: string
) {
  return request<AssembleResult>("/api/interview/assemble", {
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
  language: string
) {
  return request<{ refined: RefinedPrompt }>("/api/interview/refine", {
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

// ---- Prompt CRUD endpoints ----

export function createPrompt(data: {
  name: string;
  language?: string;
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
  expires_at: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  is_active: number;
  created_at: string;
}

// ---- Admin endpoints ----

export function sendInvitation(email: string) {
  return request<{ invitation: Invitation; email_sent: boolean }>(
    "/api/admin/invitations",
    { method: "POST", body: JSON.stringify({ email }) }
  );
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
