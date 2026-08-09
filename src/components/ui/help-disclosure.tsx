// The little "?" beside a label, and the paragraph it reveals.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A COMPONENT AND NOT A THIRD COPY
// ---------------------------------------------------------------------------
// Three studios grew their own `helpDot`: the Audio Studio (18px, no
// `aria-controls`), Documents (24px, no `aria-controls`) and the Transcription
// Studio (44px target, `aria-controls`). Same idiom, three implementations, and
// the two things that actually matter — a tappable target and a declared
// relationship between the trigger and the text — existed only in the newest
// one. So a teacher on a phone could not reliably hit the Audio Studio's dot,
// and a screen-reader user was told a disclosure was expanded without being told
// what it expanded.
//
// TARGET SIZE WITHOUT LAYOUT COST. The glyph stays small — it is a footnote
// marker, not a button — so the hit area is grown with an absolutely positioned
// ::after rather than by growing the box. A 44px box would shove the label text
// sideways on all three pages; an overlay changes nothing visual and still gives
// a full 44x44 target (WCAG 2.2 AA asks 24px; 44px is the phone-thumb figure the
// Transcription Studio was already aiming at, and it is now real rather than
// clipped by the negative margins it used to need).
//
// THE PANEL IS ALWAYS RENDERED, hidden with `hidden` when closed. `aria-controls`
// must point at an element that exists, or the relationship it declares is a lie
// — which is what happens when a page renders the paragraph only while open.
//
// Colour is left to the page: pass `className`, and the page's own module keeps
// owning the tone (teal in the Audio Studio, accent in Documents, navy here).

import type { ReactNode } from "react";
import { Info } from "lucide-react";
import s from "./help-disclosure.module.css";

export interface HelpDotProps {
  /** The accessible name. There is no visible text, so this is the only name. */
  label: string;
  expanded: boolean;
  /** id of the `HelpPanel` this trigger reveals. */
  controls: string;
  onToggle: () => void;
  /** Page-owned styling — colour, mostly. Geometry stays here. */
  className?: string;
  /** Glyph size in px. The TARGET is 44px whatever this says. */
  size?: number;
}

export function HelpDot({ label, expanded, controls, onToggle, className, size = 14 }: HelpDotProps) {
  return (
    <button
      type="button"
      className={className ? `${s.dot} ${className}` : s.dot}
      aria-label={label}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={(event) => {
        // These sit inside labels and legends on two of the three pages, where a
        // click would otherwise be forwarded to the control the label names.
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <Info size={size} aria-hidden />
    </button>
  );
}

export interface HelpPanelProps {
  id: string;
  open: boolean;
  /** Page-owned styling for the revealed text. */
  className?: string;
  children: ReactNode;
}

export function HelpPanel({ id, open, className, children }: HelpPanelProps) {
  return (
    <p id={id} className={className} hidden={!open}>
      {children}
    </p>
  );
}

/**
 * A stable id for one page's nth panel, from a single `useId()` base.
 *
 * Pages that key many disclosures off one piece of state (the Audio Studio has a
 * dozen) cannot call `useId()` per dot, because the dots are built inside a
 * helper rather than at the top of the component.
 */
export function helpPanelId(base: string, key: string): string {
  return `${base}-${key}`;
}
