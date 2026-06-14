import type { InterviewQuestion } from "./llm/types";

function normalizeQuestion(question: InterviewQuestion): InterviewQuestion {
  const anyQuestion = question as unknown as {
    options?: unknown;
    allow_other?: unknown;
    other_placeholder?: unknown;
    multi_select?: unknown;
    allow_freetext?: unknown;
  };

  const options = Array.isArray(anyQuestion.options) ? anyQuestion.options : [];
  const normalizedOptions = options
    .map((option) => {
      if (typeof option === "string") {
        return { label: option, value: option };
      }
      if (option && typeof option === "object") {
        const value = option as { label?: unknown; value?: unknown; recommended?: unknown };
        const label = typeof value.label === "string"
          ? value.label
          : typeof value.value === "string"
            ? value.value
            : "";
        const normalizedValue = typeof value.value === "string"
          ? value.value
          : typeof value.label === "string"
            ? value.label
            : "";
        const recommended = typeof value.recommended === "boolean" ? value.recommended : undefined;
        return {
          label,
          value: normalizedValue,
          ...(recommended !== undefined ? { recommended } : {}),
        };
      }
      return { label: "", value: "" };
    })
    .filter((option) => option.label && option.value);

  return {
    ...question,
    options: normalizedOptions,
    multi_select: typeof anyQuestion.multi_select === "boolean" ? anyQuestion.multi_select : question.multi_select,
    allow_other: typeof anyQuestion.allow_other === "boolean"
      ? anyQuestion.allow_other
      : typeof anyQuestion.allow_freetext === "boolean"
        ? anyQuestion.allow_freetext
        : question.allow_other,
    other_placeholder: typeof anyQuestion.other_placeholder === "string"
      ? anyQuestion.other_placeholder
      : question.other_placeholder,
  };
}

export function normalizeQuestions(questions: InterviewQuestion[]): InterviewQuestion[] {
  return Array.isArray(questions) ? questions.map(normalizeQuestion) : [];
}
