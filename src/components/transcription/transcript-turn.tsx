// One speaker turn.
//
// The rendered string is always the provider's smart-formatted `segment.text` —
// the most comfortable thing to read, and the string the match counter counts.
// Word-level spans are an *overlay* on it, mapped by character offset, and only
// appear when the teacher enables something that needs them: flagged uncertain
// words, or the playback cursor. Search always runs over the whole turn, so a
// query with a space matches in every mode.

import { Fragment, memo, useMemo, type ReactNode } from "react";
import { CopyAction } from "./copy-action";
import {
  buildTurnSpans,
  formatTimecode,
  isLowConfidence,
  wordIndexAt,
  type TurnPart,
} from "./transcript-text";
import type { TranscriptSegment, TranslateFn } from "./types";
import s from "./transcript-view.module.css";

const ACCENT_CLASSES = [s.accent0, s.accent1, s.accent2, s.accent3] as const;

/**
 * Stamped on every search `<mark>` with its 0-based rank inside the turn. The
 * stepper scrolls to the match rather than to the turn — two hits in one turn
 * share a scroll offset, so scrolling to the turn made half the presses look
 * like nothing happened — and this is how it finds the one it just moved to.
 * A `data-` attribute rather than the CSS-module class, so the lookup does not
 * depend on how the bundler happens to hash a class name.
 */
export const TRANSCRIPT_HIT_ATTRIBUTE = "data-transcript-hit";

/** The `[data-transcript-hit="n"]` selector for one hit inside one turn. */
export function transcriptHitSelector(turn: number, hit: number): string {
  return `#transcript-turn-${turn} [${TRANSCRIPT_HIT_ATTRIBUTE}="${hit}"]`;
}

/** Written with a spread so the attribute name has exactly one source. */
function hitAttributes(rank: number): Record<string, string> {
  return { [TRANSCRIPT_HIT_ATTRIBUTE]: String(rank) };
}

export interface TranscriptTurnProps {
  segment: TranscriptSegment;
  translate: TranslateFn;
  /**
   * Already-localised speaker name, or null when this turn continues the
   * previous speaker (or the provider could not diarize at all).
   */
  speakerLabel: string | null;
  /** 0..3 — cycles, so speaker 5 reuses the first accent. */
  accentIndex: number;
  showTimestamp: boolean;
  flagUncertain: boolean;
  confidenceThreshold: number;
  /** Current search text; "" when the teacher is not searching. */
  query: string;
  /**
   * The hit inside THIS turn the search stepper is parked on, or null — which is
   * the case for every turn but one, so the memo bail-out below still skips the
   * whole transcript when the teacher steps.
   */
  currentHit: number | null;
  /** Playback position, or null when there is no player attached. */
  currentTime: number | null;
  active: boolean;
  onSeek?: (seconds: number) => void;
  /** Built lazily so a 90-minute transcript is only serialised on click. */
  copyText: () => string;
}

/**
 * Memoised on purpose. With a player attached, `TranscriptView` re-renders
 * several times a second; only the turn being spoken gets a changing
 * `currentTime`, so every other turn compares equal here and is skipped. A
 * 90-minute transcript is a thousand of these — without the bail-out, playback
 * would repaint all of them at every tick.
 */
function TranscriptTurnComponent({
  segment,
  translate,
  speakerLabel,
  accentIndex,
  showTimestamp,
  flagUncertain,
  confidenceThreshold,
  query,
  currentHit,
  currentTime,
  active,
  onSeek,
  copyText,
}: TranscriptTurnProps) {
  const timecode = formatTimecode(segment.start);
  const following = active && currentTime !== null;
  const activeWord = following ? wordIndexAt(segment.words, currentTime) : null;
  const perWord = flagUncertain || following;

  // The plan depends on the text, the query and whether overlays are needed —
  // not on the playback position, which changes several times a second.
  const plan = useMemo(() => buildTurnSpans(segment, query, { perWord }), [segment, query, perWord]);

  /**
   * The rank of each hit span among the hits of this turn, -1 for plain text.
   * Counted here rather than in the render loop so the numbering is a value the
   * markup is read off, not a side effect of iteration order.
   */
  const hitRanks = useMemo(() => {
    let seen = 0;
    return plan.map((span) => (span.hit ? seen++ : -1));
  }, [plan]);

  const renderPart = (part: TurnPart, key: number): ReactNode => {
    const word = part.wordIndex === null ? null : segment.words[part.wordIndex];
    if (!word) return <Fragment key={key}>{part.text}</Fragment>;

    const low = flagUncertain && isLowConfidence(word, confidenceThreshold);
    const now = activeWord === part.wordIndex;
    const wordClasses = [low ? s.uncertain : "", now ? s.wordNow : ""].filter(Boolean).join(" ");
    if (!wordClasses) return <Fragment key={key}>{part.text}</Fragment>;

    return (
      <span
        key={key}
        className={wordClasses}
        title={
          low
            ? translate("transcription.uncertain_word_title", {
                confidence: String(Math.round((word.confidence ?? 0) * 100)),
              })
            : undefined
        }
      >
        {part.text}
        {low && part.wordEnd && (
          <span className={s.srOnly}> ({translate("transcription.uncertain_word_sr")})</span>
        )}
      </span>
    );
  };

  const classes = [s.turn, ACCENT_CLASSES[accentIndex] ?? s.accent0, active ? s.turnActive : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={classes}
      id={`transcript-turn-${segment.idx}`}
      aria-current={active ? "true" : undefined}
    >
      <div className={s.turnGutter}>
        {showTimestamp &&
          (onSeek ? (
            <button
              type="button"
              className={s.timecodeButton}
              onClick={() => onSeek(segment.start)}
              title={translate("transcription.seek_to", { time: timecode })}
              aria-label={translate("transcription.seek_to", { time: timecode })}
            >
              {timecode}
            </button>
          ) : (
            <span className={s.timecode}>
              <span className={s.srOnly}>{translate("transcription.timecode_label")} </span>
              {timecode}
            </span>
          ))}
      </div>

      <div className={s.turnBody}>
        {speakerLabel && (
          <p className={s.turnSpeaker}>
            <span className={s.speakerDot} aria-hidden />
            {speakerLabel}
          </p>
        )}
        <p className={s.turnText}>
          {plan.map((span, index) => {
            const parts = span.parts.map((part, at) => renderPart(part, at));
            if (!span.hit) return <Fragment key={index}>{parts}</Fragment>;
            const rank = hitRanks[index];
            // Every hit is gold; the one the stepper is on also gains a ring and
            // says so to assistive tech, so "next" is visible rather than felt.
            const here = rank === currentHit;
            return (
              <mark
                key={index}
                className={here ? `${s.hit} ${s.hitCurrent}` : s.hit}
                aria-current={here ? "true" : undefined}
                {...hitAttributes(rank)}
              >
                {parts}
              </mark>
            );
          })}
        </p>
      </div>

      <div className={s.turnActions}>
        <CopyAction
          iconOnly
          text={copyText}
          label={translate("transcription.copy_turn", { time: timecode })}
          copiedLabel={translate("transcription.copied")}
          failedLabel={translate("transcription.copy_failed")}
        />
      </div>
    </article>
  );
}

export const TranscriptTurn = memo(TranscriptTurnComponent);
