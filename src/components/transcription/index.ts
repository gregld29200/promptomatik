export { TranscriptView, type TranscriptViewProps } from "./transcript-view";
export {
  TRANSCRIPT_HIT_ATTRIBUTE,
  TranscriptTurn,
  transcriptHitSelector,
  type TranscriptTurnProps,
} from "./transcript-turn";
export {
  SpeakerRenameField,
  reseedSpeakerDraft,
  seedSpeakerDraft,
  typeInSpeakerDraft,
  type SpeakerDraft,
  type SpeakerRenameFieldProps,
} from "./speaker-rename-field";
export { CopyAction } from "./copy-action";
export { copyToClipboard } from "./copy-to-clipboard";
export {
  DEFAULT_CONFIDENCE_THRESHOLD,
  SPEAKER_ACCENT_COUNT,
  alignWordsToText,
  buildTurnSpans,
  collectMatchTurns,
  collectMatches,
  countLowConfidence,
  countMatches,
  countTranscriptMatches,
  countWords,
  foldForSearch,
  formatTimecode,
  isLowConfidence,
  isSegmentActive,
  joinWords,
  segmentToCopyText,
  speakerAccentIndex,
  speakerDisplayLabel,
  splitByQuery,
  stepMatchCursor,
  transcriptToCopyText,
  wordIndexAt,
  type TextSpan,
  type TranscriptMatch,
  type TurnPart,
  type TurnSpan,
  type WordRange,
} from "./transcript-text";
export {
  frenchInterviewFixture,
  frenchInterviewWithoutSpeakersFixture,
} from "./transcript-fixture";
export {
  TRANSCRIPT_DOWNLOAD_FORMATS,
  type TranscriptCopyOptions,
  type TranscriptData,
  type TranscriptDownloadFormat,
  type TranscriptDownloads,
  type TranscriptMetadata,
  type TranscriptSegment,
  type TranscriptSpeaker,
  type TranscriptWord,
  type TranslateFn,
} from "./types";
