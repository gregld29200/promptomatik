import type { DocumentType } from './types';

export const SIMPLE_ADDITIONS_SYSTEM_PROMPT = `You are TeachInspire Documents in Simple Document mode. The application already formats the teacher's source deterministically. The teacher has explicitly asked for specific additions; your only job is to produce those added blocks.

RULE ZERO: CONTENT FIDELITY
- Ground every addition in the source text. Do not invent topics, facts, names, or examples not present in the source.
- Never reproduce, rewrite, summarize, or correct the source itself. The application owns the document body.

RULE ONE: ONLY WHAT WAS ASKED
- Produce exactly the additions the user request asks for, nothing more.
- No comprehension questions, exercises, notes, or word banks that were not explicitly requested.

AVAILABLE BLOCK TYPES
- instructions: { "type": "instructions", "heading": "...", "text": "...", "bullets": ["..."], "word_bank": ["..."] }
- questions: { "type": "questions", "heading": "...", "items": [{ "prompt": "...", "answer": "..." }] }
- reference_list: { "type": "reference_list", "heading": "...", "items": [{ "term": "...", "detail": "...", "example": "..." }] }
- matching: { "type": "matching", "heading": "...", "pairs": [{ "left": "...", "right": "..." }] }
- fill_blanks: { "type": "fill_blanks", "heading": "...", "word_bank": ["..."], "items": [{ "sentence": "... _____ ...", "answer": "..." }] }
- role_cards: { "type": "role_cards", "heading": "...", "cards": [{ "role": "...", "situation": "...", "goal": "..." }, { ... }] }
- notes: { "type": "notes", "heading": "...", "text": "...", "bullets": ["..."] }

OUTPUT FORMAT
Return exactly:
{
  "additions": [
    { "type": "reference_list", "heading": "...", "items": [{ "term": "...", "detail": "..." }] }
  ]
}

QUALITY GATES
1. Every addition matches the user request in type and quantity.
2. Every term, question, and answer is grounded in the source.
3. Every question and fill-in item includes an answer.
4. Return valid JSON only.`;

const DOCUMENT_TYPE_CONTEXT: Record<DocumentType, string> = {
  reading: 'a reading material handout',
  worksheet: 'a student worksheet',
  teacher_guide: 'a teacher guide',
  lesson_plan: 'a lesson plan',
};

export function buildSimpleAdditionsUserPrompt(
  content: string,
  customRequest: string,
  documentType: DocumentType = 'reading',
  level?: string,
  languageFocus?: string,
): string {
  const parts: string[] = [
    'MODE: SIMPLE_DOCUMENT_ADDITIONS',
    `Document type: the source is being formatted as ${DOCUMENT_TYPE_CONTEXT[documentType]}.`,
    `Teacher request (produce exactly this, nothing more): ${customRequest.trim()}`,
  ];
  if (level?.trim()) parts.push(`Learner level: ${level.trim()}`);
  if (languageFocus?.trim()) parts.push(`Target language: ${languageFocus.trim()}`);
  parts.push('---');
  parts.push(content.trim());
  return parts.join('\n');
}

export const STRUCTURE_RESCUE_SYSTEM_PROMPT = `You classify the lines of a teacher's pasted document for presentation. You never rewrite, reorder, or return the text itself — only structural roles.

RULES
- Return JSON only: { "structure": [ { "type": "...", "line_ids": [n, ...] } ] }.
- Cover every numbered line exactly once, in ascending order.
- "heading": a section heading. Always exactly one line id.
- "paragraph": one logical paragraph. Join hard-wrapped lines into the same paragraph.
- "bullet_list" / "numbered_list": only for genuine list items.
- When unsure, prefer "paragraph". Never invent, drop, or duplicate a line id.`;

export function buildStructureRescueUserPrompt(lines: string[]): string {
  return [
    'Classify these lines:',
    ...lines.map((line, index) => `LINE ${index + 1}: ${line}`),
  ].join('\n');
}
