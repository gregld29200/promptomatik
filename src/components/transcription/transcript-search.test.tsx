// The transcript reader's search, tested where it broke: the rendered output.
//
// The bug this file exists to prevent — highlighting that silently disappears
// whenever a turn renders word overlays, while the counter keeps claiming hits —
// was invisible to any test of the pure helpers alone, because the helpers were
// right and the *wiring* was wrong. So the load-bearing assertion here is on
// markup: the number of `<mark>` elements a transcript renders must equal
// `countTranscriptMatches`, in every rendering mode.
//
// Rendering is `react-dom/server` on purpose: no jsdom, no testing-library, no
// new dependency, and the assertion is about output rather than interaction.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  frenchInterviewFixture,
  frenchInterviewWithoutSpeakersFixture,
} from "./transcript-fixture";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  alignWordsToText,
  buildTurnSpans,
  collectMatches,
  countLowConfidence,
  countMatches,
  countTranscriptMatches,
  stepMatchCursor,
  type TranscriptMatch,
} from "./transcript-text";
import { TRANSCRIPT_HIT_ATTRIBUTE, TranscriptTurn, transcriptHitSelector } from "./transcript-turn";
import s from "./transcript-view.module.css";
import type { TranscriptSegment, TranslateFn } from "./types";

const segments = frenchInterviewFixture.segments;

/** Keys straight through, so no assertion here depends on a translation file. */
const translate: TranslateFn = (key, vars) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

interface RenderOptions {
  query: string;
  flagUncertain?: boolean;
  /** Playback position, which makes the turn it lands in render word overlays. */
  currentTime?: number | null;
  /** The match the stepper is parked on, as `TranscriptView` computes it. */
  current?: TranscriptMatch | null;
}

function renderTranscript(
  all: readonly TranscriptSegment[],
  { query, flagUncertain = false, currentTime = null, current = null }: RenderOptions
): string {
  return all
    .map((segment) =>
      renderToStaticMarkup(
        <TranscriptTurn
          segment={segment}
          translate={translate}
          speakerLabel={null}
          accentIndex={0}
          showTimestamp
          flagUncertain={flagUncertain}
          confidenceThreshold={DEFAULT_CONFIDENCE_THRESHOLD}
          query={query}
          currentHit={current !== null && current.turn === segment.idx ? current.hit : null}
          currentTime={currentTime}
          active={currentTime !== null && currentTime >= segment.start && currentTime < segment.end}
          copyText={() => segment.text}
        />
      )
    )
    .join("");
}

function countMarks(markup: string): number {
  return markup.split("<mark").length - 1;
}

function markTags(markup: string): string[] {
  return markup.match(/<mark\b[^>]*>/g) ?? [];
}

/** The hits wearing the stepper's ring. There must never be more than one. */
function currentMarks(markup: string): string[] {
  return markTags(markup).filter((tag) => tag.includes(s.hitCurrent));
}

/** The rank a mark was stamped with — what the stepper scrolls to. */
function hitRankOf(tag: string): string | null {
  const found = new RegExp(`${TRANSCRIPT_HIT_ATTRIBUTE}="([^"]*)"`).exec(tag);
  return found ? found[1] : null;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** A word inside the fixture that a real engine hesitated on, and its turn. */
function segmentWithUncertainWord(): TranscriptSegment {
  const found = segments.find((segment) =>
    segment.words.some(
      (word) => word.confidence !== null && word.confidence < DEFAULT_CONFIDENCE_THRESHOLD
    )
  );
  if (!found) throw new Error("fixture should carry low-confidence words");
  return found;
}

// A three-word query, an uppercased query with a typographic apostrophe, an
// unaccented query, and a query that straddles a flagged word. Every one of
// them contains a space, which is exactly what used to be unmatchable.
const MULTI_WORD_QUERIES = [
  "deux heures par",
  "AUJOURD’HUI JE",
  "a lyon",
  "claire fontaine",
] as const;

describe("search highlighting matches the counter", () => {
  it("the fixture really does contain every query we test", () => {
    for (const query of MULTI_WORD_QUERIES) {
      expect(countTranscriptMatches(segments, query), query).toBeGreaterThan(0);
    }
  });

  for (const query of MULTI_WORD_QUERIES) {
    it(`marks every match of "${query}" while reading plain prose`, () => {
      const expected = countTranscriptMatches(segments, query);
      expect(countMarks(renderTranscript(segments, { query }))).toBe(expected);
    });

    it(`marks every match of "${query}" with uncertain words flagged`, () => {
      const expected = countTranscriptMatches(segments, query);
      expect(countMarks(renderTranscript(segments, { query, flagUncertain: true }))).toBe(expected);
    });
  }

  it("keeps marking the turn the playback cursor is inside", () => {
    const query = "deux heures";
    const target = segments.find((segment) => countMatches(segment.text, query) > 0);
    if (!target) throw new Error("fixture should contain the query");
    // Mid-turn, so this turn renders word overlays — the state in which the
    // highlight used to vanish from the one turn a teacher is listening to.
    const currentTime = (target.start + target.end) / 2;

    const markup = renderTranscript(segments, { query, currentTime });
    expect(countMarks(markup)).toBe(countTranscriptMatches(segments, query));

    const turnMarkup = renderTranscript([target], { query, currentTime });
    expect(countMarks(turnMarkup)).toBe(countMatches(target.text, query));
    expect(countMarks(turnMarkup)).toBeGreaterThan(0);
  });

  it("marks nothing, and claims nothing, for a query the transcript lacks", () => {
    const query = "kangourou télépathe";
    expect(countTranscriptMatches(segments, query)).toBe(0);
    expect(countMarks(renderTranscript(segments, { query, flagUncertain: true }))).toBe(0);
  });

  it("holds for the Groq transcript too, which has no speakers", () => {
    const query = "deux heures par";
    const groq = frenchInterviewWithoutSpeakersFixture.segments;
    expect(countMarks(renderTranscript(groq, { query }))).toBe(countTranscriptMatches(groq, query));
    expect(countMarks(renderTranscript(groq, { query, flagUncertain: true }))).toBe(
      countTranscriptMatches(groq, query)
    );
  });
});

// The second defect this file exists to prevent, and the reason the assertions
// above were not enough: they only ever counted marks. Every mark looked the
// same, so the stepper could "move" from one hit to another inside the same turn
// and change literally nothing on screen — same scroll offset, same colour. On a
// 90-minute transcript most turns hold several hits, so most presses of "next"
// were invisible and the button read as broken.
describe("the stepper says which match it is on", () => {
  const QUERY = "temps";
  const matches = collectMatches(segments, QUERY);
  /** The first step that stays inside a turn — the case that used to do nothing. */
  const withinTurn = matches.findIndex(
    (match, at) => at > 0 && matches[at - 1].turn === match.turn
  );

  it("the fixture still packs several matches into one turn", () => {
    expect(matches.length).toBeGreaterThan(1);
    expect(withinTurn).toBeGreaterThan(0);
  });

  it("stamps every hit with its rank inside its turn, so a match can be scrolled to", () => {
    for (const segment of segments) {
      const total = countMatches(segment.text, QUERY);
      const tags = markTags(renderTranscript([segment], { query: QUERY }));
      expect(tags, `turn ${segment.idx}`).toHaveLength(total);
      expect(tags.map(hitRankOf), `turn ${segment.idx}`).toEqual(
        Array.from({ length: total }, (_, rank) => String(rank))
      );
    }
  });

  it("looks for the hit by the attribute it stamps", () => {
    expect(transcriptHitSelector(7, 1)).toBe(`#transcript-turn-7 [${TRANSCRIPT_HIT_ATTRIBUTE}="1"]`);
  });

  it("rings nothing until the teacher has stepped", () => {
    expect(currentMarks(renderTranscript(segments, { query: QUERY }))).toHaveLength(0);
  });

  it("rings exactly one hit, and the right one, wherever the cursor is", () => {
    for (let cursor = 0; cursor < matches.length; cursor += 1) {
      const marks = currentMarks(renderTranscript(segments, { query: QUERY, current: matches[cursor] }));
      expect(marks, `cursor ${cursor}`).toHaveLength(1);
      expect(hitRankOf(marks[0]), `cursor ${cursor}`).toBe(String(matches[cursor].hit));
      // Not a colour-only signal: assistive tech is told the same thing.
      expect(marks[0], `cursor ${cursor}`).toContain('aria-current="true"');
    }
  });

  it("advances the ring on every press, never landing twice in the same place", () => {
    let cursor: number | null = null;
    const landed: string[] = [];
    for (let press = 0; press < matches.length; press += 1) {
      cursor = stepMatchCursor(cursor, 1, matches.length);
      expect(cursor, `press ${press}`).not.toBeNull();
      const match = matches[cursor as number];
      const marks = currentMarks(renderTranscript(segments, { query: QUERY, current: match }));
      expect(marks, `press ${press}`).toHaveLength(1);
      landed.push(`${match.turn}/${hitRankOf(marks[0])}`);
    }
    expect(new Set(landed).size).toBe(matches.length);
  });

  it("changes the turn a teacher is looking at even when the step stays inside it", () => {
    // Two hits in one turn share a scroll offset, so this markup diff is the
    // only thing the press can possibly produce. It used to be empty.
    const match = matches[withinTurn];
    const turn = segments.find((segment) => segment.idx === match.turn);
    if (!turn) throw new Error("the match should point at a real turn");

    const before = renderTranscript([turn], { query: QUERY, current: matches[withinTurn - 1] });
    const after = renderTranscript([turn], { query: QUERY, current: match });
    expect(before).not.toBe(after);
    expect(hitRankOf(currentMarks(before)[0])).not.toBe(hitRankOf(currentMarks(after)[0]));
  });

  it("rings the current hit while the playback cursor is inside the same turn", () => {
    const match = matches[withinTurn];
    const turn = segments.find((segment) => segment.idx === match.turn);
    if (!turn) throw new Error("the match should point at a real turn");
    const markup = renderTranscript([turn], {
      query: QUERY,
      current: match,
      flagUncertain: true,
      currentTime: (turn.start + turn.end) / 2,
    });
    expect(currentMarks(markup)).toHaveLength(1);
    expect(countMarks(markup)).toBe(countMatches(turn.text, QUERY));
  });
});

describe("stepMatchCursor", () => {
  it("keeps 'not stepped yet' distinct from 'on the first match'", () => {
    // That distinction is what lets the toolbar stay silent instead of claiming
    // "1 sur 3" the moment a query is typed, before anything has moved.
    expect(stepMatchCursor(null, 1, 3)).toBe(0);
    expect(stepMatchCursor(null, -1, 3)).toBe(2);
  });

  it("wraps in both directions", () => {
    expect(stepMatchCursor(2, 1, 3)).toBe(0);
    expect(stepMatchCursor(0, -1, 3)).toBe(2);
    expect(stepMatchCursor(0, 1, 3)).toBe(1);
  });

  it("has nowhere to go when the query matches nothing", () => {
    expect(stepMatchCursor(null, 1, 0)).toBeNull();
    expect(stepMatchCursor(2, -1, 0)).toBeNull();
  });

  it("clamps a cursor left over from a longer list of results", () => {
    expect(stepMatchCursor(9, 1, 3)).toBe(0);
    expect(stepMatchCursor(9, -1, 3)).toBe(1);
  });
});

describe("word overlays survive the rewrite", () => {
  it("still flags every low-confidence word when asked", () => {
    const markup = renderTranscript(segments, { query: "", flagUncertain: true });
    expect(countOccurrences(markup, "transcription.uncertain_word_title:")).toBe(
      countLowConfidence(segments, DEFAULT_CONFIDENCE_THRESHOLD)
    );
  });

  it("flags nothing when the teacher has not asked", () => {
    const markup = renderTranscript(segments, { query: "" });
    expect(countOccurrences(markup, "transcription.uncertain_word_title:")).toBe(0);
  });

  it("announces each flagged word once, even when a match splits it", () => {
    const segment = segmentWithUncertainWord();
    const markup = renderTranscript([segment], { query: "claire fontaine", flagUncertain: true });
    expect(countOccurrences(markup, "transcription.uncertain_word_sr")).toBe(
      countLowConfidence([segment], DEFAULT_CONFIDENCE_THRESHOLD)
    );
  });
});

describe("buildTurnSpans", () => {
  const modes = [{ perWord: false }, { perWord: true }] as const;

  it("reproduces the segment text exactly, in both modes", () => {
    for (const segment of segments) {
      for (const options of modes) {
        for (const query of ["", "deux heures par", "a lyon"]) {
          const rebuilt = buildTurnSpans(segment, query, options)
            .flatMap((span) => span.parts)
            .map((part) => part.text)
            .join("");
          expect(rebuilt, `${segment.idx}/${options.perWord}/${query}`).toBe(segment.text);
        }
      }
    }
  });

  it("emits exactly one span per match, whatever the mode", () => {
    for (const segment of segments) {
      for (const options of modes) {
        for (const query of MULTI_WORD_QUERIES) {
          const hits = buildTurnSpans(segment, query, options).filter((span) => span.hit).length;
          expect(hits, `${segment.idx}/${options.perWord}/${query}`).toBe(
            countMatches(segment.text, query)
          );
        }
      }
    }
  });

  it("claims no words unless overlays are needed", () => {
    const segment = segments[0];
    const claimed = buildTurnSpans(segment, "", { perWord: false })
      .flatMap((span) => span.parts)
      .filter((part) => part.wordIndex !== null);
    expect(claimed).toHaveLength(0);
  });

  it("marks the end of a word so its a11y note lands once", () => {
    const segment = segments[0];
    const ends = buildTurnSpans(segment, "", { perWord: true })
      .flatMap((span) => span.parts)
      .filter((part) => part.wordEnd).length;
    expect(ends).toBe(segment.words.length);
  });
});

describe("alignWordsToText", () => {
  it("places every word of every fixture turn", () => {
    for (const segment of segments) {
      const ranges = alignWordsToText(segment.text, segment.words);
      expect(ranges, `segment ${segment.idx}`).toHaveLength(segment.words.length);
      for (const range of ranges) {
        expect(segment.text.slice(range.start, range.end)).toBe(segment.words[range.index].text);
      }
    }
  });

  it("walks forward, so a repeated word lands on its own occurrence", () => {
    const words = ["de", "temps", "en", "temps"].map((text) => ({
      text,
      start: 0,
      end: 1,
      speaker: null,
      confidence: null,
      language: null,
    }));
    const ranges = alignWordsToText("de temps en temps", words);
    expect(ranges.map((range) => range.start)).toEqual([0, 3, 9, 12]);
  });

  it("is accent- and apostrophe-insensitive about where a word sits", () => {
    const words = [{ text: "aujourd'hui", start: 0, end: 1, speaker: null, confidence: null, language: null }];
    const ranges = alignWordsToText("Aujourd’hui, oui.", words);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toMatchObject({ index: 0, start: 0, end: 11 });
  });

  it("skips a word the text does not contain rather than shifting the rest", () => {
    const words = ["une", "ghost", "réunion"].map((text) => ({
      text,
      start: 0,
      end: 1,
      speaker: null,
      confidence: null,
      language: null,
    }));
    const ranges = alignWordsToText("une réunion", words);
    expect(ranges.map((range) => range.index)).toEqual([0, 2]);
    expect(ranges[1]).toMatchObject({ start: 4, end: 11 });
  });

  it("still renders the text of a word it could not place", () => {
    const segment: TranscriptSegment = {
      idx: 0,
      speaker: null,
      start: 0,
      end: 2,
      // Whisper's segment text is not always a plain join of its word tokens.
      text: "Une réunion, en français.",
      words: ["Une", "reunion", "en", "francais"].map((text, index) => ({
        text,
        start: index * 0.5,
        end: index * 0.5 + 0.4,
        speaker: null,
        confidence: null,
        language: null,
      })),
      language: "fr",
    };
    const rebuilt = buildTurnSpans(segment, "réunion", { perWord: true })
      .flatMap((span) => span.parts)
      .map((part) => part.text)
      .join("");
    expect(rebuilt).toBe(segment.text);
    expect(countMarks(renderTranscript([segment], { query: "réunion", flagUncertain: true }))).toBe(
      countMatches(segment.text, "réunion")
    );
  });
});
