import { ArrowLeft, Copy, Download, Loader2 } from "lucide-react";
import type { DocumentMaterial, SimpleDocumentTemplateId } from "@/lib/api";
import { materialUrl } from "@/lib/document-presentation";
import { t } from "@/lib/i18n";
import { SimpleTemplatePicker } from "./simple-template-picker";
import s from "@/pages/documents.module.css";

interface DocumentPreviewProps {
  jobId: string;
  materials: DocumentMaterial[];
  selectedIndex: number;
  downloadingIndex: number | null;
  templateId: SimpleDocumentTemplateId;
  onSelect: (index: number) => void;
  onTemplateChange: (templateId: SimpleDocumentTemplateId) => void;
  onBack: () => void;
  onCopy: (index: number) => void;
  onDownload: (index: number) => void;
}

export function DocumentPreview({
  jobId,
  materials,
  selectedIndex,
  downloadingIndex,
  templateId,
  onSelect,
  onTemplateChange,
  onBack,
  onCopy,
  onDownload,
}: DocumentPreviewProps) {
  const material = materials[selectedIndex];
  if (!material) return null;
  const simpleTemplate = material.material_type === "clean_handout" ? templateId : undefined;

  return (
    <section className={s.previewPanel}>
      <div className={s.previewBar}>
        <button type="button" className={s.iconText} onClick={onBack}>
          <ArrowLeft size={17} aria-hidden /> {t("documents.back_results")}
        </button>
        <div className={s.previewNav}>
          {materials.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={selectedIndex === index ? s.previewNavActive : ""}
              onClick={() => onSelect(index)}
            >
              {index + 1}
            </button>
          ))}
        </div>
        <div className={s.previewActions}>
          <button type="button" className={s.iconText} onClick={() => onCopy(selectedIndex)}>
            <Copy size={17} aria-hidden /> {t("documents.copy_text")}
          </button>
          <button type="button" className={s.iconText} onClick={() => onDownload(selectedIndex)}>
            {downloadingIndex === selectedIndex
              ? <Loader2 size={17} className={s.spin} aria-hidden />
              : <Download size={17} aria-hidden />}
            {t("documents.download_pdf")}
          </button>
        </div>
      </div>
      {simpleTemplate && (
        <SimpleTemplatePicker compact value={simpleTemplate} onChange={onTemplateChange} />
      )}
      <iframe
        key={simpleTemplate}
        title={material.title}
        className={s.previewFrame}
        src={materialUrl(jobId, selectedIndex, "html", simpleTemplate)}
        sandbox="allow-same-origin"
      />
    </section>
  );
}
