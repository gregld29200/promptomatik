import { useState } from "react";
import { Copy, Download, FilePen, Loader2, Plus } from "lucide-react";
import type { DocumentJob, DocumentMaterial, SimpleDocumentTemplateId } from "@/lib/api";
import { materialUrl } from "@/lib/document-presentation";
import { t } from "@/lib/i18n";
import { DocumentAppearancePanel } from "./document-design-panel";
import s from "@/pages/documents.module.css";

interface DocumentPreviewProps {
  jobId: string;
  materials: DocumentMaterial[];
  selectedIndex: number;
  downloadingIndex: number | null;
  onSelect: (index: number) => void;
  onEditText: (index: number) => void;
  onNewDocument: () => void;
  onCopy: (index: number) => void;
  onDownload: (index: number) => void;
  onJobUpdated: (job: DocumentJob) => void;
}

/**
 * Step 3, "Vérifiez puis téléchargez": the document itself, the one
 * appearance panel, and a single primary action — the PDF. On a phone the
 * download stays pinned to the bottom of the screen.
 */
export function DocumentPreview({
  jobId,
  materials,
  selectedIndex,
  downloadingIndex,
  onSelect,
  onEditText,
  onNewDocument,
  onCopy,
  onDownload,
  onJobUpdated,
}: DocumentPreviewProps) {
  // Bumped after every saved appearance change so the preview reloads.
  const [version, setVersion] = useState(0);
  const [exactPages, setExactPages] = useState(false);
  const material = materials[selectedIndex];
  if (!material) return null;
  const simple = material.material_type === "clean_handout" ? material : undefined;
  const templateId: SimpleDocumentTemplateId = simple?.template_id ?? "editorial_reader";
  const htmlSrc = `${materialUrl(jobId, selectedIndex, "html")}${version ? `?v=${version}` : ""}`;
  const pdfSrc = `${materialUrl(jobId, selectedIndex, "pdf")}?inline=1&v=${version}#view=FitH`;
  const downloading = downloadingIndex === selectedIndex;

  const downloadButton = (className: string) => (
    <button type="button" className={className} onClick={() => onDownload(selectedIndex)} disabled={downloading}>
      {downloading ? <Loader2 size={18} className={s.spin} aria-hidden /> : <Download size={18} aria-hidden />}
      {t("documents.download_pdf")}
    </button>
  );

  return (
    <section className={s.previewPanel} aria-labelledby="review-title">
      <div className={s.reviewHeader}>
        <div>
          <p className={s.stepLabel}>{t("documents.step3_label")}</p>
          <h2 id="review-title">{t("documents.step3_title")}</h2>
          <p className={s.reviewDocTitle}>
            {simple?.document_type && <span className={s.typeBadge}>{t(`documents.document_types.${simple.document_type}`)}</span>}
            {material.title}
          </p>
        </div>
        {downloadButton(s.primaryAction)}
      </div>

      <div className={s.reviewActions}>
        {simple?.source_text && (
          <button type="button" className={s.iconText} onClick={() => onEditText(selectedIndex)}>
            <FilePen size={16} aria-hidden /> {t("documents.edit_text")}
          </button>
        )}
        <button type="button" className={s.iconText} onClick={() => onCopy(selectedIndex)}>
          <Copy size={16} aria-hidden /> {t("documents.copy_text")}
        </button>
        <button type="button" className={s.iconText} onClick={onNewDocument}>
          <Plus size={16} aria-hidden /> {t("documents.new_document")}
        </button>
        {materials.length > 1 && (
          <div className={s.previewNav} role="group" aria-label={t("documents.material_nav")}>
            {materials.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selectedIndex === index}
                className={selectedIndex === index ? s.previewNavActive : ""}
                onClick={() => onSelect(index)}
              >
                {t("documents.material_n", { n: String(index + 1) })}
              </button>
            ))}
          </div>
        )}
      </div>

      {simple?.request_status === "not_applied" && (
        <p className={s.notice} role="status">{t("documents.request_not_applied")}</p>
      )}

      <div className={simple ? s.previewWithDesign : ""}>
        <div className={s.previewColumn}>
          <div className={s.viewSwitch} role="group" aria-label={t("documents.view_label")}>
            <button type="button" aria-pressed={!exactPages} onClick={() => setExactPages(false)}>{t("documents.view_quick")}</button>
            <button type="button" aria-pressed={exactPages} onClick={() => setExactPages(true)}>{t("documents.view_exact")}</button>
          </div>
          <p className={s.viewHint}>{exactPages ? t("documents.view_exact_hint") : t("documents.view_quick_hint")}</p>
          {exactPages ? (
            <iframe key={`pdf-${version}`} title={material.title} className={s.previewFrame} src={pdfSrc} />
          ) : (
            <iframe
              key={`html-${version}`}
              title={material.title}
              className={s.previewFrame}
              src={htmlSrc}
              sandbox="allow-same-origin"
            />
          )}
          {exactPages && (
            <a className={s.viewOpen} href={pdfSrc} target="_blank" rel="noreferrer">{t("documents.view_open_pdf")}</a>
          )}
        </div>
        {simple && (
          <DocumentAppearancePanel
            key={material.id}
            jobId={jobId}
            index={selectedIndex}
            templateId={templateId}
            design={simple.design ?? {}}
            orientation={simple.orientation ?? (simple.document_type === "course_calendar" ? "landscape" : "portrait")}
            onSaved={(job) => {
              onJobUpdated(job);
              setVersion((value) => value + 1);
            }}
          />
        )}
      </div>

      <div className={s.mobileBar}>{downloadButton(s.primaryAction)}</div>
    </section>
  );
}
