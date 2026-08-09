// Transcription Studio — the reading experience.
//
// A transcript is not a data dump: it is a document a teacher reads, mines for a
// quotation, and pastes into a worksheet. So the defaults are reading defaults —
// one comfortable column, quiet timestamps in a gutter, speaker turns that scan
// like a printed interview — and everything noisier (word-level confidence, the
// playback cursor) is opt-in or player-driven.
//
// This component owns no data and no strings. It takes a transcript, a
// `translate` function, and optional player/rename callbacks. The page owns the
// API calls, the media URL and the i18n files.
//
// ---------------------------------------------------------------------------
// TWO THINGS THAT MUST STAY WITHIN REACH
// ---------------------------------------------------------------------------
// A single file can be 90 minutes long, so the transcript is taller than any
// screen. Two consequences are designed for rather than discovered:
//
//   * The working controls — search, the display toggles, copy, the downloads
//     and the player — live in a `position: sticky` bar. Reading page 40 and
//     wanting to search must not mean scrolling back to page 1. Sticky needs a
//     containing block taller than itself, which a grid item never is, so
//     everything below the header sits in `.body` (normal flow) and the bar
//     sticks inside it.
//   * "Uncertain passages" flags words the engine hesitated on, which is only
//     useful if the teacher can HEAR them. Pass `audioSrc` and the view runs its
//     own player: every timestamp becomes a seek button, and the flagged word is
//     one click from the audio. When the media is gone (an external link that
//     died), the player says so and the timestamps go quiet again — they never
//     pretend to seek something that cannot play.
//
// ---------------------------------------------------------------------------
// i18n keys this component asks for (all under the single `transcription` key):
//   transcript_eyebrow, transcript_aria, untitled_transcript, transcript_empty
//   meta_duration, meta_words, meta_speakers, meta_languages, meta_model
//   engine_fast, engine_speakers, engine_versatile
//   language_fr language_en language_es language_de language_it language_pt
//   diarization_unavailable_title, diarization_unavailable_body
//   reading_options, option_timestamps, option_speakers, option_uncertain
//   uncertain_summary {{count}}, uncertain_summary_one
//   uncertain_word_sr, uncertain_word_title {{confidence}}
//   search_label, search_placeholder, search_clear
//   search_matches {{count}}, search_matches_one, search_no_matches
//   search_position {{index}} {{total}}, search_previous, search_next
//   copy_all, copy_turn {{time}}, copied, copy_failed
//   downloads_label, download_txt, download_srt, download_vtt, download_json
//   speakers_legend, speaker_n {{index}}, speaker_rename {{speaker}}, speaker_time {{time}}
//   seek_to {{time}}, timecode_label
//   player_label, player_hint, player_unavailable
//
// Notes for whoever writes those strings:
//   * `speaker_n` is used twice — as the fallback name in the transcript and as
//     the placeholder of the rename field — so it must read as a name on its
//     own ("Intervenant 1"), never as a hint ("Nommer cet intervenant").
//   * `search_matches` and `uncertain_summary` receive a {{count}} that really
//     does reach 1, so each has a `_one` sibling the component picks instead —
//     `t()` is a bare {{var}} replace with no plural support.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, Search, X } from "lucide-react";
import { CopyAction } from "./copy-action";
import { SpeakerRenameField } from "./speaker-rename-field";
import { TranscriptTurn, transcriptHitSelector } from "./transcript-turn";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  collectMatches,
  countLowConfidence,
  countWords,
  formatTimecode,
  isSegmentActive,
  segmentToCopyText,
  speakerAccentIndex,
  speakerDisplayLabel,
  stepMatchCursor,
  transcriptToCopyText,
  type TranscriptMatch,
} from "./transcript-text";
import {
  TRANSCRIPT_DOWNLOAD_FORMATS,
  type TranscriptCopyOptions,
  type TranscriptData,
  type TranscriptDownloads,
  type TranscriptMetadata,
  type TranslateFn,
} from "./types";
import s from "./transcript-view.module.css";

/** Four speaker accents, cycled. Mirrored in `transcript-turn.tsx`. */
const ACCENT_CLASSES = [s.accent0, s.accent1, s.accent2, s.accent3] as const;

/**
 * A teacher never needs to read "whisper-large-v3-turbo". What matters to them
 * is which of the three engines ran, in the same words the rest of the UI uses.
 * The raw model id stays in the `.json` download, for support traceback.
 *
 * The record is keyed by the union itself, so adding a fourth provider to the
 * contract is a type error here rather than a silent fall-through to the raw
 * model id — which is precisely how `assemblyai` came to print
 * "universal-3.5-pro" on a teacher's screen for one wave.
 */
const ENGINE_KEYS: Record<TranscriptMetadata["provider"], string> = {
  groq: "transcription.engine_fast",
  deepgram: "transcription.engine_speakers",
  // AssemblyAI serves BOTH lanes, so it is neither "the fast one" nor "the
  // speakers one" — it gets its own word rather than borrowing a label that
  // would be false half the time.
  assemblyai: "transcription.engine_versatile",
};

/** The languages that have a localised name in the catalogues. */
const NAMED_LANGUAGES = new Set(["fr", "en", "es", "de", "it", "pt"]);

/**
 * "fr" → "Français", "en-US" → "Anglais", "nl" → "NL". Providers report plain
 * ISO codes today, but a regional tag would still land on the right name.
 */
function languageName(translate: TranslateFn, code: string): string {
  const base = code.trim().toLowerCase().split(/[-_]/)[0];
  if (!NAMED_LANGUAGES.has(base)) return code.trim().toUpperCase();
  return translate(`transcription.language_${base}`);
}

/**
 * Scrolls the match itself into view, not the turn holding it.
 *
 * The difference is the whole stepper: a turn is one scroll offset, and turns
 * routinely hold two or three hits, so stepping between them used to move
 * nothing at all. Falls back to the turn if the mark is not in the DOM (a
 * transcript re-rendering under a fast typist), because landing near the match
 * still beats staying put.
 */
function revealMatch(match: TranscriptMatch): void {
  if (typeof document === "undefined") return;
  const target =
    document.querySelector(transcriptHitSelector(match.turn, match.hit)) ??
    document.getElementById(`transcript-turn-${match.turn}`);
  const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  target?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
}

export interface TranscriptViewProps {
  transcript: TranscriptData;
  translate: TranslateFn;
  /** The teacher's own title for the job, when there is one. */
  title?: string | null;
  /**
   * False when the page already carries the transcript's name as its own `h1`
   * (the reading route does), so the name is on screen exactly once. The
   * metadata line stays either way.
   */
  showTitle?: boolean;
  /**
   * Playable media for this transcript, when there is any. Given it, the view
   * runs its own player and every timestamp becomes a seek button — which is the
   * only thing that makes a flagged uncertain word actionable.
   */
  audioSrc?: string | null;
  /**
   * What the teacher asked for. When true and `metadata.diarization` is false,
   * the view explains why there are no speaker names — Whisper cannot diarize,
   * and silence about it reads as a bug.
   */
  diarizeRequested?: boolean;
  /** Playback position in seconds, when the page has a player. */
  currentTime?: number | null;
  /** Provided by a page with a player: turns their timestamps into seek buttons. */
  onSeek?: (seconds: number) => void;
  /** Teacher-given speaker names, keyed by `TranscriptSpeaker.id`. */
  speakerNames?: Readonly<Record<string, string>>;
  /** Provide to make the legend names editable. Controlled: update `speakerNames`. */
  onRenameSpeaker?: (speakerId: string, name: string) => void;
  downloads?: TranscriptDownloads | null;
  /** Words under this confidence can be flagged. 0..1. */
  confidenceThreshold?: number;
  className?: string;
}

export function TranscriptView({
  transcript,
  translate,
  title,
  showTitle = true,
  audioSrc = null,
  diarizeRequested = false,
  currentTime = null,
  onSeek,
  speakerNames,
  onRenameSpeaker,
  downloads,
  confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
  className,
}: TranscriptViewProps) {
  const { metadata, segments, speakers } = transcript;
  const diarized = metadata.diarization && speakers.length > 0;

  const [query, setQuery] = useState("");
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [showSpeakers, setShowSpeakers] = useState(true);
  const [flagUncertain, setFlagUncertain] = useState(false);

  const optionsLabelId = useId();
  const searchId = useId();

  const uncertainCount = useMemo(
    () => countLowConfidence(segments, confidenceThreshold),
    [segments, confidenceThreshold]
  );
  const wordCount = useMemo(() => countWords(segments), [segments]);
  /**
   * One entry per match — the turn it lives in, and its rank inside that turn.
   * Both the count and the stepper read this single array, so the two numbers on
   * screen always agree, and the stepper can point at one hit among several.
   */
  const matches = useMemo(() => collectMatches(segments, query), [segments, query]);
  const matchCount = matches.length;
  /**
   * null until the teacher steps: the first step lands on the first match, and
   * until then the toolbar shows a count without claiming a position. Saying
   * "1 sur 3" before anyone has moved is a lie about where the reader is.
   */
  const [matchCursor, setMatchCursor] = useState<number | null>(null);
  useEffect(() => setMatchCursor(null), [query]);
  const cursor =
    matchCursor !== null && matchCount > 0 ? Math.min(matchCursor, matchCount - 1) : null;
  /** The match the reader is parked on, or null while the teacher has not stepped. */
  const current = cursor !== null ? matches[cursor] : null;

  const goToMatch = useCallback(
    (offset: number) => {
      const next = stepMatchCursor(cursor, offset, matchCount);
      if (next === null) return;
      setMatchCursor(next);
      revealMatch(matches[next]);
    },
    [cursor, matchCount, matches]
  );

  /** The localised "Speaker N", from a speaker's 0-based order of appearance. */
  const fallbackLabelFor = useCallback(
    (index: number): string => {
      const safe = Number.isFinite(index) ? Math.max(0, Math.floor(index)) : 0;
      return translate("transcription.speaker_n", { index: String(safe + 1) });
    },
    [translate]
  );

  const speakerLabelFor = useCallback(
    (speakerId: string | null): string | null => {
      if (speakerId === null) return null;
      const known = speakers.find((speaker) => speaker.id === speakerId);
      return speakerDisplayLabel(speakerNames?.[speakerId], fallbackLabelFor(known?.index ?? 0));
    },
    [speakerNames, speakers, fallbackLabelFor]
  );

  const accentFor = useCallback(
    (speakerId: string | null): number => {
      if (speakerId === null) return 0;
      const known = speakers.find((speaker) => speaker.id === speakerId);
      return speakerAccentIndex(known?.index ?? 0);
    },
    [speakers]
  );

  const copyOptions = useMemo<TranscriptCopyOptions>(
    () => ({ timestamps: showTimestamps, speakers: diarized && showSpeakers }),
    [showTimestamps, diarized, showSpeakers]
  );

  const copyWholeTranscript = useCallback(
    () => transcriptToCopyText(segments, speakerLabelFor, copyOptions),
    [segments, speakerLabelFor, copyOptions]
  );

  /**
   * One stable closure per turn. Identity matters here: `TranscriptTurn` is
   * memoised, and a player updates this component several times a second — a
   * closure rebuilt on every render would re-render all 1 000 turns of a
   * 90-minute transcript instead of the one being spoken.
   */
  const copyTurnText = useMemo(
    () =>
      segments.map(
        (segment) => () => segmentToCopyText(segment, speakerLabelFor(segment.speaker), copyOptions)
      ),
    [segments, speakerLabelFor, copyOptions]
  );

  // ---- The player, when the page gave us media -----------------------------
  //
  // Owned here rather than by the page because it belongs IN the sticky bar:
  // seeking is a reading gesture, and a player that scrolls away is a player
  // that cannot answer "what did she actually say there?".
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);
  const [mediaFailed, setMediaFailed] = useState(false);
  useEffect(() => {
    setMediaFailed(false);
    setPlaybackTime(null);
  }, [audioSrc]);

  const seekPlayer = useCallback((seconds: number) => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = Math.max(0, seconds);
    setPlaybackTime(element.currentTime);
    // Clicking a timecode is a request to HEAR that passage. A play() the
    // browser refuses (no gesture yet, or media still loading) is not an error.
    void element.play().catch(() => undefined);
  }, []);

  /** Media we know is broken buys nothing: the timestamps go quiet again. */
  const playable = audioSrc !== null && audioSrc.length > 0 && !mediaFailed;
  const seek = onSeek ?? (playable ? seekPlayer : undefined);
  const position = currentTime ?? playbackTime;

  /**
   * Empty while the field is empty, so the live region below has something to
   * change TO. `t()` has no plural support, hence the explicit singular keys —
   * a count of 1 really does happen and "Résultats : 1" is wrong French.
   */
  const searchAnnouncement = !query.trim()
    ? ""
    : matchCount === 0
      ? translate("transcription.search_no_matches")
      : matchCount === 1
        ? translate("transcription.search_matches_one")
        : translate("transcription.search_matches", { count: String(matchCount) });

  /**
   * "2 sur 3", once the teacher has actually stepped — and only then. It is also
   * what the live region says from that point on: a teacher stepping wants to
   * hear where they are, not the total they already heard.
   */
  const positionLabel =
    cursor === null
      ? null
      : translate("transcription.search_position", {
          index: String(cursor + 1),
          total: String(matchCount),
        });

  const engineKey = ENGINE_KEYS[metadata.provider];
  const engineName = engineKey ? translate(engineKey) : metadata.model;
  /** De-duplicated so "fr" plus "fr-FR" does not read as "Français · Français". */
  const languageNames = Array.from(
    new Set(metadata.detectedLanguages.map((code) => languageName(translate, code)))
  ).filter((name) => name.length > 0);

  const classes = [s.view, className].filter(Boolean).join(" ");
  const downloadEntries = downloads
    ? TRANSCRIPT_DOWNLOAD_FORMATS.flatMap((format) => {
        const href = downloads[format];
        return href ? [{ format, href }] : [];
      })
    : [];

  return (
    <section className={classes} aria-label={translate("transcription.transcript_aria")}>
      <header className={s.head}>
        {/* Dropped when the page's own h1 is already this transcript's name —
            one document, one title. */}
        {showTitle && (
          <>
            <p className={s.eyebrow}>{translate("transcription.transcript_eyebrow")}</p>
            <h2 className={s.title}>
              {title?.trim() || translate("transcription.untitled_transcript")}
            </h2>
          </>
        )}

        <dl className={s.meta}>
          <div className={s.metaItem}>
            <dt>{translate("transcription.meta_duration")}</dt>
            <dd>{formatTimecode(metadata.durationSeconds)}</dd>
          </div>
          <div className={s.metaItem}>
            <dt>{translate("transcription.meta_words")}</dt>
            <dd>{wordCount}</dd>
          </div>
          {diarized && (
            <div className={s.metaItem}>
              <dt>{translate("transcription.meta_speakers")}</dt>
              <dd>{metadata.speakerCount ?? speakers.length}</dd>
            </div>
          )}
          {languageNames.length > 0 && (
            <div className={s.metaItem}>
              <dt>{translate("transcription.meta_languages")}</dt>
              <dd>{languageNames.join(" · ")}</dd>
            </div>
          )}
          <div className={s.metaItem}>
            <dt>{translate("transcription.meta_model")}</dt>
            <dd>{engineName}</dd>
          </div>
        </dl>
      </header>

      {diarizeRequested && !metadata.diarization && (
        <aside className={s.note}>
          <strong>{translate("transcription.diarization_unavailable_title")}</strong>
          <span>{translate("transcription.diarization_unavailable_body")}</span>
        </aside>
      )}

      {/* Everything below the header shares one ordinary block container, so the
          controls bar has something taller than itself to stick inside. */}
      <div className={s.body}>
        <div className={s.controls}>
        {playable && (
          <div className={s.player}>
            {/* Native controls on purpose: a teacher already knows them, they are
                keyboard-accessible for free, and this is a reading aid rather
                than a production tool. */}
            <audio
              ref={audio}
              className={s.playerElement}
              src={audioSrc ?? undefined}
              controls
              preload="metadata"
              aria-label={translate("transcription.player_label")}
              onTimeUpdate={(event) => setPlaybackTime(event.currentTarget.currentTime)}
              onError={() => setMediaFailed(true)}
            />
            <span className={s.playerHint}>{translate("transcription.player_hint")}</span>
          </div>
        )}
        {audioSrc !== null && audioSrc.length > 0 && mediaFailed && (
          <p className={s.playerGone}>{translate("transcription.player_unavailable")}</p>
        )}

        <div className={s.toolbar}>
          <div className={s.searchField}>
            <Search size={16} className={s.searchIcon} aria-hidden />
            <input
              id={searchId}
              type="search"
              className={s.searchInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              // Enter / Shift+Enter walk the results, the way every find bar does —
              // and it keeps working once the toolbar has scrolled out of sight.
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                goToMatch(event.shiftKey ? -1 : 1);
              }}
              placeholder={translate("transcription.search_placeholder")}
              aria-label={translate("transcription.search_label")}
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className={s.searchClear}
                onClick={() => setQuery("")}
                title={translate("transcription.search_clear")}
                aria-label={translate("transcription.search_clear")}
              >
                <X size={16} aria-hidden />
              </button>
            )}
          </div>

          <div className={s.options} role="group" aria-labelledby={optionsLabelId}>
            <span id={optionsLabelId} className={s.optionsLabel}>
              {translate("transcription.reading_options")}
            </span>
            <button
              type="button"
              className={s.chip}
              aria-pressed={showTimestamps}
              onClick={() => setShowTimestamps((value) => !value)}
            >
              {translate("transcription.option_timestamps")}
            </button>
            {diarized && (
              <button
                type="button"
                className={s.chip}
                aria-pressed={showSpeakers}
                onClick={() => setShowSpeakers((value) => !value)}
              >
                {translate("transcription.option_speakers")}
              </button>
            )}
            {uncertainCount > 0 && (
              <button
                type="button"
                className={s.chip}
                aria-pressed={flagUncertain}
                onClick={() => setFlagUncertain((value) => !value)}
              >
                {translate("transcription.option_uncertain")}
                <span className={s.chipCount}>{uncertainCount}</span>
              </button>
            )}
          </div>

          <div className={s.toolbarActions}>
            <CopyAction
              text={copyWholeTranscript}
              label={translate("transcription.copy_all")}
              copiedLabel={translate("transcription.copied")}
              failedLabel={translate("transcription.copy_failed")}
            />
            {downloadEntries.length > 0 && (
              <div className={s.downloads} role="group" aria-label={translate("transcription.downloads_label")}>
                <Download size={15} className={s.downloadIcon} aria-hidden />
                {downloadEntries.map(({ format, href }) => (
                  <a
                    key={format}
                    href={href}
                    download
                    className={s.downloadLink}
                    title={translate(`transcription.download_${format}`)}
                    aria-label={translate(`transcription.download_${format}`)}
                  >
                    {format.toUpperCase()}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Always mounted, text toggled — the CopyAction pattern. A role="status"
            inserted already populated is generally not announced, which would
            lose the first and most useful count. The visible line below keeps the
            same words for sighted teachers and carries no role, so the result is
            announced once, not twice. */}
        <span role="status" aria-live="polite" className={s.srOnly}>
          {positionLabel ?? searchAnnouncement}
        </span>

        {query.trim() && (
          <div className={s.searchStatus}>
            <p>{searchAnnouncement}</p>
            {/* Shown from the first match on: finding a hit and refusing to take
                the teacher to it is worse on a 90-minute transcript than on a
                short one, and one match is exactly when scrolling matters most. */}
            {matchCount > 0 && (
              <div className={s.searchNav}>
                {/* Only once the teacher has stepped: before that there is no
                    position to report, and inventing "1 sur 3" makes the first
                    press of "next" look like it did nothing. */}
                {positionLabel && <span className={s.searchPosition}>{positionLabel}</span>}
                <button
                  type="button"
                  className={s.searchStep}
                  onClick={() => goToMatch(-1)}
                  title={translate("transcription.search_previous")}
                  aria-label={translate("transcription.search_previous")}
                >
                  <ChevronUp size={16} aria-hidden />
                </button>
                <button
                  type="button"
                  className={s.searchStep}
                  onClick={() => goToMatch(1)}
                  title={translate("transcription.search_next")}
                  aria-label={translate("transcription.search_next")}
                >
                  <ChevronDown size={16} aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}
        </div>
        {/* end of the sticky controls */}

        {flagUncertain && (
          <p className={s.uncertainSummary}>
            {uncertainCount === 1
              ? translate("transcription.uncertain_summary_one")
              : translate("transcription.uncertain_summary", { count: String(uncertainCount) })}
          </p>
        )}

        {diarized && (
          <div className={s.legend}>
            <span className={s.legendLabel}>{translate("transcription.speakers_legend")}</span>
            <ul className={s.legendList}>
              {speakers.map((speaker) => {
                const fallback = fallbackLabelFor(speaker.index);
                // What the teacher typed, verbatim — including a name that is
                // empty or only spaces.
                const stored = speakerNames?.[speaker.id] ?? "";
                const label = speakerDisplayLabel(stored, fallback);
                const accent = speakerAccentIndex(speaker.index);
                return (
                  <li key={speaker.id} className={`${s.legendItem} ${ACCENT_CLASSES[accent] ?? ""}`}>
                    <span className={s.speakerDot} aria-hidden />
                    {onRenameSpeaker ? (
                      // The field owns its text — see `speaker-rename-field.tsx`.
                      // The computed label reaches only its placeholder and its
                      // accessible name, never its value: a field fed its own
                      // fallback cannot be emptied, and clearing it is the middle
                      // of every rename.
                      <SpeakerRenameField
                        key={speaker.id}
                        className={s.legendInput}
                        defaultName={stored}
                        fallbackName={fallback}
                        describe={(name) =>
                          translate("transcription.speaker_rename", { speaker: name })
                        }
                        onRename={(name) => onRenameSpeaker(speaker.id, name)}
                      />
                    ) : (
                      <span className={s.legendName}>{label}</span>
                    )}
                    <span className={s.legendTime}>
                      {translate("transcription.speaker_time", { time: formatTimecode(speaker.seconds) })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {segments.length === 0 ? (
          <p className={s.empty}>{translate("transcription.transcript_empty")}</p>
        ) : (
          <ol className={s.turns}>
            {segments.map((segment, index) => {
              const previous = index > 0 ? segments[index - 1] : null;
              const startsSpeaker = !previous || previous.speaker !== segment.speaker;
              const label =
                diarized && showSpeakers && startsSpeaker ? speakerLabelFor(segment.speaker) : null;
              return (
                <li key={segment.idx} className={s.turnItem}>
                  <TranscriptTurn
                    segment={segment}
                    translate={translate}
                    speakerLabel={label}
                    accentIndex={accentFor(segment.speaker)}
                    showTimestamp={showTimestamps}
                    flagUncertain={flagUncertain}
                    confidenceThreshold={confidenceThreshold}
                    query={query}
                    // Null for every turn but the one holding the current
                    // match, so stepping re-renders two turns rather than a
                    // thousand — and so exactly one hit can wear the ring.
                    currentHit={current !== null && current.turn === segment.idx ? current.hit : null}
                    // Only the turn being spoken is told the time: every other
                    // turn keeps identical props while the audio plays, so the
                    // memoised component skips them instead of re-rendering the
                    // whole transcript four times a second.
                    currentTime={isSegmentActive(segment, position) ? position : null}
                    active={isSegmentActive(segment, position)}
                    onSeek={seek}
                    copyText={copyTurnText[index]}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
