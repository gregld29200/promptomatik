import type { ReactNode } from "react";
import { RefreshCcw, X } from "lucide-react";
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
          <button key={job.id} type="button" disabled={job.status !== "completed"} onClick={() => props.onOpen(job.id)}>
            <span>{job.label}</span>
            <small>{formatDate(job.createdAt)} · {t(`documents.status.${job.status}`)}</small>
          </button>
        ))}
      </div>
    </aside>
  );
}

export function GuideOverlay(props: { onClose: () => void }) {
  return (
    <div className={guide.overlay} role="dialog" aria-modal="true" aria-labelledby="documents-guide-title">
      <div className={guide.panel}>
        <button type="button" className={guide.closeButton} onClick={props.onClose} aria-label={t("common.close")}><X size={18} /></button>
        <p className={s.eyebrow}>{t("documents.guide_eyebrow")}</p>
        <h2 id="documents-guide-title">{t("documents.guide_title")}</h2>
        <div className={guide.grid}>
          <section><h3>{t("documents.guide_paste_title")}</h3><p>{t("documents.guide_paste_body")}</p></section>
          <section><h3>{t("documents.guide_result_title")}</h3><p>{t("documents.guide_result_body")}</p></section>
          <section><h3>{t("documents.guide_timing_title")}</h3><p>{t("documents.guide_timing_body")}</p></section>
          <section><h3>{t("documents.guide_pdf_title")}</h3><p>{t("documents.guide_pdf_body")}</p></section>
        </div>
      </div>
    </div>
  );
}
