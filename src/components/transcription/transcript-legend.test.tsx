// The speaker legend and the search counters, tested on the rendered output.
//
// The bug this file exists to prevent: the rename field used to be fed the
// *computed* speaker label, so it could not be emptied. Blank the field and
// React immediately re-rendered the localised fallback into it and parked the
// caret after it, so the natural rename gesture — select all, backspace, type —
// produced "Intervenant 1Claire", in the field and in its accessible name. No
// helper test could see that: the helpers were right, the `value` was wrong. So
// the load-bearing assertion here is that the field's `value` is what the
// teacher typed, byte for byte, and the localised name is only a `placeholder`.
//
// Same rendering approach as `transcript-search.test.tsx`: `react-dom/server`,
// no jsdom, no testing-library, assertions on markup.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  frenchInterviewFixture,
  frenchInterviewWithoutSpeakersFixture,
} from "./transcript-fixture";
import {
  collectMatchTurns,
  countTranscriptMatches,
  speakerDisplayLabel,
} from "./transcript-text";
import { TranscriptView, type TranscriptViewProps } from "./transcript-view";
import type { TranslateFn } from "./types";

/** Keys straight through, so no assertion here depends on a translation file. */
const translate: TranslateFn = (key, vars) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

const FALLBACK_ONE = "transcription.speaker_n:1";
const FALLBACK_TWO = "transcription.speaker_n:2";

function render(props: Partial<TranscriptViewProps> = {}): string {
  return renderToStaticMarkup(
    <TranscriptView transcript={frenchInterviewFixture} translate={translate} {...props} />
  );
}

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return found ? found[1] : null;
}

interface RenderedField {
  tag: string;
  value: string | null;
  placeholder: string | null;
  ariaLabel: string | null;
}

/** The legend rename fields. The search box is `type="search"`, so it is out. */
function renameFields(markup: string): RenderedField[] {
  const tags = markup.match(/<input\b[^>]*type="text"[^>]*>/g) ?? [];
  return tags.map((tag) => ({
    tag,
    value: attribute(tag, "value"),
    placeholder: attribute(tag, "placeholder"),
    ariaLabel: attribute(tag, "aria-label"),
  }));
}

/** The page without its form fields — what a teacher reads. */
function proseOf(markup: string): string {
  return markup.replace(/<input\b[^>]*>/g, "");
}

describe("speaker rename field", () => {
  it("starts empty, with the localised name as its placeholder", () => {
    const fields = renameFields(render({ onRenameSpeaker: () => {} }));

    expect(fields).toHaveLength(frenchInterviewFixture.speakers.length);
    expect(fields.map((field) => field.value ?? "")).toEqual(["", ""]);
    expect(fields.map((field) => field.placeholder)).toEqual([FALLBACK_ONE, FALLBACK_TWO]);
  });

  it("never round-trips the computed label through the value", () => {
    // The whole defect in one assertion: if the fallback ever reaches `value`,
    // the field cannot be cleared and the next keystroke appends to it.
    for (const field of renameFields(render({ onRenameSpeaker: () => {} }))) {
      expect(field.tag).not.toContain(`value="transcription.speaker_n`);
    }
  });

  it("holds the teacher's name verbatim, trailing space included", () => {
    // Mid-typing state. `speakerDisplayLabel` trims for display; the field must
    // not, or the caret jumps every time a space is typed.
    const [first] = renameFields(render({ speakerNames: { "0": "Claire " }, onRenameSpeaker: () => {} }));
    expect(first.value).toBe("Claire ");
    expect(first.placeholder).toBe(FALLBACK_ONE);
  });

  it("keeps a name that is only spaces in the field, and out of the transcript", () => {
    const markup = render({ speakerNames: { "0": "   " }, onRenameSpeaker: () => {} });
    const [first] = renameFields(markup);
    expect(first.value).toBe("   ");
    // Display still falls back, so the turns never show a blank speaker.
    expect(proseOf(markup)).toContain(FALLBACK_ONE);
  });

  it("names the field after one speaker, never a concatenation of two", () => {
    const named = renameFields(render({ speakerNames: { "0": "Claire" }, onRenameSpeaker: () => {} }));
    expect(named[0].ariaLabel).toBe("transcription.speaker_rename:Claire");
    expect(named[0].ariaLabel).not.toContain("speaker_n");

    const unnamed = renameFields(render({ onRenameSpeaker: () => {} }));
    expect(unnamed[0].ariaLabel).toBe(`transcription.speaker_rename:${FALLBACK_ONE}`);
  });

  it("puts a teacher's name in the transcript itself, not only in the legend", () => {
    const prose = proseOf(render({ speakerNames: { "0": "Claire" }, onRenameSpeaker: () => {} }));
    expect(prose).toContain("Claire");
    expect(prose).not.toContain(FALLBACK_ONE);
    // The second speaker is still unnamed, so their fallback stays.
    expect(prose).toContain(FALLBACK_TWO);
  });

  it("offers no field at all when the page cannot accept a rename", () => {
    const markup = render({ speakerNames: { "0": "Claire" } });
    expect(renameFields(markup)).toHaveLength(0);
    expect(markup).toContain("Claire");
  });

  it("offers no field for a transcript with no speakers", () => {
    const markup = renderToStaticMarkup(
      <TranscriptView
        transcript={frenchInterviewWithoutSpeakersFixture}
        translate={translate}
        onRenameSpeaker={() => {}}
      />
    );
    expect(renameFields(markup)).toHaveLength(0);
    expect(markup).not.toContain("transcription.speakers_legend");
  });
});

describe("speakerDisplayLabel", () => {
  it("prefers the teacher's name, trimmed", () => {
    expect(speakerDisplayLabel("  Claire  ", FALLBACK_ONE)).toBe("Claire");
  });

  it("falls back for every shade of absent", () => {
    expect(speakerDisplayLabel("", FALLBACK_ONE)).toBe(FALLBACK_ONE);
    expect(speakerDisplayLabel("   ", FALLBACK_ONE)).toBe(FALLBACK_ONE);
    expect(speakerDisplayLabel(null, FALLBACK_ONE)).toBe(FALLBACK_ONE);
    expect(speakerDisplayLabel(undefined, FALLBACK_ONE)).toBe(FALLBACK_ONE);
  });
});

describe("search has one denominator", () => {
  const segments = frenchInterviewFixture.segments;

  // "temps" occurs more often than the number of turns containing it, which is
  // what used to make the two counters on screen disagree.
  const QUERIES = ["temps", "de temps", "aujourd’hui", "à Lyon"] as const;

  it("counts as many steps as there are highlights", () => {
    for (const query of QUERIES) {
      const total = countTranscriptMatches(segments, query);
      expect(total, query).toBeGreaterThan(0);
      expect(collectMatchTurns(segments, query), query).toHaveLength(total);
    }
  });

  it("counts occurrences, not turns, so repeats inside one turn are reachable", () => {
    const repeated = collectMatchTurns(segments, "temps");
    const distinctTurns = new Set(repeated);
    expect(repeated.length).toBeGreaterThan(distinctTurns.size);
  });

  it("points every step at a real turn, in reading order", () => {
    const turns = collectMatchTurns(segments, "temps");
    const known = new Set(segments.map((segment) => segment.idx));
    for (const idx of turns) expect(known.has(idx)).toBe(true);
    expect([...turns]).toEqual([...turns].sort((a, b) => a - b));
  });

  it("still has a step to offer when there is exactly one match", () => {
    // The stepper renders from one match up, so a lone hit 80 minutes in is
    // something a teacher can actually be taken to.
    const query = "Claire Fontaine";
    expect(countTranscriptMatches(segments, query)).toBe(1);
    expect(collectMatchTurns(segments, query)).toHaveLength(1);
  });

  it("claims nothing without a query", () => {
    expect(collectMatchTurns(segments, "")).toEqual([]);
    expect(collectMatchTurns(segments, "   ")).toEqual([]);
  });
});
