// The rename field, tested on the gesture that broke it.
//
// The defect: a teacher who select-alls, deletes, and starts typing "Claire"
// passes through an EMPTY field — and an empty custom name is exactly what the
// display logic turns back into "Intervenant 1". Feed that computed label back
// into the input and the field cannot be cleared: the fallback reappears, the
// caret parks after it, and the rename is unfinishable.
//
// Two halves, tested where each one lives:
//
//   * the gesture itself — keystroke by keystroke, against a deliberately
//     hostile page that stores the computed label instead of what it was given.
//     No DOM needed: the field's state rules are plain functions, precisely so
//     this sequence can be run rather than reasoned about.
//   * the markup — `react-dom/server`, like its neighbours: the localised name
//     reaches the placeholder and the accessible name, never the value.

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SpeakerRenameField,
  reseedSpeakerDraft,
  seedSpeakerDraft,
  typeInSpeakerDraft,
  type SpeakerDraft,
} from "./speaker-rename-field";
import { speakerDisplayLabel } from "./transcript-text";

const FALLBACK = "Intervenant 1";

function describeField(name: string): string {
  return `Renommer ${name}`;
}

function attribute(tag: string, name: string): string | null {
  const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return found ? found[1] : null;
}

function renderField(defaultName: string): string {
  return renderToStaticMarkup(
    <SpeakerRenameField
      defaultName={defaultName}
      fallbackName={FALLBACK}
      describe={describeField}
      onRename={() => {}}
    />
  );
}

/**
 * A page that does the wrong thing on purpose: it stores the *displayed* name,
 * so anything blank comes straight back as "Intervenant 1". The field has to
 * survive that, because a page cannot tell "the teacher cleared this" from "this
 * is empty" — only the field knows.
 */
function hostileStore(text: string): string {
  return speakerDisplayLabel(text, FALLBACK);
}

/** One keystroke: type, tell the page, take back whatever the page decided. */
function type(draft: SpeakerDraft, typed: string): SpeakerDraft {
  const next = typeInSpeakerDraft(draft, typed);
  return reseedSpeakerDraft(next, hostileStore(next.text));
}

describe("renaming a speaker", () => {
  it("lets the field be emptied, then filled — the whole rename gesture", () => {
    // Select all, delete, type "Claire" one letter at a time.
    let draft = reseedSpeakerDraft(seedSpeakerDraft(""), hostileStore(""));

    draft = type(draft, "");
    expect(draft.text, "cleared").toBe("");

    for (const step of ["C", "Cl", "Cla", "Clai", "Clair", "Claire"]) {
      draft = type(draft, step);
      expect(draft.text, step).toBe(step);
    }
    expect(draft.text).toBe("Claire");
  });

  it("never grows the fallback into the teacher's text", () => {
    // The exact shape of the old bug: "Intervenant 1Claire".
    let draft = seedSpeakerDraft("");
    draft = type(draft, "");
    draft = type(draft, "C");
    expect(draft.text).not.toContain(FALLBACK);
    expect(draft.text).toBe("C");
  });

  it("keeps a name mid-typing verbatim, trailing space included", () => {
    // `speakerDisplayLabel` trims for display; the field must not, or the caret
    // jumps back every time a space is typed.
    const draft = type(seedSpeakerDraft(""), "Claire ");
    expect(draft.text).toBe("Claire ");
  });

  it("takes a name that arrives late, while the field is untouched", () => {
    // A page that learns the saved names after the first render still fills the
    // field — the draft only claims ownership once someone has typed in it.
    const draft = reseedSpeakerDraft(seedSpeakerDraft(""), "Claire");
    expect(draft.text).toBe("Claire");
    expect(draft.typed).toBe(false);
  });

  it("stops taking names from the page once the teacher has typed", () => {
    const typed = typeInSpeakerDraft(seedSpeakerDraft(""), "Cl");
    expect(reseedSpeakerDraft(typed, "Claire Fontaine").text).toBe("Cl");
  });

  it("returns the same draft when there is nothing to change", () => {
    const draft = seedSpeakerDraft("Claire");
    expect(reseedSpeakerDraft(draft, "Claire")).toBe(draft);
  });
});

describe("the rendered rename field", () => {
  it("shows the stored name and offers the localised one as a placeholder", () => {
    const tag = renderField("Claire");
    expect(attribute(tag, "value")).toBe("Claire");
    expect(attribute(tag, "placeholder")).toBe(FALLBACK);
  });

  it("renders empty rather than pre-filled, so there is nothing to delete first", () => {
    const tag = renderField("");
    expect(attribute(tag, "value") ?? "").toBe("");
    expect(tag).not.toContain(`value="${FALLBACK}"`);
    expect(attribute(tag, "placeholder")).toBe(FALLBACK);
  });

  it("is announced by the name it holds, and by the fallback only when empty", () => {
    expect(attribute(renderField("Claire"), "aria-label")).toBe(describeField("Claire"));
    expect(attribute(renderField(""), "aria-label")).toBe(describeField(FALLBACK));
    expect(attribute(renderField("   "), "aria-label")).toBe(describeField(FALLBACK));
  });
});
