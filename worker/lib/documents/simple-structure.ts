// Deterministic structure parser for Simple Document mode.
//
// Formatting-only is code, not AI judgement: the same teacher input always
// produces the same structure, title, and bold phrases. The LLM is reserved
// for explicitly requested additions (see generate.ts).
//
// Input contract (deliberate, documented Markdown subset):
// - `#`–`######` at the start of a line forces a heading; markers are stripped.
// - `- ` / `* ` / `• ` lines form bullet lists; `1.` / `1)` lines numbered lists.
// - A short line (≤ 90 chars) not ending in ". , ; :" and not starting
//   lowercase reads as a section heading (questions/exclamations allowed) —
//   whether separated by blank lines or by single newlines. Real teacher
//   pastes (Docs/Word/web) often carry no blank lines at all.
// - A line that does not close a sentence continues into the next line
//   (hard-wrapped prose is joined, and never mistaken for headings).
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

// A line that closes a sentence (or ends with list-intro punctuation).
// Lines that do NOT match are treated as hard-wrapped and joined onward.
const SENTENCE_END_PATTERN = /[.!?:;,…]["'»”’)\]]*$/;
const STARTS_LOWERCASE_PATTERN = /^[a-zà-öø-ÿ]/;

function isHeadingLine(line: string, nextLine?: string): boolean {
  if (MARKDOWN_HEADING_PATTERN.test(line)) return true;
  return (
    line.length <= MAX_HEADING_LENGTH
    && !/[.,;:]$/.test(line)
    // Headings start with a capital/digit; a lowercase start is prose.
    && !STARTS_LOWERCASE_PATTERN.test(line)
    // A following lowercase line means this line was hard-wrapped prose.
    && (nextLine === undefined || !STARTS_LOWERCASE_PATTERN.test(nextLine))
  );
}

interface NumberedLine {
  id: number;
  text: string;
}

/**
 * Classify each non-empty line: markers win (bullet/numbered/markdown
 * heading), short capitalized lines without closing punctuation read as
 * headings, sentence lines become paragraphs, and unfinished lines join into
 * the next line (hard-wrap). Works with or without blank lines — real
 * teacher pastes (Docs/Word/web) often separate blocks with single newlines
 * only. Line ids are 1-based over the non-empty trimmed lines, matching the
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
    let listRun: NumberedLine[] = [];
    let listKind: 'bullet' | 'numbered' | null = null;
    let paragraph: NumberedLine[] = [];

    const flushList = () => {
      if (listRun.length === 0 || listKind === null) return;
      structure.push({
        type: listKind === 'bullet' ? 'bullet_list' : 'numbered_list',
        line_ids: listRun.map((line) => line.id),
      });
      listRun = [];
      listKind = null;
    };
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      structure.push({ type: 'paragraph', line_ids: paragraph.map((line) => line.id) });
      paragraph = [];
    };

    chunk.forEach((line, index) => {
      const kind = lineKind(line.text);
      if (kind !== 'plain') {
        flushParagraph();
        if (kind !== listKind) flushList();
        listKind = kind;
        listRun.push(line);
        return;
      }
      flushList();

      // Hard-wrap continuation: the open paragraph's last line did not close
      // a sentence, so this line belongs to it — never a heading.
      const open = paragraph[paragraph.length - 1];
      if (open && !SENTENCE_END_PATTERN.test(open.text)) {
        paragraph.push(line);
        return;
      }

      if (isHeadingLine(line.text, chunk[index + 1]?.text)) {
        flushParagraph();
        structure.push({ type: 'heading', line_ids: [line.id] });
        headings.push(stripHeadingMarker(line.text));
        return;
      }

      flushParagraph();
      paragraph.push(line);
    });
    flushList();
    flushParagraph();
  }

  return {
    lines: rawLines.filter(Boolean),
    structure,
    headings,
  };
}

/**
 * The local parser's one known failure mode: a paste so mangled (e.g. copied
 * out of a PDF) that many lines collapse into a single paragraph blob. Such a
 * result is eligible for the LLM structure rescue.
 */
export function isCollapsedStructure(structure: SimpleStructureBlock[]): boolean {
  return structure.some((block) => block.type === 'paragraph' && block.line_ids.length >= 6);
}

/** Every line covered exactly once and in order; headings one line each. */
export function isValidStructureCoverage(
  structure: SimpleStructureBlock[],
  lineCount: number,
): boolean {
  const ids = structure.flatMap((block) => block.line_ids);
  if (ids.length !== lineCount || !ids.every((id, index) => id === index + 1)) return false;
  return structure.every((block) => block.type !== 'heading' || block.line_ids.length === 1);
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
