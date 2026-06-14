export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  INTERVIEW_JOBS_QUEUE: Queue<{ jobId: string }>;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  RESEND_API_KEY: string;
  APP_SECRET: string;
  APP_URL?: string;
  /** Optional — when set, self-signup activations are POSTed there (nurture sequence). */
  MARKETING_WEBHOOK_URL?: string;
}
