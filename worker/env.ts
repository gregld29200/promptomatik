export interface Env {
  DB: D1Database;
  /** Browser Rendering (Documents module PDF output). */
  BROWSER: Fetcher;
  ASSETS: Fetcher;
  SESSIONS: KVNamespace;
  MEDIA: R2Bucket;
  INTERVIEW_JOBS_QUEUE: Queue<{ jobId: string }>;
  AUDIO_GENERATION_QUEUE: Queue<{ jobId: string; segmentIdx?: number; action?: "generate" | "assemble" }>;
  DOCUMENT_JOBS_QUEUE: Queue<{ jobId: string }>;
  TRANSCRIPTION_JOBS_QUEUE: Queue<{ jobId: string }>;
  OPENROUTER_API_KEY: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_FALLBACK_MODEL?: string;
  TTS_MODEL_DRAFT?: string;
  TTS_MODEL_FINAL?: string;
  TTS_MODEL_MONOLOGUE?: string;
  TTS_PRICE_AUDIO_PER_1M_TOKENS_DRAFT?: string;
  TTS_PRICE_AUDIO_PER_1M_TOKENS_FINAL?: string;
  LLM_MODEL_PREP?: string;
  /** Documents module generation model (OpenRouter id). */
  DOCS_MODEL?: string;
  DOCS_STRUCTURE_MODEL?: string;
  GEMINI_API_KEY?: string;
  /**
   * Transcription Studio speech-to-text. All three optional so the app still
   * boots without them: `planTranscriptionRoute` drops an unconfigured tier from
   * the cascade, and `runTranscription` throws `provider_unavailable` only once
   * EVERY tier of the lane is gone — which the queue consumer treats as
   * retryable and never as the teacher's fault.
   * GROQ = whisper-large-v3-turbo (default path, no diarization).
   * DEEPGRAM = nova-3 multilingual (the "identify speakers" path).
   * ASSEMBLYAI = universal-3.5-pro (tier 3, the universal backstop — it can
   * serve both lanes, so it substitutes for either provider above).
   */
  GROQ_API_KEY?: string;
  DEEPGRAM_API_KEY?: string;
  ASSEMBLYAI_API_KEY?: string;
  RESEND_API_KEY: string;
  APP_SECRET: string;
  APP_URL?: string;
  /** Optional — when set, self-signup activations are POSTed there (nurture sequence). */
  MARKETING_WEBHOOK_URL?: string;
  /** Stripe credit purchases (Audio Studio). Absent = purchase UI hidden. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  // Shared secret for /api/internal/* machine calls (testimonial credit grant).
  TESTIMONIAL_GRANT_SECRET?: string;
  /**
   * YouTube ingest sidecar (containers/youtube-ingest). Both must be set or
   * YouTube links get the honest "not available right now" refusal. The URL is
   * the service origin (e.g. https://teachinspire-yt-ingest.fly.dev); the
   * secret is the Bearer token the sidecar was deployed with.
   */
  YOUTUBE_INGEST_URL?: string;
  YOUTUBE_INGEST_SECRET?: string;
  STRIPE_PRICE_PACK_60?: string;
  STRIPE_PRICE_PACK_180?: string;
}
