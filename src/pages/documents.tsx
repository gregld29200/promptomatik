import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { ArrowLeft, Copy, Download, FileText, HelpCircle, Info, Loader2, X } from "lucide-react";
import { Shell } from "@/components/layout/shell";
import { UpgradeGate } from "@/components/upgrade-gate";
import { ChoiceButtons, GuideOverlay, RecentJobs } from "@/components/documents/documents-panels";
import { useAuth } from "@/lib/auth/auth-context";
import { t } from "@/lib/i18n";
import * as api from "@/lib/api";
import { materialToPlainText } from "@/lib/document-text";
import {
  DRAFT_KEY, EMPTY_DRAFT, INPUT_KINDS, LEVELS, MODES, OUTPUT_INTENTS,
  formatElapsed, materialUrl, presetLabel, wordCount,
  type DraftState, type ViewState,
} from "@/lib/documents-page";
import s from "./documents.module.css";
export function DocumentsPage() {
  const { isParticipant } = useAuth();
  const [view, setView] = useState<ViewState>("input");
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const [mode, setMode] = useState<api.DocumentMode>("lesson");
  const [inputKind, setInputKind] = useState<api.DocumentInputKind>("auto");
  const [outputIntent, setOutputIntent] = useState<api.DocumentOutputIntent>("three_materials");
  const [customRequest, setCustomRequest] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [openHelp, setOpenHelp] = useState<string | null>(null);
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
    const wantsCustomRequest = mode === "simple" || outputIntent === "custom";
    const payload: api.TransformDocumentPayload = {
      content: draft.content,
      title: draft.title.trim() || undefined,
      level: mode === "lesson" ? draft.level || undefined : undefined,
      languageFocus: mode === "lesson" ? draft.languageFocus.trim() || undefined : undefined,
      mode,
      inputKind: mode === "simple" ? undefined : inputKind,
      outputIntent: mode === "simple" ? undefined : outputIntent,
      customRequest: wantsCustomRequest && customRequest.trim() ? customRequest.trim() : undefined,
    };
    const res = await api.transformDocument(payload);
    setSubmitting(false);
    if (res.error) {
      setError(errorMessage(res.error.code ?? res.error.error));
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
  function resetForNewDocument() {
    setDraft(EMPTY_DRAFT);
    setMode("lesson");
    setInputKind("auto");
    setOutputIntent("three_materials");
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
        level: "",
        languageFocus: "",
      });
    }
    setMode("simple");
    setError(null);
    setView("input");
    window.history.replaceState(null, "", window.location.pathname);
  }
  async function downloadPdf(index: number) {
    if (!job) return;
    setDownloadingIndex(index);
    setToast(null);
    const response = await fetch(materialUrl(job.id, index, "pdf"), { credentials: "same-origin" });
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
  function helpDot(id: string) {
    return (
      <button
        type="button"
        className={s.helpDot}
        aria-label={t("documents.help_dot")}
        aria-expanded={openHelp === id}
        onClick={() => setOpenHelp((prev) => (prev === id ? null : id))}
      >
        <Info size={13} aria-hidden />
      </button>
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
            label={t("documents.mode_label")}
            help={helpDot("mode")}
            value={mode}
            options={MODES}
            keyPrefix="documents.modes"
            onChange={(nextMode) => {
              setMode(nextMode);
              setCustomRequest("");
            }}
          />
          {openHelp === "mode" && <p className={s.fieldHelp}>{t("documents.help_mode")}</p>}
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
          <div className={mode === "lesson" ? s.formGrid : ""}>
            <label className={s.field}>
              <span>{t("documents.title_label")}</span>
              <input value={draft.title} onChange={(event) => updateDraft("title", event.target.value)} placeholder={t("documents.title_placeholder")} />
            </label>
            {mode === "lesson" && (
              <label className={s.field}>
                <span>{t("documents.language_label")}</span>
                <input value={draft.languageFocus} onChange={(event) => updateDraft("languageFocus", event.target.value)} placeholder={t("documents.language_placeholder")} />
              </label>
            )}
          </div>
          {mode === "lesson" && (
            <fieldset className={s.choiceGroup}>
              <legend>{t("documents.level_label")} {helpDot("level")}</legend>
              <div className={s.chips}>
                {LEVELS.map((level) => (
                  <button key={level || "unspecified"} type="button" className={draft.level === level ? s.chipActive : ""} onClick={() => updateDraft("level", level)}>
                    {level || t("documents.level_unspecified")}
                  </button>
                ))}
              </div>
              {openHelp === "level" && <p className={s.fieldHelp}>{t("documents.help_level")}</p>}
            </fieldset>
          )}
          {mode === "simple" && (
            <label className={s.field}>
              <span>{t("documents.simple_request")}</span>
              <textarea className={s.smallArea} value={customRequest} onChange={(event) => setCustomRequest(event.target.value)} placeholder={t("documents.simple_request_placeholder")} />
            </label>
          )}
          {mode === "lesson" && (
            <button type="button" className={s.advancedToggle} onClick={() => setAdvancedOpen((prev) => !prev)}>
              {advancedOpen ? t("documents.advanced_hide") : t("documents.advanced_show")}
            </button>
          )}
          {mode === "lesson" && advancedOpen && (
            <div className={s.advancedPanel}>
              <ChoiceButtons
                label={t("documents.input_kind")}
                help={helpDot("inputKind")}
                value={inputKind}
                options={INPUT_KINDS}
                keyPrefix="documents.input_kinds"
                onChange={setInputKind}
              />
              {openHelp === "inputKind" && <p className={s.fieldHelp}>{t("documents.help_input_kind")}</p>}
              <ChoiceButtons
                label={t("documents.output_intent")}
                help={helpDot("outputIntent")}
                value={outputIntent}
                options={OUTPUT_INTENTS}
                keyPrefix="documents.output_intents"
                onChange={setOutputIntent}
              />
              {openHelp === "outputIntent" && <p className={s.fieldHelp}>{t("documents.help_output_intent")}</p>}
              {outputIntent === "custom" && (
                <label className={s.field}>
                  <span>{t("documents.custom_request")}</span>
                  <textarea className={s.smallArea} value={customRequest} onChange={(event) => setCustomRequest(event.target.value)} placeholder={t("documents.custom_placeholder")} />
                </label>
              )}
            </div>
          )}
          <button type="button" className={s.primaryAction} disabled={!canSubmit} onClick={() => void submitDocument()}>
            {submitting ? <Loader2 size={18} className={s.spin} aria-hidden /> : <FileText size={18} aria-hidden />}
            {submitting ? t("documents.submitting") : t(mode === "simple" ? "documents.format_document" : "documents.generate")}
          </button>
        </section>
        <RecentJobs jobs={recentJobs} loading={recentLoading} onOpen={(id) => {
          window.history.replaceState(null, "", `${window.location.pathname}?job=${encodeURIComponent(id)}`);
          void loadJob(id);
        }} />
      </div>
    );
  }
  function renderWaiting() {
    const buildingKey = mode === "simple" ? "waiting_building_simple" : "waiting_building";
    const messageKey = elapsed < 30 ? "waiting_analysis" : elapsed < 90 ? buildingKey : "waiting_finalizing";
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
  function renderPreview() {
    const material = materials[selectedIndex];
    if (!job || !material) return null;
    return (
      <section className={s.previewPanel}>
        <div className={s.previewBar}>
          <button type="button" className={s.iconText} onClick={() => setView("results")}><ArrowLeft size={17} aria-hidden /> {t("documents.back_results")}</button>
          <div className={s.previewNav}>
            {materials.map((item, index) => (
              <button key={item.id} type="button" className={selectedIndex === index ? s.previewNavActive : ""} onClick={() => setSelectedIndex(index)}>
                {index + 1}
              </button>
            ))}
          </div>
          <div className={s.previewActions}>
            <button type="button" className={s.iconText} onClick={() => void copyMaterialText(selectedIndex)}>
              <Copy size={17} aria-hidden />
              {t("documents.copy_text")}
            </button>
            <button type="button" className={s.iconText} onClick={() => void downloadPdf(selectedIndex)}>
              {downloadingIndex === selectedIndex ? <Loader2 size={17} className={s.spin} aria-hidden /> : <Download size={17} aria-hidden />}
              {t("documents.download_pdf")}
            </button>
          </div>
        </div>
        <iframe
          title={material.title}
          className={s.previewFrame}
          src={materialUrl(job.id, selectedIndex, "html")}
          sandbox="allow-same-origin"
        />
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
        {view === "preview" && renderPreview()}
        {guideOpen && <GuideOverlay onClose={() => setGuideOpen(false)} />}
      </div>
    </Shell>
  );
}
function errorMessage(code: string) {
  if (code === "content_too_short") return t("documents.reason_too_short");
  if (code === "content_too_long") return t("documents.reason_too_long");
  if (code === "invalid_request") return t("documents.invalid_request");
  return t("documents.submit_error");
}
