// Transcription Studio — what a teacher walks away with.
//
// ---------------------------------------------------------------------------
// WHY THESE TWO FORMATS (txt / vtt) AND NOT MARKDOWN, SRT OR JSON
// ---------------------------------------------------------------------------
// The set is not a free choice: `TRANSCRIPTION_DOWNLOAD_FORMATS` in
// transcription-jobs.ts is the single source of truth, `rowToTranscriptionJob`
// emits exactly those links, and `TranscriptView` renders exactly those buttons.
// A third format here would be a route nobody can reach.
//
// It is also the right set for this audience:
//   * txt  — the one a language teacher actually uses. It already carries the
//            speaker turns and the timecodes, and it pastes into Word, Docs and
//            a worksheet without turning into syntax. Markdown would put literal
//            `**` and `##` in front of a teacher pasting into the exact editors
//            they prepare lessons in, which is worse than plain text, not better.
//   * vtt  — subtitling a video for a listening activity (an <track> element,
//            an LMS player).
//
// srt and json were dropped deliberately (Greg, 2026-08-10): srt duplicated
// vtt's job, and json exposed the internal transcript shape as if it were a
// public contract. Note that srt is the more widely supported subtitle format
// of the two — VLC, YouTube and most video editors prefer it — so if teachers
// ask why their subtitles will not load, restoring srt is the first thing to
// try: add it back to TRANSCRIPTION_DOWNLOAD_FORMATS, re-add the case below and
// the `download_srt` i18n key, and `renderTranscriptSrt` is in git history.
//
// ---------------------------------------------------------------------------
// THE ONE STRING THIS MODULE RENDERS
// ---------------------------------------------------------------------------
// A download is an <a download> link, so the SPA cannot hand the Worker its
// rendered strings, and the Worker has no i18n runtime. Exactly one word is
// needed — the "Speaker N" fallback — so it lives in SPEAKER_LABEL below and
// the route passes `?lang=`. `transcription-download.test.ts` asserts that table
// is character-identical to `transcription.speaker_n` in fr/en/es, so it cannot
// drift away from the interface.
//
// Speaker names the teacher typed into the legend are deliberately NOT applied:
// they are unsaved view state, and a download that silently used a stale or
// half-typed name would be worse than the canonical numbering.

import type { NormalisedTranscript, TranscriptSegment, TranscriptWord } from "./transcription/types";
import type { TranscriptionDownloadFormat } from "./transcription-jobs";

export const TRANSCRIPT_DOWNLOAD_LANGUAGES = ["fr", "en", "es"] as const;
export type TranscriptDownloadLanguage = (typeof TRANSCRIPT_DOWNLOAD_LANGUAGES)[number];

export function isTranscriptDownloadLanguage(value: string): value is TranscriptDownloadLanguage {
  return TRANSCRIPT_DOWNLOAD_LANGUAGES.includes(value as TranscriptDownloadLanguage);
}

/** Mirrors `transcription.speaker_n` in src/lib/i18n/{fr,en,es}.json. Pinned by a test. */
export const SPEAKER_LABEL: Record<TranscriptDownloadLanguage, string> = {
  fr: "Intervenant {{index}}",
  en: "Speaker {{index}}",
  es: "Interlocutor {{index}}",
};

/** Subtitle cue limits — two comfortable lines, read at a normal pace. */
const CUE_MAX_CHARS = 84;
const CUE_MAX_SECONDS = 7;
const CUE_MAX_WORDS = 16;

function pad(value: number, size: number): string {
  return String(Math.max(0, Math.floor(value))).padStart(size, "0");
}

/** `HH:MM:SS` + a separator + milliseconds. SRT uses a comma, WebVTT a dot. */
function timestamp(seconds: number, msSeparator: "," | "."): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const ms = Math.round((safe - whole) * 1000);
  return `${pad(whole / 3600, 2)}:${pad((whole % 3600) / 60, 2)}:${pad(whole % 60, 2)}${msSeparator}${pad(ms, 3)}`;
}

/** `MM:SS`, or `H:MM:SS` past an hour — the reading timecode, not a cue timestamp. */
export function readableTimecode(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = safe % 60;
  return hours > 0 ? `${hours}:${pad(minutes, 2)}:${pad(rest, 2)}` : `${pad(minutes, 2)}:${pad(rest, 2)}`;
}

function speakerLabel(
  transcript: NormalisedTranscript,
  speakerId: string | null,
  lang: TranscriptDownloadLanguage
): string | null {
  if (speakerId === null) return null;
  const known = transcript.speakers.find((speaker) => speaker.id === speakerId);
  const index = (known?.index ?? 0) + 1;
  return SPEAKER_LABEL[lang].replace("{{index}}", String(index));
}

interface Cue {
  start: number;
  end: number;
  text: string;
  speaker: string | null;
}

/**
 * Split a turn into readable cues.
 *
 * A diarized turn can run for a minute; dumping it into one subtitle cue makes
 * an unusable file. When we have word timings we chunk on them (chars, seconds
 * and word count, whichever hits first) so each cue keeps honest boundaries.
 * With no words — which no current provider produces, but the shape allows —
 * the segment becomes a single cue rather than being silently dropped.
 */
function segmentToCues(segment: TranscriptSegment): Cue[] {
  const words = segment.words.filter((word) => word.text.trim().length > 0);
  if (words.length === 0) {
    const text = segment.text.trim();
    return text.length > 0 ? [{ start: segment.start, end: segment.end, text, speaker: segment.speaker }] : [];
  }

  const cues: Cue[] = [];
  let batch: TranscriptWord[] = [];

  const flush = () => {
    if (batch.length === 0) return;
    cues.push({
      start: batch[0].start,
      end: batch[batch.length - 1].end,
      text: batch.map((word) => word.text.trim()).join(" "),
      speaker: segment.speaker,
    });
    batch = [];
  };

  for (const word of words) {
    const chars = batch.reduce((total, item) => total + item.text.trim().length + 1, 0);
    const span = batch.length > 0 ? word.end - batch[0].start : 0;
    if (
      batch.length > 0 &&
      (chars + word.text.trim().length > CUE_MAX_CHARS ||
        span > CUE_MAX_SECONDS ||
        batch.length >= CUE_MAX_WORDS)
    ) {
      flush();
    }
    batch.push(word);
  }
  flush();
  return cues;
}

function allCues(transcript: NormalisedTranscript): Cue[] {
  return transcript.segments.flatMap(segmentToCues);
}

/**
 * Plain text, laid out as an interview: a short factual header, then one
 * timecoded block per turn. Blank-line separated so it survives a paste into
 * any word processor with its structure intact.
 */
export function renderTranscriptTxt(
  transcript: NormalisedTranscript,
  title: string,
  lang: TranscriptDownloadLanguage
): string {
  const { metadata } = transcript;
  const facts = [
    readableTimecode(metadata.durationSeconds),
    ...(metadata.detectedLanguages.length > 0 ? [metadata.detectedLanguages.join(", ").toUpperCase()] : []),
    metadata.model,
  ].join(" · ");

  const body = transcript.segments.map((segment) => {
    const label = speakerLabel(transcript, segment.speaker, lang);
    const head = label
      ? `[${readableTimecode(segment.start)}] ${label}`
      : `[${readableTimecode(segment.start)}]`;
    return `${head}\n${segment.text.trim()}`;
  });

  return `${[title.trim() || "—", facts].join("\n")}\n\n${body.join("\n\n")}`.trimEnd() + "\n";
}


export function renderTranscriptVtt(
  transcript: NormalisedTranscript,
  lang: TranscriptDownloadLanguage
): string {
  const cues = allCues(transcript).map((cue) => {
    const label = speakerLabel(transcript, cue.speaker, lang);
    // `<v Name>` is the WebVTT voice span — players show it as an attribution
    // instead of printing the name into the subtitle line.
    const text = label ? `<v ${label}>${cue.text}` : cue.text;
    return `${timestamp(cue.start, ".")} --> ${timestamp(cue.end, ".")}\n${text}\n`;
  });
  return ["WEBVTT", "", ...cues].join("\n");
}

/** URL-safe, accent-folded, short. Never empty. */
export function transcriptFilenameStem(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "transcription";
}

export interface RenderedTranscriptDownload {
  body: string;
  contentType: string;
  filename: string;
}

export function renderTranscriptDownload(
  format: TranscriptionDownloadFormat,
  transcript: NormalisedTranscript,
  title: string,
  lang: TranscriptDownloadLanguage
): RenderedTranscriptDownload {
  const stem = transcriptFilenameStem(title);
  switch (format) {
    case "txt":
      return {
        body: renderTranscriptTxt(transcript, title, lang),
        contentType: "text/plain; charset=utf-8",
        filename: `${stem}.txt`,
      };
    case "vtt":
      return {
        body: renderTranscriptVtt(transcript, lang),
        contentType: "text/vtt; charset=utf-8",
        filename: `${stem}.vtt`,
      };
  }
}
