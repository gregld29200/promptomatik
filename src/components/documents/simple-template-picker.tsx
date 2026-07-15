import type { SimpleDocumentTemplateId } from "@/lib/api";
import { SIMPLE_DOCUMENT_TEMPLATES } from "@/lib/document-presentation";
import { t } from "@/lib/i18n";
import s from "./simple-template-picker.module.css";

interface SimpleTemplatePickerProps {
  value: SimpleDocumentTemplateId;
  onChange: (value: SimpleDocumentTemplateId) => void;
  compact?: boolean;
}

export function SimpleTemplatePicker({ value, onChange, compact = false }: SimpleTemplatePickerProps) {
  return (
    <fieldset className={`${s.picker} ${compact ? s.compact : ""}`}>
      <div className={s.heading}>
        <legend>{t("documents.template_picker_label")}</legend>
        {!compact && <p>{t("documents.template_picker_help")}</p>}
      </div>
      <div className={s.options}>
        {SIMPLE_DOCUMENT_TEMPLATES.map((templateId) => (
          <label
            key={templateId}
            className={`${s.option} ${value === templateId ? s.selected : ""}`}
          >
            <input
              type="radio"
              name={compact ? "result-template" : "document-template"}
              value={templateId}
              checked={value === templateId}
              onChange={() => onChange(templateId)}
            />
            <TemplateSwatch templateId={templateId} />
            <span className={s.copy}>
              <strong>{t(`documents.simple_templates.${templateId}.name`)}</strong>
              {!compact && <small>{t(`documents.simple_templates.${templateId}.description`)}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function TemplateSwatch({ templateId }: { templateId: SimpleDocumentTemplateId }) {
  return (
    <span className={`${s.swatch} ${s[templateId]}`} aria-hidden="true">
      <i className={s.accent} />
      <i className={s.titleLine} />
      <i className={s.headingLine} />
      <i className={s.textLine} />
      <i className={s.textLineShort} />
    </span>
  );
}
