// One copy control, two shapes: a labelled button for the toolbar and an
// icon-only button for a single turn. Every string arrives already translated —
// this component never reads a translation file.

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { copyToClipboard } from "./copy-to-clipboard";
import s from "./transcript-view.module.css";

type CopyState = "idle" | "copied" | "failed";

interface CopyActionProps {
  /** Resolved lazily so a long transcript is only serialised on click. */
  text: string | (() => string);
  /** Visible label, and the accessible name when `iconOnly`. */
  label: string;
  copiedLabel: string;
  /** Shown when both clipboard paths fail. */
  failedLabel: string;
  iconOnly?: boolean;
  className?: string;
}

const RESET_DELAY_MS = 2200;

export function CopyAction({
  text,
  label,
  copiedLabel,
  failedLabel,
  iconOnly = false,
  className,
}: CopyActionProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const handleCopy = useCallback(() => {
    const payload = typeof text === "function" ? text() : text;
    // Fire inside the gesture: awaiting first would lose the user activation
    // that iOS requires.
    void copyToClipboard(payload).then((ok) => {
      setState(ok ? "copied" : "failed");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setState("idle"), RESET_DELAY_MS);
    });
  }, [text]);

  const current = state === "copied" ? copiedLabel : state === "failed" ? failedLabel : label;
  const classes = [s.copyAction, iconOnly ? s.copyActionIcon : "", className].filter(Boolean).join(" ");
  const size = iconOnly ? 17 : 15;

  return (
    <>
      <button
        type="button"
        className={classes}
        onClick={handleCopy}
        data-state={state}
        title={current}
        aria-label={iconOnly ? current : undefined}
      >
        {state === "copied" ? (
          <Check size={size} aria-hidden />
        ) : state === "failed" ? (
          <TriangleAlert size={size} aria-hidden />
        ) : (
          <Copy size={size} aria-hidden />
        )}
        {!iconOnly && <span>{current}</span>}
      </button>
      {/* Announced once per copy, for teachers who cannot see the tick. */}
      <span role="status" aria-live="polite" className={s.srOnly}>
        {state === "copied" ? copiedLabel : state === "failed" ? failedLabel : ""}
      </span>
    </>
  );
}
