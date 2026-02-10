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
