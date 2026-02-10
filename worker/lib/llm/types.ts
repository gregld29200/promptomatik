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
  options: string[];
  allow_freetext: boolean;
}

export interface AssembledPrompt {
  name: string;
  blocks: PromptBlock[];
  model_recommendation: string;
  model_recommendation_reason: string;
  source_type: "from_scratch" | "from_source";
  suggested_tags: string[];
}
