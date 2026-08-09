// "How much you have left", once.
//
// The Studio meters three different allowances — daily prompt generations, audio
// minutes, transcription hours — and each had grown its own visual dialect: a
// topbar pill, a card with a progress ring, a filled strip. Three dialects for
// one idea is three things a teacher has to learn.
//
// Two of the three use this today: the topbar counter (quota-chip.tsx) and the
// transcription hours (transcribe.tsx). The Audio Studio's progress ring is
// deliberately untouched — Slice 1 changed no audio behaviour — and is the next
// caller to convert, not an exception to keep.
//
// So this is the primitive, and it takes only what a teacher reads: a label, the
// figure, an optional reset line, and whether the allowance is spent. It owns no
// strings and no arithmetic — a monthly ledger in seconds and a daily counter in
// generations do not share a unit, and pretending they do would put formatting
// decisions in the wrong place. Callers pass formatted text.
//
// Two shapes:
//   * `block` — a bordered panel with label, figure and reset line, for a page
//     header (see transcribe.tsx);
//   * `pill` — inline and label-less, for the shell topbar (see quota-chip.tsx).
//     There is no room for a separate label there, so a pill's `value` must name
//     what it counts ("Generations today: 3/5") and `label` becomes the
//     tooltip.

import type { ReactNode } from "react";
import s from "./allowance.module.css";

export interface AllowanceProps {
  /** What is being counted: "Heures de transcription", "Générations du jour". */
  label: string;
  /** The figure itself, already formatted and localised by the caller. */
  value: string;
  /** When it comes back, when that is knowable. `block` only. */
  reset?: string | null;
  /** Nothing left. Carries a colour change AND its own wording from the caller. */
  exhausted?: boolean;
  variant?: "block" | "pill";
  /** A small leading glyph, for the pill in the topbar. */
  icon?: ReactNode;
  /** `end` right-aligns the block, for a header sitting on the right. */
  align?: "start" | "end";
  className?: string;
}

export function Allowance({
  label,
  value,
  reset,
  exhausted = false,
  variant = "block",
  icon,
  align = "start",
  className,
}: AllowanceProps) {
  if (variant === "pill") {
    return (
      <span
        className={[s.pill, className].filter(Boolean).join(" ")}
        data-exhausted={exhausted || undefined}
        title={label}
      >
        {icon}
        {value}
      </span>
    );
  }

  return (
    <div
      className={[s.block, className].filter(Boolean).join(" ")}
      data-exhausted={exhausted || undefined}
      data-align={align}
    >
      <span className={s.blockLabel}>{label}</span>
      <strong className={s.blockValue}>{value}</strong>
      {reset && <span className={s.blockReset}>{reset}</span>}
    </div>
  );
}
