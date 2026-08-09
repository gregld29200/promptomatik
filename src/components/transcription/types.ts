// Transcription Studio — the shape the reading UI consumes.
//
// These interfaces MIRROR `worker/lib/transcription/types.ts` field for field.
// They are re-declared here rather than imported because `tsconfig.app.json`
// only includes `src`, and the SPA must not reach into the Worker build.
// Because TypeScript is structural, whatever `src/lib/api.ts` ends up declaring
// for the transcript payload is assignable to these props as long as the fields
// match the contract — no adapter, no cast, no `any`.

/** One word with its timing. `speaker` is null for every Groq/Whisper job. */
export interface TranscriptWord {
  text: string;
  /** Seconds from the start of the media. */
  start: number;
  end: number;
  speaker: string | null;
  /** 0..1, or null when the provider reports no per-word confidence. */
  confidence: number | null;
  language: string | null;
}

/** A speaker turn. Consecutive turns may share a speaker — the view groups them. */
export interface TranscriptSegment {
  idx: number;
  speaker: string | null;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
  language: string | null;
}

export interface TranscriptSpeaker {
  id: string;
  /** 0-based order of first appearance — drives the localised "Speaker N" label. */
  index: number;
  /** Provider-side raw label. Never shown to a teacher. */
  label: string;
  seconds: number;
}

export interface TranscriptMetadata {
  /**
   * Three tiers, mirroring `TranscriptionProviderId` in the Worker contract.
   * `assemblyai` is the universal backstop and reaches a teacher's screen
   * whenever the cascade fell through, so it must be in this union: leaving it
   * out did not make it impossible, it only made the type wrong about the wire
   * and left the engine label falling back to a raw model id.
   */
  provider: "groq" | "deepgram" | "assemblyai";
  providerJobId: string | null;
  model: string;
  durationSeconds: number;
  detectedLanguages: string[];
  /** True only when the words really carry speakers. Always false for Groq. */
  diarization: boolean;
  speakerCount: number | null;
  /** Always 1 — a single channel is forced so neither provider double-bills. */
  channels: number;
}

/** Structural mirror of `NormalisedTranscript`. */
export interface TranscriptData {
  metadata: TranscriptMetadata;
  speakers: TranscriptSpeaker[];
  segments: TranscriptSegment[];
  text: string;
}

export const TRANSCRIPT_DOWNLOAD_FORMATS = ["txt", "srt", "vtt", "json"] as const;
export type TranscriptDownloadFormat = (typeof TRANSCRIPT_DOWNLOAD_FORMATS)[number];

/** `{ txt: "/api/transcriptions/jobs/:id/download/txt", … }` as the API returns it. */
export type TranscriptDownloads = Readonly<Partial<Record<TranscriptDownloadFormat, string>>>;

/**
 * The translate function, passed in from the page. Same signature as
 * `t()` in `src/lib/i18n` — these components never import it directly, so a
 * teacher-facing string can only ever come from a translation file.
 */
export type TranslateFn = (key: string, vars?: Record<string, string>) => string;

/** What "copy" produces, mirroring what the teacher is currently looking at. */
export interface TranscriptCopyOptions {
  timestamps: boolean;
  speakers: boolean;
}
