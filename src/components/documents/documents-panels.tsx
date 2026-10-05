import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Copy, RefreshCcw, Trash2, X } from "lucide-react";
import { getLanguage, t } from "@/lib/i18n";
import type * as api from "@/lib/api";
import s from "@/pages/documents.module.css";
import guide from "./documents-guide.module.css";

function localeForDates() {
  return getLanguage() === "fr" ? "fr-FR" : "en-US";
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(localeForDates(), {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ChoiceButtons<Value extends string>(props: {
  label: string;
  help: ReactNode;
  value: Value;
  options: Value[];
  keyPrefix: string;
  onChange: (value: Value) => void;
}) {
  return (
    <fieldset className={s.choiceGroup}>
      <legend>{props.label} {props.help}</legend>
      <div className={s.optionList}>
        {props.options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={props.value === option}
            className={props.value === option ? s.optionActive : ""}
            onClick={() => props.onChange(option)}
          >
            {t(`${props.keyPrefix}.${option}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function RecentJobs(props: {
  jobs: api.DocumentJobSummary[];
  loading: boolean;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <aside className={s.recentPanel}>
      <div className={s.panelTitle}>
        <div>
          <h2>{t("documents.recent_title")}</h2>
          <p>{t("documents.recent_intro")}</p>
        </div>
        <RefreshCcw size={18} aria-hidden />
      </div>
      {props.loading && <p className={s.muted}>{t("documents.recent_loading")}</p>}
      {!props.loading && props.jobs.length === 0 && <p className={s.muted}>{t("documents.recent_empty")}</p>}
      <div className={s.recentList}>
        {props.jobs.map((job) => (
          <div key={job.id} className={s.recentRow}>
            <button type="button" disabled={job.status !== "completed"} onClick={() => props.onOpen(job.id)}>
              <span>{job.label}</span>
              <small>{formatDate(job.createdAt)} · {t(`documents.status.${job.status}`)}</small>
            </button>
            <button
              type="button"
              className={s.recentDelete}
              title={t("common.delete")}
              aria-label={t("common.delete")}
              onClick={() => props.onDelete(job.id)}
            >
              <Trash2 size={15} aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}

export function GuideOverlay(props: { onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { onClose } = props;

  // A dialog the teacher can always leave: Escape, a click outside, or the
  // close button, which takes focus on open and stays pinned while scrolling.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, [onClose]);

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(t("documents.guide_gemini_prompt"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // Rendered at the top of the page so no sticky header can cover it.
  return createPortal(
    <div
      className={guide.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={guide.panel} role="dialog" aria-modal="true" aria-labelledby="documents-guide-title">
        <div className={guide.panelHead}>
          <p className={s.eyebrow}>{t("documents.guide_eyebrow")}</p>
          <button ref={closeRef} type="button" className={guide.closeButton} onClick={onClose} aria-label={t("common.close")}>
            <X size={18} aria-hidden />
          </button>
        </div>
        <h2 id="documents-guide-title">{t("documents.guide_title")}</h2>
        <ol className={guide.steps}>
          <li><h3>{t("documents.guide_step1_title")}</h3><p>{t("documents.guide_step1_body")}</p></li>
          <li><h3>{t("documents.guide_step2_title")}</h3><p>{t("documents.guide_step2_body")}</p></li>
          <li><h3>{t("documents.guide_step3_title")}</h3><p>{t("documents.guide_step3_body")}</p></li>
        </ol>
        <section className={guide.prompt}>
          <h3>{t("documents.guide_gemini_title")}</h3>
          <p>{t("documents.guide_gemini_body")}</p>
          <blockquote>{t("documents.guide_gemini_prompt")}</blockquote>
          <button type="button" className={s.iconText} onClick={() => void copyPrompt()}>
            <Copy size={16} aria-hidden /> {t("documents.guide_gemini_copy")}
          </button>
          <span aria-live="polite" className={s.muted}>{copied ? t("documents.guide_gemini_copied") : ""}</span>
        </section>
      </div>
    </div>,
    document.body,
  );
}
