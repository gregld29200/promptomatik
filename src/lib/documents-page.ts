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
}

export const DRAFT_KEY = "ti-docs-draft-v1";
export const LEVELS: LevelValue[] = ["", "A1", "A2", "B1", "B2", "C1", "C2"];
export const INPUT_KINDS: api.DocumentInputKind[] = ["auto", "raw_content", "lesson_plan", "curriculum", "worksheet_spec", "assessment_spec", "other_structured_spec"];
export const OUTPUT_INTENTS: api.DocumentOutputIntent[] = ["three_materials", "lesson_pack", "assessment_pack", "unit_snapshot", "custom"];
export const MODES: api.DocumentMode[] = ["simple", "lesson"];
export const EMPTY_DRAFT: DraftState = {
  content: "",
  title: "",
  level: "",
  languageFocus: "",
  emphasisInput: "",
  templateId: "editorial_reader",
};

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
  return t("documents.submit_error");
}
