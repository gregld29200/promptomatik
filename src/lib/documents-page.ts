import * as api from "@/lib/api";
import { t } from "@/lib/i18n";

export type ViewState = "input" | "waiting" | "results" | "preview";
export type LevelValue = "" | "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface DraftState {
  content: string;
  title: string;
  level: LevelValue;
  languageFocus: string;
  emphasisInput: string;
  templateId: api.SimpleDocumentTemplateId;
  /** Empty until the teacher picks: no card is preselected. */
  documentType: "" | api.DocumentType;
  /** Empty means "the type's default" (landscape for calendars). */
  orientation: "" | api.DocumentOrientation;
  additions: api.DocumentAddition[];
}

export const DRAFT_KEY = "ti-docs-draft-v3";
/** The teacher's last design, reused for every new document. */
export const DESIGN_KEY = "ti-docs-design-v1";
export const LEVELS: LevelValue[] = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
export const MIN_WORDS = 8;
export const MAX_CHARS = 30_000;

// The catalogue mirrors what the course produces, grouped by who reads it.
// "Document libre" comes last, as the fallback when nothing else fits.
export const DOCUMENT_TYPE_GROUPS: Array<{ id: string; types: api.DocumentType[] }> = [
  { id: "learner", types: ["worksheet", "reading", "role_cards", "dialogue_script"] },
  { id: "teacher", types: ["teacher_guide", "lesson_plan", "session_plan", "checklist"] },
  { id: "course", types: ["learner_profile", "course_brief", "course_calendar"] },
];
export const DOCUMENT_TYPES: api.DocumentType[] = [...DOCUMENT_TYPE_GROUPS.flatMap((group) => group.types), "free"];
export const DOCUMENT_ADDITIONS: api.DocumentAddition[] = ["word_bank", "questions", "fill_blanks", "matching", "role_cards", "instructions"];

export const EMPTY_DRAFT: DraftState = {
  content: "",
  title: "",
  level: "",
  languageFocus: "",
  emphasisInput: "",
  templateId: "editorial_reader",
  documentType: "",
  orientation: "",
  additions: [],
};

export function defaultOrientation(documentType: api.DocumentType): api.DocumentOrientation {
  return documentType === "course_calendar" ? "landscape" : "portrait";
}

export function loadSavedDesign(): api.DocumentDesign {
  try {
    const stored = localStorage.getItem(DESIGN_KEY);
    return stored ? JSON.parse(stored) as api.DocumentDesign : {};
  } catch {
    return {};
  }
}

export function saveDesign(design: api.DocumentDesign) {
  try {
    localStorage.setItem(DESIGN_KEY, JSON.stringify(design));
  } catch {
    // Private mode: the design still applies to this document.
  }
}

export function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

export function formatElapsed(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function presetLabel(id: api.DocumentPresetId) {
  return t(`documents.presets.${id}`);
}

export function documentErrorMessage(code: string) {
  if (code === "content_too_short") return t("documents.reason_too_short");
  if (code === "content_too_long") return t("documents.reason_too_long");
  if (code === "invalid_request") return t("documents.invalid_request");
  if (code === "image_type") return t("documents.image_type_error");
  if (code === "image_too_large") return t("documents.image_too_large");
  if (code === "image_upload") return t("documents.image_upload_error");
  return t("documents.submit_error");
}
