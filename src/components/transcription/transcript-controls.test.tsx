// The transcript reader's working controls, tested on the rendered output.
//
// Two defects this file exists to prevent, both found by review on a real page:
//
//   1. Nothing was pinned. Search, copy, the downloads and the display toggles
//      all scrolled away — on a 90-minute transcript (the single-file cap) the
//      teacher had to scroll back to the top to search. Stickiness itself is
//      CSS, but it only works if the bar and the turns are SIBLINGS inside one
//      ordinary block container: a sticky grid item is confined to its own row
//      and never moves. That structure is what is asserted here.
//   2. The view flagged uncertain words with no way to hear them. Given
//      `audioSrc`, every timecode must be a seek button; given none, it must
//      stay an inert span rather than pretend to seek.
//
// Same approach as its neighbours: `react-dom/server`, no jsdom, assertions on
// markup.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { frenchInterviewFixture } from "./transcript-fixture";
import { TranscriptView, type TranscriptViewProps } from "./transcript-view";
import type { TranslateFn } from "./types";
import s from "./transcript-view.module.css";

/** Keys straight through, so no assertion here depends on a translation file. */
const translate: TranslateFn = (key, vars) =>
  vars ? `${key}:${Object.values(vars).join(",")}` : key;

function render(props: Partial<TranscriptViewProps> = {}): string {
  return renderToStaticMarkup(
    <TranscriptView transcript={frenchInterviewFixture} translate={translate} {...props} />
  );
}

const MEDIA = "/api/transcriptions/jobs/abc/media";

describe("the controls stay within reach", () => {
  it("puts the controls and the turns in one block container, in that order", () => {
    const markup = render();
    const body = markup.indexOf(`class="${s.body}"`);
    const controls = markup.indexOf(`class="${s.controls}"`);
    const turns = markup.indexOf(`class="${s.turns}"`);

    // All three present, and nested body > (controls, turns) in reading order:
    // that is the shape `position: sticky` needs to have anything to stick in.
    expect(body).toBeGreaterThan(-1);
    expect(controls).toBeGreaterThan(body);
    expect(turns).toBeGreaterThan(controls);
  });

  it("keeps search, copy and the downloads inside the pinned bar", () => {
    const markup = render({
      downloads: { txt: "/t.txt", vtt: "/t.vtt" },
    });
    const bar = markup.slice(
      markup.indexOf(`class="${s.controls}"`),
      markup.indexOf(`class="${s.turns}"`)
    );

    expect(bar).toContain("transcription.search_label");
    expect(bar).toContain("transcription.copy_all");
    for (const format of ["txt", "vtt"]) {
      expect(bar, format).toContain(`transcription.download_${format}`);
    }
    expect(bar).toContain("transcription.reading_options");
  });
});

describe("a flagged word can be listened to", () => {
  it("renders a player and turns every timecode into a seek button", () => {
    const markup = render({ audioSrc: MEDIA });

    expect(markup).toContain("<audio");
    expect(markup).toContain(MEDIA);
    expect(markup).toContain("transcription.player_label");
    // One seek control per turn, and no inert timecode left behind.
    const seeks = markup.split("transcription.seek_to:").length - 1;
    expect(seeks).toBe(frenchInterviewFixture.segments.length * 2); // title + aria-label
    expect(markup).not.toContain("transcription.timecode_label");
  });

  it("stays honest with no media: no player, and timecodes that do not pretend", () => {
    const markup = render();

    expect(markup).not.toContain("<audio");
    expect(markup).not.toContain("transcription.seek_to");
    expect(markup).toContain("transcription.timecode_label");
  });

  it("still lets a page own the player, as the props always allowed", () => {
    const markup = render({ onSeek: () => {} });

    expect(markup).not.toContain("<audio");
    expect(markup).toContain("transcription.seek_to");
  });
});

describe("the page can own the title", () => {
  it("drops its own heading when the page carries the name, keeping the metadata", () => {
    const withTitle = render({ title: "Entretien avec Claire" });
    expect(withTitle).toContain("Entretien avec Claire");
    expect(withTitle).toContain("transcription.transcript_eyebrow");

    const without = render({ title: "Entretien avec Claire", showTitle: false });
    expect(without).not.toContain("Entretien avec Claire");
    expect(without).not.toContain("transcription.transcript_eyebrow");
    // The figures a teacher checks are not part of the title.
    expect(without).toContain("transcription.meta_duration");
    expect(without).toContain("transcription.meta_words");
  });
});
