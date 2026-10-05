import type { DocumentType } from "@/lib/api";
import { DOCUMENT_TYPE_GROUPS } from "@/lib/documents-page";
import { t } from "@/lib/i18n";
import s from "./document-type-picker.module.css";

interface DocumentTypePickerProps {
  value: "" | DocumentType;
  onChange: (value: DocumentType) => void;
  labelledBy: string;
}

/**
 * The catalogue, grouped by who reads the document. Nothing is preselected,
 * so the teacher always makes the choice; "Document libre" closes the list as
 * the fallback when no type fits.
 */
export function DocumentTypePicker({ value, onChange, labelledBy }: DocumentTypePickerProps) {
  const option = (type: DocumentType) => (
    <label key={type} className={`${s.option} ${value === type ? s.selected : ""}`}>
      <input
        type="radio"
        name="document-type"
        value={type}
        checked={value === type}
        onChange={() => onChange(type)}
      />
      <strong>{t(`documents.document_types.${type}`)}</strong>
      <small>{t(`documents.document_type_hints.${type}`)}</small>
    </label>
  );

  return (
    <div className={s.picker} role="radiogroup" aria-labelledby={labelledBy}>
      {DOCUMENT_TYPE_GROUPS.map((group) => (
        <div key={group.id} className={s.group}>
          <p className={s.groupLabel}>{t(`documents.document_type_groups.${group.id}`)}</p>
          <div className={s.options}>{group.types.map(option)}</div>
        </div>
      ))}
      <div className={s.group}>
        <p className={s.groupLabel}>{t("documents.document_type_groups.other")}</p>
        <div className={s.options}>{option("free")}</div>
      </div>
    </div>
  );
}
