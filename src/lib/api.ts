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
  options: string[];
  allow_freetext: boolean;
}

export interface AssembledPrompt {
  name: string;
  blocks: PromptBlock[];
  model_recommendation: string;
  model_recommendation_reason: string;
  source_type: "from_scratch" | "from_source";
  suggested_tags: string[];
}

export interface Prompt {
  id: string;
  user_id: string;
  name: string;
  language: string;
  tags: string[];
  blocks: PromptBlock[];
  model_recommendation: string | null;
  model_recommendation_reason: string | null;
  source_type: string;
  is_template: boolean;
  template_id: string | null;
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
  return request<{ prompt: AssembledPrompt }>("/api/interview/assemble", {
    method: "POST",
    body: JSON.stringify({
      intent,
      answers,
      original_text: originalText,
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
  model_recommendation?: string;
  model_recommendation_reason?: string;
  source_type?: string;
}) {
  return request<{ prompt: Prompt }>("/api/prompts", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function getPrompts() {
  return request<{ prompts: Prompt[] }>("/api/prompts");
}

export function getPrompt(id: string) {
  return request<{ prompt: Prompt }>(`/api/prompts/${id}`);
}

export function updatePrompt(
  id: string,
  data: { name?: string; tags?: string[]; blocks?: PromptBlock[] }
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
