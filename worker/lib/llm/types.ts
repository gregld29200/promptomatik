/** Shared types for the interview engine and prompt assembly. */

export type Technique =
  | "role"
  | "context"
  | "examples"
  | "constraints"
  | "steps"
  | "think_first";

export interface PromptBlock {
  technique: Technique;
  content: string;
  annotation: string;
  order: number;
}

export interface IntentAnalysis {
  level: string | null;
  topic: string | null;
  activity_type: string | null;
  audience: string | null;
  duration: string | null;
  source_type: "from_scratch" | "from_source";
  missing_fields: string[];
  summary: string;
}

export interface InterviewQuestion {
  id: string;
  question: string;
  field: string;
  options: { label: string; value: string; recommended?: boolean }[];
  multi_select?: boolean;
  allow_other?: boolean;
  other_placeholder?: string;

  /**
   * Back-compat with earlier question schema.
   * If present, treat as allow_other.
   */
  allow_freetext?: boolean;
}

export type AssembleResult =
  | { kind: "prompt"; prompt: AssembledPrompt }
  | { kind: "ask_user"; questions: InterviewQuestion[] };

export interface AssembledPrompt {
  name: string;
  blocks: PromptBlock[];
  tips: string[];
  source_type: "from_scratch" | "from_source";
  suggested_tags: string[];
}

export interface RefinementChange {
  technique: Technique;
  type: "modified" | "added" | "removed";
  reason: string;
}

export interface RefinedPrompt {
  blocks: PromptBlock[];
  changes: RefinementChange[];
  tips: string[];
}
