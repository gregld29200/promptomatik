import type { SimpleDocumentTemplateId } from "@/lib/api";
import { t } from "@/lib/i18n";
import { SimpleTemplatePicker } from "./simple-template-picker";
import s from "@/pages/documents.module.css";

interface SimpleDocumentOptionsProps {
  emphasisInput: string;
  customRequest: string;
  templateId: SimpleDocumentTemplateId;
  onEmphasisChange: (value: string) => void;
  onCustomRequestChange: (value: string) => void;
  onTemplateChange: (value: SimpleDocumentTemplateId) => void;
}

export function SimpleDocumentOptions(props: SimpleDocumentOptionsProps) {
  return (
    <>
      <label className={s.field}>
        <span>{t("documents.emphasis_label")}</span>
        <input
          value={props.emphasisInput}
          onChange={(event) => props.onEmphasisChange(event.target.value)}
          placeholder={t("documents.emphasis_placeholder")}
        />
        <small className={s.fieldHelp}>{t("documents.emphasis_help")}</small>
      </label>
      <SimpleTemplatePicker value={props.templateId} onChange={props.onTemplateChange} />
      <label className={s.field}>
        <span>{t("documents.simple_request")}</span>
        <textarea
          className={s.smallArea}
          value={props.customRequest}
          onChange={(event) => props.onCustomRequestChange(event.target.value)}
          placeholder={t("documents.simple_request_placeholder")}
        />
      </label>
    </>
  );
}
