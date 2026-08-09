// The field a teacher renames a speaker in.
//
// It is one text input, and it has its own file because it needs its own state.
//
// ---------------------------------------------------------------------------
// WHY THE FIELD OWNS ITS TEXT
// ---------------------------------------------------------------------------
// The rename gesture is: select all, delete, type "Claire". The middle of that
// gesture is an EMPTY field — and an empty custom name is exactly what
// `speakerDisplayLabel` turns back into the localised "Intervenant 1". So any
// arrangement where the displayed label can reach the input's `value` makes the
// field impossible to clear: the fallback reappears, the caret parks after it,
// and the next keystroke produces "Intervenant 1Claire".
//
// Feeding the input the raw stored name instead is necessary but not sufficient,
// because it leaves the field at the mercy of whatever the page does with what
// it is told. A page that trims, or drops empty names, or re-derives them from a
// label, yanks the text back out from under the teacher mid-word.
//
// So the field holds a draft. `defaultName` SEEDS it — the React `defaultValue`
// convention, and the same contract: it is an initial value, not a control. Once
// the teacher has typed, nothing the page stores can overwrite the field. To
// reset it (a different transcript, a cleared name list), unmount it or change
// its `key`, which is how the reading view already treats one field per speaker.
//
// The localised "Intervenant 1" still has a job here: it is the `placeholder`
// (typed over, never appended to) and the display name the field is announced
// by. It is never the `value`.

import { useState } from "react";
import { speakerDisplayLabel } from "./transcript-text";

/** The text in a rename field, and how it got there. */
export interface SpeakerDraft {
  /**
   * What the field shows, verbatim. Empty and whitespace-only are both
   * legitimate: they are a teacher part-way through a rename.
   */
  readonly text: string;
  /** The stored name this draft was seeded from. */
  readonly seed: string;
  /** True once the teacher has typed, after which the page never wins again. */
  readonly typed: boolean;
}

export function seedSpeakerDraft(defaultName: string): SpeakerDraft {
  return { text: defaultName, seed: defaultName, typed: false };
}

/** A keystroke. The field becomes exactly what was typed — including nothing. */
export function typeInSpeakerDraft(draft: SpeakerDraft, typed: string): SpeakerDraft {
  return { text: typed, seed: draft.seed, typed: true };
}

/**
 * A `defaultName` arriving from the page.
 *
 * An untouched field takes it, so a page that learns the names late (a job still
 * loading) still fills the field. A field the teacher has typed in ignores it
 * entirely — that is the whole point: the page cannot tell "the teacher cleared
 * this" from "this is empty", and its answer to an empty name is the localised
 * fallback, which is precisely the value that must never land here.
 *
 * Returns the same object when nothing changes, so the caller can compare by
 * identity.
 */
export function reseedSpeakerDraft(draft: SpeakerDraft, defaultName: string): SpeakerDraft {
  if (draft.typed || defaultName === draft.seed) return draft;
  return seedSpeakerDraft(defaultName);
}

export interface SpeakerRenameFieldProps {
  /**
   * The name the page already holds for this speaker. Seeds the field; never
   * controls it. Empty when the speaker has no teacher-given name yet.
   */
  defaultName: string;
  /** Localised "Intervenant 1": the placeholder and the display fallback. */
  fallbackName: string;
  /** Builds the accessible name from the name the field currently holds. */
  describe: (displayName: string) => string;
  onRename: (name: string) => void;
  className?: string;
}

export function SpeakerRenameField({
  defaultName,
  fallbackName,
  describe,
  onRename,
  className,
}: SpeakerRenameFieldProps) {
  const [draft, setDraft] = useState(() => seedSpeakerDraft(defaultName));
  // Adjusting state while rendering, which React supports for exactly this:
  // deriving from props without an effect and without a wasted commit. Reads as
  // the current render's value below, so the field is never one render stale.
  const reseeded = reseedSpeakerDraft(draft, defaultName);
  if (reseeded !== draft) setDraft(reseeded);

  return (
    <input
      type="text"
      className={className}
      value={reseeded.text}
      placeholder={fallbackName}
      onChange={(event) => {
        const typed = event.target.value;
        setDraft((current) => typeInSpeakerDraft(current, typed));
        onRename(typed);
      }}
      aria-label={describe(speakerDisplayLabel(reseeded.text, fallbackName))}
    />
  );
}
