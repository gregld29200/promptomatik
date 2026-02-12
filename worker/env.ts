export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  RESEND_API_KEY: string;
  APP_SECRET: string;
  APP_URL?: string;
}
