// Deterministic structure parser for Simple Document mode.
//
// Formatting-only is code, not AI judgement: the same teacher input always
// produces the same structure, title, and bold phrases. The LLM is reserved
// for explicitly requested additions (see generate.ts).
//
// Input contract (deliberate, documented Markdown subset):
// - Blank lines separate chunks (paragraphs/sections).
// - `#`–`######` at the start of a line forces a heading; markers are stripped.
// - `- ` / `* ` / `• ` lines form bullet lists; `1.` / `1)` lines numbered lists.
// - A single short line (≤ 90 chars) on its own, not ending in ". , ; :",
//   reads as a section heading (questions and exclamations allowed).
// - Inline `**bold**` / `*italic*` are rendered as emphasis by the renderer.
// - Everything else is plain text, preserved verbatim.

import { presetForIndex } from './material-renderer';
import type { SimpleTemplateId, SimpleTransformMaterial } from './types';

export interface SimpleStructureBlock {
  type: 'heading' | 'paragraph' | 'bullet_list' | 'numbered_list';
  line_ids: number[];
}

const BULLET_PATTERN = /^[-*•]\s+/;
const NUMBERED_PATTERN = /^\d{1,3}[.)]\s+/;
const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+/;
const MAX_HEADING_LENGTH = 90;
const MAX_FALLBACK_TITLE_LENGTH = 80;

export function stripHeadingMarker(line: string): string {
  return line.replace(MARKDOWN_HEADING_PATTERN, '');
}

function lineKind(line: string): 'bullet' | 'numbered' | 'plain' {
  if (BULLET_PATTERN.test(line)) return 'bullet';
  if (NUMBERED_PATTERN.test(line)) return 'numbered';
  return 'plain';
}

function isHeadingLine(line: string): boolean {
  if (MARKDOWN_HEADING_PATTERN.test(line)) return true;
  return line.length <= MAX_HEADING_LENGTH && !/[.,;:]$/.test(line);
}

interface NumberedLine {
  id: number;
  text: string;
}

/**
 * Chunk on blank lines, then group consecutive same-kind lines inside each
 * chunk. Line ids are 1-based over the non-empty trimmed lines, matching the
 * contract the renderer and validator already enforce.
 */
export function parseSimpleStructure(content: string): {
  lines: string[];
  structure: SimpleStructureBlock[];
  headings: string[];
} {
  const rawLines = content.split(/\r?\n/).map((line) => line.trim());
  const chunks: NumberedLine[][] = [];
  let current: NumberedLine[] = [];
  let nextId = 1;

  for (const raw of rawLines) {
    if (!raw) {
      if (current.length > 0) chunks.push(current);
      current = [];
      continue;
    }
    current.push({ id: nextId, text: raw });
    nextId += 1;
  }
  if (current.length > 0) chunks.push(current);

  const structure: SimpleStructureBlock[] = [];
  const headings: string[] = [];

  for (const chunk of chunks) {
    let run: NumberedLine[] = [];
    let runKind: 'bullet' | 'numbered' | 'plain' | null = null;

    const flush = () => {
      if (run.length === 0 || runKind === null) return;
      if (runKind === 'bullet') {
        structure.push({ type: 'bullet_list', line_ids: run.map((line) => line.id) });
      } else if (runKind === 'numbered') {
        structure.push({ type: 'numbered_list', line_ids: run.map((line) => line.id) });
      } else if (run.length === 1 && isHeadingLine(run[0].text)) {
        structure.push({ type: 'heading', line_ids: [run[0].id] });
        headings.push(stripHeadingMarker(run[0].text));
      } else {
        structure.push({ type: 'paragraph', line_ids: run.map((line) => line.id) });
      }
      run = [];
      runKind = null;
    };

    for (const line of chunk) {
      const kind = lineKind(line.text);
      if (kind !== runKind) flush();
      runKind = kind;
      run.push(line);
    }
    flush();
  }

  return {
    lines: rawLines.filter(Boolean),
    structure,
    headings,
  };
}

/** Exact source casing for a requested phrase, or null when absent. */
export function sourcePhrase(content: string, requestedPhrase: string): string | null {
  const phrase = requestedPhrase.trim();
  if (!phrase) return null;
  const index = content.toLocaleLowerCase().indexOf(phrase.toLocaleLowerCase());
  return index === -1 ? null : content.slice(index, index + phrase.length);
}

function resolveBoldPhrases(content: string, emphasisTerms: string[]): string[] {
  return emphasisTerms
    .map((phrase) => sourcePhrase(content, phrase))
    .filter((phrase): phrase is string => Boolean(phrase))
    .filter((phrase, index, phrases) => (
      phrases.findIndex((candidate) => candidate.toLocaleLowerCase() === phrase.toLocaleLowerCase()) === index
    ));
}

function clipAtWordBoundary(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}

function deriveTitle(
  requestedTitle: string | undefined,
  lines: string[],
  structure: SimpleStructureBlock[],
): string {
  const trimmed = requestedTitle?.trim();
  if (trimmed) return trimmed;
  const first = structure[0];
  if (first?.type === 'heading') {
    return stripHeadingMarker(lines[first.line_ids[0] - 1]);
  }
  return clipAtWordBoundary(stripHeadingMarker(lines[0] ?? 'Document'), MAX_FALLBACK_TITLE_LENGTH);
}

export function buildSimpleMaterial(
  content: string,
  requestedTitle: string | undefined,
  emphasisTerms: string[],
  templateId: SimpleTemplateId,
): SimpleTransformMaterial {
  const trimmedContent = content.trim();
  const { lines, structure, headings } = parseSimpleStructure(trimmedContent);

  return {
    material_type: 'clean_handout',
    title: deriveTitle(requestedTitle, lines, structure),
    source_text: trimmedContent,
    bold_phrases: resolveBoldPhrases(trimmedContent, emphasisTerms),
    heading_phrases: headings,
    structure,
    template_id: templateId,
    blocks: [],
    id: `material-${Date.now()}-0`,
    preset_id: presetForIndex(0),
  };
}
