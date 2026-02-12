export interface Env {
  DB: D1Database;
  SESSIONS: KVNamespace;
  OPENROUTER_API_KEY: string;
  RESEND_API_KEY: string;
  APP_SECRET: string;
  APP_URL?: string;
}
