import type { SimpleDocumentTemplateId } from "./api";

export const SIMPLE_DOCUMENT_TEMPLATES: SimpleDocumentTemplateId[] = [
  "editorial_reader",
  "classroom_handout",
  "compact_professional",
];

export function parseEmphasisTerms(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((term) => term.trim())
    .filter(Boolean)
    .filter((term, index, terms) => (
      terms.findIndex((candidate) => candidate.localeCompare(term, undefined, { sensitivity: "base" }) === 0) === index
    ))
    .slice(0, 50);
}

export function materialUrl(
  jobId: string,
  index: number,
  extension: "html" | "pdf",
  templateId?: SimpleDocumentTemplateId,
) {
  const base = `/api/documents/jobs/${encodeURIComponent(jobId)}/materials/${index}.${extension}`;
  return templateId ? `${base}?template=${encodeURIComponent(templateId)}` : base;
}
