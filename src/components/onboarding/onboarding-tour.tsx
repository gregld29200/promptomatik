import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { useOnboarding } from "@/lib/onboarding/onboarding-context";
import s from "./onboarding-tour.module.css";

type Rect = { left: number; top: number; width: number; height: number };

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function getRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

export function OnboardingTour() {
  const { state, step, steps, next, back, stop, complete } = useOnboarding();
  const location = useLocation();
  const navigate = useNavigate();
  const [rect, setRect] = useState<Rect | null>(null);

  const isLast = step ? steps.indexOf(step) === steps.length - 1 : false;

  // Keep route aligned with current step.
  useEffect(() => {
    if (!state.active || !step) return;
    if (location.pathname !== step.route) {
      navigate(step.route);
    }
  }, [state.active, step, location.pathname, navigate]);

  // Find target element and keep its rect updated.
  useEffect(() => {
    if (!state.active || !step) return;

    const selector = step.selector;
    let raf = 0;
    let cancelled = false;

    function tick() {
      if (cancelled) return;
      const el = document.querySelector(selector);
      setRect(el ? getRect(el) : null);
      raf = window.requestAnimationFrame(tick);
    }

    raf = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
    };
  }, [state.active, step?.selector, step?.id]);

  // Scroll element into view on step change.
  useEffect(() => {
    if (!state.active || !step) return;
    const el = document.querySelector(step.selector);
    if (el && "scrollIntoView" in el) {
      (el as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [state.active, step?.id, step?.selector]);

  // Advance on click (when requested).
  useEffect(() => {
    if (!state.active || !step) return;
    if (step.advanceOn !== "click") return;

    const selector = step.selector;
    const el = document.querySelector(selector);
    if (!el) return;

    function onClick() {
      // Allow the app's own click handler to run first.
      setTimeout(() => {
        if (isLast) {
          void complete();
        } else {
          next();
        }
      }, 0);
    }

    // Important: do not stop propagation; React uses delegated events.
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [state.active, step?.id, step?.selector, step?.advanceOn, next, isLast, complete]);

  const tooltipPos = useMemo(() => {
    if (!rect) return { left: 16, top: 16 };
    const pad = 12;
    const tooltipW = Math.min(360, window.innerWidth - 32);
    const left = clamp(rect.left, 16, window.innerWidth - tooltipW - 16);
    const top = rect.top + rect.height + pad;
    const finalTop = top + 180 > window.innerHeight ? rect.top - 180 - pad : top;
    return { left, top: clamp(finalTop, 16, window.innerHeight - 220) };
  }, [rect]);

  if (!state.active || !step) return null;

  const highlightStyle = rect
    ? {
        left: `${Math.max(0, rect.left - 6)}px`,
        top: `${Math.max(0, rect.top - 6)}px`,
        width: `${rect.width + 12}px`,
        height: `${rect.height + 12}px`,
      }
    : { left: "16px", top: "16px", width: "120px", height: "44px" };

  return (
    <div className={s.overlay} aria-hidden="true">
      <div className={s.dim} />
      <div className={s.highlight} style={highlightStyle} />

      <div className={s.tooltip} style={{ left: tooltipPos.left, top: tooltipPos.top }}>
        <p className={s.title}>{t(step.titleKey)}</p>
        <p className={s.body}>{t(step.bodyKey)}</p>

        <div className={s.controls}>
          <div className={s.controlsLeft}>
            <Button variant="ghost" size="small" type="button" onClick={stop}>
              {t("onboarding.skip")}
            </Button>
          </div>
          <div className={s.controlsRight}>
            <Button
              variant="secondary"
              size="small"
              type="button"
              onClick={back}
              disabled={steps.indexOf(step) === 0}
            >
              {t("onboarding.back")}
            </Button>
            <Button
              variant="cta"
              size="small"
              type="button"
              onClick={() => (isLast ? void complete() : next())}
            >
              {isLast ? t("onboarding.finish") : t("onboarding.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
