import type { ReactNode } from "react";
import type { DocumentType } from "@/lib/api";
import { DOCUMENT_TYPE_GROUPS } from "@/lib/documents-page";
import { t } from "@/lib/i18n";
import s from "./document-type-picker.module.css";

interface DocumentTypePickerProps {
  value: DocumentType;
  onChange: (value: DocumentType) => void;
  help?: ReactNode;
}

/**
 * The catalogue, grouped by who reads the document. "Document libre" sits on
 * its own first: it is the default and lays out anything without chrome.
 */
export function DocumentTypePicker({ value, onChange, help }: DocumentTypePickerProps) {
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
    <fieldset className={s.picker}>
      <legend>{t("documents.document_type_label")} {help}</legend>
      <div className={s.free}>{option("free")}</div>
      {DOCUMENT_TYPE_GROUPS.map((group) => (
        <div key={group.id} className={s.group}>
          <p className={s.groupLabel}>{t(`documents.document_type_groups.${group.id}`)}</p>
          <div className={s.options}>{group.types.map(option)}</div>
        </div>
      ))}
    </fieldset>
  );
}
