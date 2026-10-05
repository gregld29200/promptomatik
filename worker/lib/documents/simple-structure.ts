// Deterministic structure parser for Simple Document mode.
//
// Formatting-only is code, not AI judgement: the same teacher input always
// produces the same structure, title, and bold phrases. The LLM is reserved
// for explicitly requested additions (see generate.ts).
//
// Input contract (a documented Markdown subset, plus the shapes Google Docs,
// Gemini and plain pastes actually produce):
// - `#`–`######` force a heading; `#`/`##` sections, `###`+ subsections.
// - A short line (≤ 90 chars) not ending in ". , ; :" and not starting
//   lowercase reads as a section heading, as does a whole-bold short line.
// - `- ` / `* ` / `•` bullets, `1.` numbers, `a)` letters (two or more in a
//   row), `- [ ]` / `☐` checkboxes; indentation nests them.
// - `| a | b |` rows (or tab-separated rows) form a table.
// - `> ` lines form a highlighted box.
// - Two or more "Label : value" lines form a field grid; "Banque de mots : …"
//   forms a word bank; repeated speakers ("Katrin : …") form a dialogue;
//   "[00:12] Intervenant" lines form a transcript.
// - `---` draws a rule; `[saut de page]` breaks the page; `[lignes]` /
//   `[lignes: 6]` leaves ruled writing space; `![légende](studio:id)` places an
//   uploaded image.
// - A line that does not close a sentence continues into the next line
//   (hard-wrapped prose is joined, and never mistaken for headings).
// - Inline `**bold**` / `*italic*` are rendered as emphasis by the renderer.
// - Everything else is plain text, preserved verbatim.

import { presetForIndex } from './material-renderer';
import {
  ANSWER_SPACE_PATTERN,
  BULLET_PATTERN,
  CHECK_PATTERN,
  IMAGE_PATTERN,
  LETTERED_PATTERN,
  MARKDOWN_HEADING_PATTERN,
  NUMBERED_PATTERN,
  PAGE_BREAK_PATTERN,
  QUOTE_PATTERN,
  SEPARATOR_PATTERN,
  TABLE_ROW_PATTERN,
  TABLE_SEPARATOR_PATTERN,
  TIMESTAMP_PATTERN,
  cleanHeadingText,
  indentWidth,
  isSectionLabel,
  isWordBankLabel,
  normalizeTeacherSource,
  parseField,
  wholeBoldText,
} from './markdown-lines';
import type { DocumentOrientation, DocumentType, SimpleTemplateId, SimpleTransformMaterial } from './types';

export type ListItemKind = 'bullet' | 'numbered' | 'lettered' | 'check';

export type SimpleBlockType =
  | 'heading'
  | 'subtitle'
  | 'paragraph'
  | 'bullet_list'
  | 'numbered_list'
  | 'lettered_list'
  | 'checklist'
  | 'table'
  | 'callout'
  | 'fields'
  | 'word_bank'
  | 'dialogue'
  | 'transcript'
  | 'separator'
  | 'page_break'
  | 'answer_space'
  | 'image';

export interface SimpleStructureBlock {
  type: SimpleBlockType;
  line_ids: number[];
  /** Headings only: 2 for sections, 3 for subsections. Absent means 2. */
  level?: 2 | 3;
  /** Lists only, present when the list nests: one depth per line. */
  depths?: number[];
  /** Lists only, present when the list mixes item kinds: one kind per line. */
  kinds?: ListItemKind[];
}

const MAX_HEADING_LENGTH = 90;
/** "Niveau : B1+ · Durée : 90 min" — several fields on one line. */
const MULTI_FIELD_PATTERN = /\s[·|]\s+(?:\*\*|__)?[\p{L}][^:·|]{0,44}:/u;
const MAX_BOLD_HEADING_LENGTH = 110;
const MAX_FALLBACK_TITLE_LENGTH = 80;

export function stripHeadingMarker(line: string): string {
  return cleanHeadingText(line);
}

// A line that closes a sentence (or ends with list-intro punctuation).
// Lines that do NOT match are treated as hard-wrapped and joined onward.
const SENTENCE_END_PATTERN = /[.!?:;,…]["'»”’)\]*_]*$/;
const STARTS_LOWERCASE_PATTERN = /^[a-zà-öø-ÿ]/;

function isImplicitHeading(line: string, nextLine?: string): boolean {
  return (
    line.length <= MAX_HEADING_LENGTH
    && !/[.,;:]$/.test(line)
    // Headings start with a capital/digit; a lowercase start is prose.
    && !STARTS_LOWERCASE_PATTERN.test(line)
    // Rows, quotes and italic asides are never headings.
    && !/^[|>*_]/.test(line)
    // Two sentences on one line are prose ("Écoutez l'appel. Qui appelle ?").
    && !/[.!?…]\s+\p{Lu}/u.test(line)
    // A following lowercase line means this line was hard-wrapped prose.
    && (nextLine === undefined || !STARTS_LOWERCASE_PATTERN.test(nextLine))
  );
}

interface SourceLine {
  id: number;
  text: string;
  indent: number;
  /** A blank line separated this line from the previous one. */
  afterBlank: boolean;
}

type LineClass =
  | { kind: 'md_heading'; mdLevel: number }
  | { kind: 'list'; item: ListItemKind }
  | { kind: 'table' }
  | { kind: 'quote' }
  | { kind: 'separator' }
  | { kind: 'page_break' }
  | { kind: 'answer_space' }
  | { kind: 'image' }
  | { kind: 'timestamp' }
  | { kind: 'plain' };

function listKindOf(text: string): ListItemKind | null {
  if (CHECK_PATTERN.test(text)) return 'check';
  if (BULLET_PATTERN.test(text)) return 'bullet';
  if (NUMBERED_PATTERN.test(text)) return 'numbered';
  return null;
}

function isTabRow(text: string): boolean {
  return text.includes('\t') && text.split('\t').filter((cell) => cell.trim()).length >= 2;
}

function classify(lines: SourceLine[], index: number): LineClass {
  const { text } = lines[index];
  if (MARKDOWN_HEADING_PATTERN.test(text)) {
    return { kind: 'md_heading', mdLevel: text.match(/^#+/)?.[0].length ?? 2 };
  }
  if (SEPARATOR_PATTERN.test(text)) return { kind: 'separator' };
  if (PAGE_BREAK_PATTERN.test(text)) return { kind: 'page_break' };
  if (ANSWER_SPACE_PATTERN.test(text)) return { kind: 'answer_space' };
  if (IMAGE_PATTERN.test(text)) return { kind: 'image' };
  if (TABLE_ROW_PATTERN.test(text) || TABLE_SEPARATOR_PATTERN.test(text)) return { kind: 'table' };
  if (isTabRow(text) && (isTabRow(lines[index - 1]?.text ?? '') || isTabRow(lines[index + 1]?.text ?? ''))) {
    return { kind: 'table' };
  }
  if (QUOTE_PATTERN.test(text)) return { kind: 'quote' };
  const item = listKindOf(text);
  if (item) return { kind: 'list', item };
  if (LETTERED_PATTERN.test(text)) {
    // A lone "A. Introduction" is a heading or prose; "a) … b) …" is a list.
    const neighbours = [lines[index - 1]?.text, lines[index + 1]?.text];
    if (neighbours.some((line) => line && (LETTERED_PATTERN.test(line) || listKindOf(line)))) {
      return { kind: 'list', item: 'lettered' };
    }
  }
  if (TIMESTAMP_PATTERN.test(text) && !/[.!?]$/.test(text)) return { kind: 'timestamp' };
  return { kind: 'plain' };
}

const LIST_BLOCK_TYPE: Record<ListItemKind, SimpleBlockType> = {
  bullet: 'bullet_list',
  numbered: 'numbered_list',
  lettered: 'lettered_list',
  check: 'checklist',
};

interface ListLine extends SourceLine {
  item: ListItemKind;
}

function listBlock(run: ListLine[]): SimpleStructureBlock {
  // Indentation ranks become depths; a run of letters directly under a
  // numbered/bullet item nests one level deeper even without indentation.
  const indents = Array.from(new Set(run.map((line) => line.indent))).sort((a, b) => a - b);
  const depths: number[] = [];
  run.forEach((line, index) => {
    let depth = Math.min(3, indents.indexOf(line.indent));
    const previous = run[index - 1];
    if (previous && line.indent === previous.indent && line.item === 'lettered' && previous.item !== 'lettered') {
      depth = depths[index - 1] + 1;
    } else if (previous && line.indent === previous.indent && previous.item === 'lettered' && line.item === 'lettered') {
      depth = depths[index - 1];
    }
    depths.push(Math.min(3, depth));
  });
  const topKind = run[depths.indexOf(Math.min(...depths))].item;
  const block: SimpleStructureBlock = { type: LIST_BLOCK_TYPE[topKind], line_ids: run.map((line) => line.id) };
  if (depths.some((depth) => depth > 0)) block.depths = depths;
  if (run.some((line) => line.item !== topKind)) block.kinds = run.map((line) => line.item);
  return block;
}

function fieldLabel(text: string): string | null {
  return parseField(text)?.label ?? null;
}

/** A plain "Label : value" line that is neither a section label nor prose. */
function isFieldLine(text: string): boolean {
  if (wholeBoldText(text)) return false;
  const field = parseField(text);
  return Boolean(field && !isSectionLabel(field.label));
}

function isDialogueRun(labels: string[], documentType?: DocumentType): boolean {
  if (labels.length === 0) return false;
  const distinct = new Set(labels.map((label) => label.toLocaleLowerCase()));
  if (documentType === 'dialogue_script') return distinct.size <= 6;
  return labels.length >= 3 && distinct.size <= 4 && distinct.size < labels.length;
}

export interface ParseOptions {
  documentType?: DocumentType;
}

/**
 * Classify every non-empty line into structural blocks. Markers win (list,
 * table, quote, heading markers), "Label : value" runs become fields or a
 * dialogue, short capitalized or whole-bold lines read as headings, sentence
 * lines become paragraphs, and unfinished lines join into the next line
 * (hard-wrap). Works with or without blank lines — real teacher pastes often
 * separate blocks with single newlines only. Line ids are 1-based over the
 * non-empty trimmed lines, matching the contract the renderer and validator
 * enforce.
 */
export function parseSimpleStructure(content: string, options: ParseOptions = {}): {
  lines: string[];
  structure: SimpleStructureBlock[];
  headings: string[];
} {
  const sourceLines: SourceLine[] = [];
  let afterBlank = false;
  for (const raw of content.split(/\r?\n/)) {
    const text = raw.trim();
    if (!text) {
      afterBlank = true;
      continue;
    }
    sourceLines.push({ id: sourceLines.length + 1, text, indent: indentWidth(raw), afterBlank });
    afterBlank = false;
  }

  const classes = sourceLines.map((_, index) => classify(sourceLines, index));
  const structure: SimpleStructureBlock[] = [];
  const headings: string[] = [];
  const mdLevels: Array<{ block: SimpleStructureBlock; mdLevel: number }> = [];

  let index = 0;
  const peek = (offset = 0) => sourceLines[index + offset];
  const classAt = (at: number) => classes[at];

  const pushHeading = (line: SourceLine, mdLevel?: number) => {
    const block: SimpleStructureBlock = { type: 'heading', line_ids: [line.id] };
    structure.push(block);
    headings.push(cleanHeadingText(line.text));
    if (mdLevel !== undefined) mdLevels.push({ block, mdLevel });
  };

  while (index < sourceLines.length) {
    const line = sourceLines[index];
    const lineClass = classAt(index);

    switch (lineClass.kind) {
      case 'md_heading':
        pushHeading(line, lineClass.mdLevel);
        index += 1;
        continue;
      case 'separator':
      case 'page_break':
      case 'answer_space':
      case 'image':
        structure.push({ type: lineClass.kind, line_ids: [line.id] });
        index += 1;
        continue;
      case 'table': {
        const ids: number[] = [];
        while (index < sourceLines.length && classAt(index).kind === 'table') {
          ids.push(sourceLines[index].id);
          index += 1;
        }
        structure.push({ type: 'table', line_ids: ids });
        continue;
      }
      case 'quote': {
        const ids: number[] = [];
        while (index < sourceLines.length && classAt(index).kind === 'quote') {
          ids.push(sourceLines[index].id);
          index += 1;
        }
        structure.push({ type: 'callout', line_ids: ids });
        continue;
      }
      case 'list': {
        // Lists run across single blank lines: Docs exports space every item.
        const run: ListLine[] = [];
        while (index < sourceLines.length) {
          const current = classAt(index);
          if (current.kind !== 'list') break;
          run.push({ ...sourceLines[index], item: current.item });
          index += 1;
        }
        structure.push(listBlock(run));
        continue;
      }
      case 'timestamp': {
        const ids: number[] = [];
        while (index < sourceLines.length) {
          const current = classAt(index);
          if (current.kind !== 'timestamp' && current.kind !== 'plain') break;
          ids.push(sourceLines[index].id);
          index += 1;
        }
        structure.push({ type: 'transcript', line_ids: ids });
        continue;
      }
      default:
        break;
    }

    // Plain line. Word bank first: "Banque de mots : ajuster, priorité".
    const field = parseField(line.text);
    if (field && isWordBankLabel(field.label)) {
      structure.push({ type: 'word_bank', line_ids: [line.id] });
      index += 1;
      continue;
    }

    // A run of "Label : value" lines: a field grid, or a dialogue when the
    // same few speakers repeat.
    if (isFieldLine(line.text)) {
      const run: SourceLine[] = [];
      let cursor = index;
      while (cursor < sourceLines.length && classAt(cursor).kind === 'plain' && isFieldLine(sourceLines[cursor].text)) {
        const candidate = parseField(sourceLines[cursor].text);
        if (candidate && isWordBankLabel(candidate.label)) break;
        run.push(sourceLines[cursor]);
        cursor += 1;
      }
      const labels = run.map((item) => fieldLabel(item.text) ?? '');
      if (isDialogueRun(labels, options.documentType)) {
        structure.push({ type: 'dialogue', line_ids: run.map((item) => item.id) });
        index = cursor;
        continue;
      }
      if (run.length >= 2 || (run.length === 1 && MULTI_FIELD_PATTERN.test(run[0].text))) {
        structure.push({ type: 'fields', line_ids: run.map((item) => item.id) });
        index = cursor;
        continue;
      }
    }

    // Hard-wrap continuation: the open paragraph's last line did not close a
    // sentence and no blank line intervened, so this line belongs to it.
    const open = structure[structure.length - 1];
    if (
      open?.type === 'paragraph'
      && !line.afterBlank
      && !SENTENCE_END_PATTERN.test(sourceLines[open.line_ids[open.line_ids.length - 1] - 1].text)
    ) {
      open.line_ids.push(line.id);
      index += 1;
      continue;
    }

    const next = peek(1);
    const nextText = next && !next.afterBlank ? next.text : undefined;
    const bold = wholeBoldText(line.text);
    const sectionField = field && isSectionLabel(field.label) && field.value.length <= 70 && !/[.!?]$/.test(field.value);
    const boldHeading = Boolean(bold && bold.length <= MAX_BOLD_HEADING_LENGTH && !/[.!]$/.test(bold));
    // A lone "Niveau : B1" is information, not a section title.
    const plainField = Boolean(field && !sectionField && !boldHeading);
    if (sectionField || boldHeading || (!plainField && isImplicitHeading(line.text, nextText))) {
      pushHeading(line);
      index += 1;
      continue;
    }

    structure.push({ type: 'paragraph', line_ids: [line.id] });
    index += 1;
  }

  applyHeadingLevels(mdLevels, structure);
  markSubtitle(structure, sourceLines);

  return {
    lines: sourceLines.map((line) => line.text),
    structure,
    headings,
  };
}

/**
 * Markdown heading depth is relative: a document written with `#` title and
 * `###` sections has sections, not subsections. The smallest marker level
 * after the opening title becomes h2, anything deeper h3.
 */
function applyHeadingLevels(
  mdLevels: Array<{ block: SimpleStructureBlock; mdLevel: number }>,
  structure: SimpleStructureBlock[],
): void {
  const body = mdLevels.filter(({ block }) => block !== structure[0]);
  if (body.length === 0) return;
  const top = Math.min(...body.map(({ mdLevel }) => mdLevel));
  for (const { block, mdLevel } of body) {
    if (mdLevel > top) block.level = 3;
  }
}

/** A bold strapline right under the title, before any section content. */
function markSubtitle(structure: SimpleStructureBlock[], lines: SourceLine[]): void {
  const [first, second, third] = structure;
  if (first?.type !== 'heading' || second?.type !== 'heading' || !third) return;
  const text = lines[second.line_ids[0] - 1]?.text ?? '';
  if (MARKDOWN_HEADING_PATTERN.test(text)) return;
  if (['fields', 'heading', 'transcript', 'dialogue', 'table'].includes(third.type)) second.type = 'subtitle';
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
  structure: Array<{ type: string; line_ids: number[] }>,
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
    return cleanHeadingText(lines[first.line_ids[0] - 1]);
  }
  return clipAtWordBoundary(cleanHeadingText(lines[0] ?? 'Document'), MAX_FALLBACK_TITLE_LENGTH);
}

/** Calendars read across: landscape by default, everything else portrait. */
export function defaultOrientation(documentType?: DocumentType): DocumentOrientation {
  return documentType === 'course_calendar' ? 'landscape' : 'portrait';
}

export interface SimpleMaterialOptions {
  title?: string;
  emphasisTerms?: string[];
  templateId?: SimpleTemplateId;
  documentType?: DocumentType;
  orientation?: DocumentOrientation;
  level?: string;
  languageFocus?: string;
  locale?: string;
}

export function buildSimpleMaterial(
  content: string,
  options: SimpleMaterialOptions = {},
): SimpleTransformMaterial {
  const trimmedContent = normalizeTeacherSource(content.trim());
  const documentType = options.documentType ?? 'reading';
  const { lines, structure, headings } = parseSimpleStructure(trimmedContent, { documentType });

  return {
    material_type: 'clean_handout',
    title: deriveTitle(options.title, lines, structure),
    source_text: trimmedContent,
    bold_phrases: resolveBoldPhrases(trimmedContent, options.emphasisTerms ?? []),
    heading_phrases: headings,
    structure,
    template_id: options.templateId ?? 'editorial_reader',
    document_type: documentType,
    orientation: options.orientation ?? defaultOrientation(documentType),
    level: options.level?.trim() || undefined,
    language_focus: options.languageFocus?.trim() || undefined,
    locale: options.locale,
    blocks: [],
    id: `material-${Date.now()}-0`,
    preset_id: presetForIndex(0),
  };
}
