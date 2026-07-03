export interface Env {
  DB: D1Database;
  /** Browser Rendering (Documents module PDF output). */
  BROWSER: Fetcher;
  SESSIONS: KVNamespace;
  MEDIA: R2Bucket;
  INTERVIEW_JOBS_QUEUE: Queue<{ jobId: string }>;
  AUDIO_GENERATION_QUEUE: Queue<{ jobId: string; segmentIdx?: number; action?: "generate" | "assemble" }>;
  DOCUMENT_JOBS_QUEUE: Queue<{ jobId: string }>;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  TTS_MODEL_DRAFT?: string;
  TTS_MODEL_FINAL?: string;
  TTS_PRICE_AUDIO_PER_1M_TOKENS_DRAFT?: string;
  TTS_PRICE_AUDIO_PER_1M_TOKENS_FINAL?: string;
  LLM_MODEL_PREP?: string;
  /** Documents module generation model (OpenRouter id). */
  DOCS_MODEL?: string;
  GEMINI_API_KEY?: string;
  RESEND_API_KEY: string;
  APP_SECRET: string;
  APP_URL?: string;
  /** Optional — when set, self-signup activations are POSTed there (nurture sequence). */
  MARKETING_WEBHOOK_URL?: string;
  /** Stripe credit purchases (Audio Studio). Absent = purchase UI hidden. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PACK_60?: string;
  STRIPE_PRICE_PACK_180?: string;
}
