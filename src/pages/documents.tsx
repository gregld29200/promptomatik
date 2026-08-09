import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Copy, Download, FileText, HelpCircle, Loader2, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { HelpDot, HelpPanel, helpPanelId } from "@/components/ui/help-disclosure";
import { ChoiceButtons, GuideOverlay, RecentJobs } from "@/components/documents/documents-panels";
import { DocumentPreview } from "@/components/documents/document-preview";
import { SimpleDocumentOptions } from "@/components/documents/simple-document-options";
import { SimpleTemplatePicker } from "@/components/documents/simple-template-picker";
import { useAuth } from "@/lib/auth/auth-context";
import { getLanguage, t } from "@/lib/i18n";
import * as api from "@/lib/api";
import { materialToPlainText } from "@/lib/document-text";
import { materialUrl, parseEmphasisTerms } from "@/lib/document-presentation";
import {
  DOCUMENT_TYPES, DRAFT_KEY, EMPTY_DRAFT, LEVELS,
  documentErrorMessage, formatElapsed, presetLabel, wordCount,
  type DraftState, type ViewState,
} from "@/lib/documents-page";
import s from "./documents.module.css";
export function DocumentsPage() {
  const { isParticipant } = useAuth();
  const [view, setView] = useState<ViewState>("input");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [customRequest, setCustomRequest] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
  /** One base for every disclosure panel on this page — see `helpPanelId`. */
  const helpBaseId = useId();
  const [recentJobs, setRecentJobs] = useState<api.DocumentJobSummary[]>([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [job, setJob] = useState<api.DocumentJob | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const pollingStartedAt = useRef<number>(0);
  const words = useMemo(() => wordCount(draft.content), [draft.content]);
  const chars = draft.content.length;
  const isTooShort = words < 30;
  const isTooLong = chars > 15_000;
  const canSubmit = !submitting && !isTooShort && !isTooLong;
  const materials = job?.result?.materials ?? [];
  useEffect(() => {
    const stored = localStorage.getItem(DRAFT_KEY);
    if (stored) {
      try {
        setDraft({ ...EMPTY_DRAFT, ...JSON.parse(stored) as Partial<DraftState> });
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (jobId) void loadJob(jobId, true);
    if (isParticipant) void refreshRecentJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParticipant]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft.content.trim() || draft.title.trim() || draft.level || draft.languageFocus.trim()) {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft]);
  useEffect(() => {
    if (view !== "waiting" || !job) return;
    pollingStartedAt.current = Date.now();
    setElapsed(0);
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - pollingStartedAt.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view, job?.id]);
  useEffect(() => {
    const material = job?.status === "completed" ? job.result?.materials[0] : undefined;
    if (material?.material_type !== "clean_handout") return;
    setDraft((prev) => ({
      ...prev,
      templateId: material.template_id ?? "editorial_reader",
    }));
  }, [job?.id, job?.status]);
  useEffect(() => {
    if (view !== "waiting" || !job) return;
    let stopped = false;
    let timer: number | undefined;
    const jobId = job.id;
    async function poll() {
      const res = await api.getDocumentJob(jobId);
      if (stopped) return;
      if (res.data) {
        const next = res.data.job;
        setJob(next);
        if (next.status === "completed") {
          localStorage.removeItem(DRAFT_KEY);
          setView("results");
          setError(null);
          void refreshRecentJobs();
          return;
        }
        if (next.status === "failed") {
          setView("input");
          setError(t("documents.failed_message"));
          void refreshRecentJobs();
          return;
        }
      }
      const interval = Date.now() - pollingStartedAt.current > 60_000 ? 5000 : 3000;
      timer = window.setTimeout(poll, interval);
    }
    timer = window.setTimeout(poll, 1200);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [view, job?.id]);
  function updateDraft<Key extends keyof DraftState>(key: Key, value: DraftState[Key]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }
  async function refreshRecentJobs() {
    setRecentLoading(true);
    const res = await api.getDocumentJobs();
    if (res.data) setRecentJobs(res.data.jobs);
    setRecentLoading(false);
  }
  async function loadJob(jobId: string, fromUrl = false) {
    const res = await api.getDocumentJob(jobId);
    if (res.error) {
      if (fromUrl) window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    setJob(res.data.job);
    if (res.data.job.status === "completed") {
      setView("results");
      setError(null);
      return;
    }
    if (res.data.job.status === "queued" || res.data.job.status === "processing") {
      setView("waiting");
      setError(null);
      return;
    }
    setView("input");
    setError(t("documents.failed_message"));
  }
  async function submitDocument() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    const isLessonPlan = draft.documentType === "lesson_plan";
    const payload: api.TransformDocumentPayload = {
      content: draft.content,
      title: draft.title.trim() || undefined,
      level: isLessonPlan ? draft.level || undefined : undefined,
      languageFocus: isLessonPlan ? draft.languageFocus.trim() || undefined : undefined,
      customRequest: customRequest.trim() || undefined,
      emphasisTerms: parseEmphasisTerms(draft.emphasisInput),
      templateId: draft.templateId,
      documentType: draft.documentType,
      locale: getLanguage(),
    };
    const res = await api.transformDocument(payload);
    setSubmitting(false);
    if (res.error) {
      setError(documentErrorMessage(res.error.code ?? res.error.error));
      return;
    }
    const nextJob: api.DocumentJob = {
      id: res.data.jobId,
      status: "queued",
      result: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    setJob(nextJob);
    setView("waiting");
    window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(nextJob.id)}`);
  }
  async function deleteRecentJob(jobId: string) {
    if (!window.confirm(t("documents.delete_confirm"))) return;
    const res = await api.deleteDocumentJob(jobId);
    if (res.error) {
      setToast(t("documents.delete_error"));
      return;
    }
    if (job?.id === jobId) {
      setJob(null);
      setSelectedIndex(0);
      setView("input");
      window.history.replaceState(null, "", window.location.pathname);
    }
    setToast(t("documents.deleted"));
    void refreshRecentJobs();
  }
  function resetForNewDocument() {
    setDraft(EMPTY_DRAFT);
    setCustomRequest("");
    setJob(null);
    setSelectedIndex(0);
    setError(null);
    setView("input");
    localStorage.removeItem(DRAFT_KEY);
    window.history.replaceState(null, "", window.location.pathname);
    void refreshRecentJobs();
  }
  function adjustFormatting(material: api.SimpleDocumentMaterial) {
    if (material.source_text?.trim()) {
      setDraft({
        content: material.source_text,
        title: material.title,
        level: LEVELS.includes(material.level as DraftState["level"]) ? material.level as DraftState["level"] : "",
        languageFocus: material.language_focus ?? "",
        emphasisInput: material.bold_phrases?.join(", ") ?? "",
        templateId: material.template_id ?? "editorial_reader",
        documentType: material.document_type ?? "reading",
      });
    }
    setError(null);
    setView("input");
    window.history.replaceState(null, "", window.location.pathname);
  }
  async function downloadPdf(index: number) {
    if (!job) return;
    setDownloadingIndex(index);
    setToast(null);
    const material = materials[index];
    const templateId = material?.material_type === "clean_handout" ? draft.templateId : undefined;
    const response = await fetch(materialUrl(job.id, index, "pdf", templateId), { credentials: "same-origin" });
    setDownloadingIndex(null);
    if (response.status === 503) {
      setToast(t("documents.pdf_unavailable"));
      return;
    }
    if (!response.ok) {
      setToast(t("documents.pdf_error"));
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${materials[index]?.title ?? "document"}.pdf`;
    link.click();
    URL.revokeObjectURL(url);
  }
  async function copyMaterialText(index: number) {
    const material = materials[index];
    if (!material) return;
    try {
      await navigator.clipboard.writeText(materialToPlainText(material));
      setToast(t("documents.copied"));
    } catch {
      setToast(t("documents.copy_error"));
    }
  }
  // The shared disclosure (src/components/ui/help-disclosure.tsx): one 44px touch
  // target and one `aria-controls` relationship for all three studios.
  function helpDot(id: string) {
    return (
      <HelpDot
        className={s.helpDot}
        size={13}
        label={t("documents.help_dot")}
        expanded={openHelp === id}
        controls={helpPanelId(helpBaseId, id)}
        onToggle={() => setOpenHelp((prev) => (prev === id ? null : id))}
      />
    );
  }

  /** Always rendered, hidden when closed: `aria-controls` must have a target. */
  function helpText(id: string, key: string) {
    return (
      <HelpPanel id={helpPanelId(helpBaseId, id)} open={openHelp === id} className={s.fieldHelp}>
        {t(key)}
      </HelpPanel>
    );
  }
  function renderInput() {
    const disabledReason = isTooShort
      ? t("documents.reason_too_short")
      : isTooLong
        ? t("documents.reason_too_long")
        : "";
    return (
      <div className={s.inputGrid}>
        <section className={s.panel}>
          <div className={s.panelTitle}>
            <div>
              <h2>{t("documents.input_title")}</h2>
              <p>{t("documents.input_intro")}</p>
            </div>
            <button type="button" className={s.iconText} onClick={() => setGuideOpen(true)}>
              <HelpCircle size={17} aria-hidden /> {t("documents.guide")}
            </button>
          </div>
          {error && (
            <div className={s.errorBox}>
              <p>{error}</p>
              <button type="button" onClick={() => setError(null)}>{t("documents.retry")}</button>
            </div>
          )}
          <ChoiceButtons
            label={t("documents.document_type_label")}
            help={helpDot("documentType")}
            value={draft.documentType}
            options={DOCUMENT_TYPES}
            keyPrefix="documents.document_types"
            onChange={(documentType) => updateDraft("documentType", documentType)}
          />
          {helpText("documentType", "documents.help_document_type")}
          <label className={s.field}>
            <span>{t("documents.content_label")}</span>
            <textarea
              className={s.contentArea}
              value={draft.content}
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateDraft("content", event.target.value)}
              placeholder={t("documents.content_placeholder")}
            />
          </label>
          <div className={s.counterRow} aria-live="polite">
            <span className={isTooShort ? s.counterWarn : ""}>{t("documents.word_count", { count: String(words) })}</span>
            <span className={isTooLong ? s.counterWarn : ""}>{t("documents.char_count", { count: String(chars) })}</span>
          </div>
          {disabledReason && <p className={s.reason}>{disabledReason}</p>}
          <div className={draft.documentType === "lesson_plan" ? s.formGrid : ""}>
            <label className={s.field}>
              <span>{t("documents.title_label")}</span>
              <input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} placeholder={t("documents.title_placeholder")} />
            </label>
            {draft.documentType === "lesson_plan" && (
              <label className={s.field}>
                <span>{t("documents.language_label")}</span>
                <input value={draft.languageFocus} onChange={(event) => updateDraft("languageFocus", event.target.value)} placeholder={t("documents.language_placeholder")} />
              </label>
            )}
          </div>
          {draft.documentType === "lesson_plan" && (
            <fieldset className={s.choiceGroup}>
              <legend>{t("documents.level_label")} {helpDot("level")}</legend>
              <div className={s.chips}>
                {LEVELS.map((level) => (
                  <button key={level || "unspecified"} type="button" className={draft.level === level ? s.chipActive : ""} onClick={() => updateDraft("level", level)}>
                    {level || t("documents.level_unspecified")}
                  </button>
                ))}
              </div>
              {helpText("level", "documents.help_level")}
            </fieldset>
          )}
          <SimpleDocumentOptions
            emphasisInput={draft.emphasisInput}
            customRequest={customRequest}
            templateId={draft.templateId}
            onEmphasisChange={(value) => updateDraft("emphasisInput", value)}
            onCustomRequestChange={setCustomRequest}
            onTemplateChange={(templateId) => updateDraft("templateId", templateId)}
          />
          <button type="button" className={s.primaryAction} disabled={!canSubmit} onClick={() => void submitDocument()}>
            {submitting ? <Loader2 size={18} className={s.spin} aria-hidden /> : <FileText size={18} aria-hidden />}
            {submitting ? t("documents.submitting") : t("documents.format_document")}
          </button>
        </section>
        <RecentJobs jobs={recentJobs} loading={recentLoading} onOpen={(id) => {
          window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(id)}`);
          void loadJob(id);
        }} onDelete={(id) => void deleteRecentJob(id)} />
      </div>
    );
  }
  function renderWaiting() {
    const messageKey = elapsed < 30 ? "waiting_analysis" : elapsed < 90 ? "waiting_building_simple" : "waiting_finalizing";
    return (
      <section className={s.waitingPanel}>
        <Loader2 size={38} className={s.spin} aria-hidden />
        <p className={s.eyebrow}>{t("documents.waiting_eyebrow")}</p>
        <h2>{t(`documents.${messageKey}`)}</h2>
        <p>{t("documents.waiting_expectation")}</p>
        <strong>{formatElapsed(elapsed)}</strong>
        {elapsed >= 600 && <p className={s.longWait}>{t("documents.waiting_long")}</p>}
      </section>
    );
  }
  function renderResults() {
    return (
      <section className={s.resultsPanel}>
        <div className={s.resultsHeader}>
          <div>
            <p className={s.eyebrow}>{t("documents.results_eyebrow")}</p>
            <h2>{materials.length === 1 ? t("documents.results_title_one") : t("documents.results_title")}</h2>
          </div>
          <button type="button" className={s.secondaryAction} onClick={resetForNewDocument}>{t("documents.new_document")}</button>
        </div>
        <div className={`${s.materialGrid} ${materials.length === 1 ? s.materialGridSingle : ""}`}>
          {materials.map((material, index) => (
            <article key={material.id} className={s.materialCard} style={{ animationDelay: `${index * 80}ms` }}>
              {material.material_type !== "clean_handout" && <span className={s.cardNumber}>{t("documents.material_n", { n: String(index + 1) })}</span>}
              <h3>{material.title}</h3>
              {material.material_type === "clean_handout" && (
                <SimpleTemplatePicker
                  compact
                  value={draft.templateId}
                  onChange={(templateId) => updateDraft("templateId", templateId)}
                />
              )}
              {material.material_type !== "clean_handout" && (
                <>
                  <p>{t(`documents.material_types.${material.material_type}`)}</p>
                  <dl>
                    <div><dt>{t("documents.focus")}</dt><dd>{t(`documents.skill_focus.${material.skill_focus}`)}</dd></div>
                    <div><dt>{t("documents.interaction")}</dt><dd>{t(`documents.interaction_patterns.${material.interaction_pattern}`)}</dd></div>
                    <div><dt>{t("documents.duration")}</dt><dd>{t("documents.minutes", { count: String(material.estimated_minutes) })}</dd></div>
                    <div><dt>{t("documents.preset")}</dt><dd>{presetLabel(material.preset_id)}</dd></div>
                  </dl>
                </>
              )}
              <div className={`${s.cardActions} ${material.material_type === "clean_handout" && material.source_text ? s.cardActionsSimple : ""}`}>
                {material.material_type === "clean_handout" && material.source_text && (
                  <button type="button" onClick={() => adjustFormatting(material)}>{t("documents.adjust_formatting")}</button>
                )}
                <button type="button" onClick={() => { setSelectedIndex(index); setView("preview"); }}>{t("documents.preview")}</button>
                <button type="button" onClick={() => void copyMaterialText(index)}>
                  <Copy size={16} aria-hidden />
                  {t("documents.copy_text")}
                </button>
                <button type="button" onClick={() => void downloadPdf(index)}>
                  {downloadingIndex === index ? <Loader2 size={16} className={s.spin} aria-hidden /> : <Download size={16} aria-hidden />}
                  {t("documents.download_pdf")}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }
  if (!isParticipant) {
    return (
      <Shell>
        <UpgradeGate variant="page" message={t("documents.locked")} />
      </Shell>
    );
  }
  return (
    <Shell>
      <div className={s.documentsPage}>
        <header className={s.header}>
          <div>
            <p className={s.eyebrow}>{t("documents.eyebrow")}</p>
            <h1>{t("documents.title")}</h1>
          </div>
          <button type="button" className={s.iconText} onClick={() => setGuideOpen(true)}>
            <HelpCircle size={17} aria-hidden /> {t("documents.guide")}
          </button>
        </header>
        {toast && <div className={s.toast} role="status"><span>{toast}</span><button type="button" aria-label={t("common.close")} onClick={() => setToast(null)}><X size={16} aria-hidden /></button></div>}
        {view === "input" && renderInput()}
        {view === "waiting" && renderWaiting()}
        {view === "results" && renderResults()}
        {view === "preview" && job && (
          <DocumentPreview
            jobId={job.id}
            materials={materials}
            selectedIndex={selectedIndex}
            downloadingIndex={downloadingIndex}
            templateId={draft.templateId}
            onSelect={setSelectedIndex}
            onTemplateChange={(templateId) => updateDraft("templateId", templateId)}
            onBack={() => setView("results")}
            onCopy={(index) => void copyMaterialText(index)}
            onDownload={(index) => void downloadPdf(index)}
          />
        )}
        {guideOpen && <GuideOverlay onClose={() => setGuideOpen(false)} />}
      </div>
    </Shell>
  );
}
