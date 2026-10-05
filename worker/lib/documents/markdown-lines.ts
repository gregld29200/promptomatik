// Line-level helpers shared by the Simple Document parser and renderer.
//
// A leaf module (no imports from the renderer or the parser) so both can use
// the same patterns without a module cycle. Everything here is deterministic
// text handling: nothing rewrites the teacher's words, it only recognises the
// shapes they arrive in (Markdown typed by hand, Gemini output, Google Docs
// exports and copies).

export const MARKDOWN_HEADING_PATTERN = /^#{1,6}\s+/;
export const BULLET_PATTERN = /^[-*+•●○◦▪■‣]\s+/;
export const NUMBERED_PATTERN = /^\d{1,3}[.)]\s+/;
export const LETTERED_PATTERN = /^[a-hA-H][.)]\s+/;
export const CHECK_PATTERN = /^(?:[-*+]\s+)?\[([ xX])\]\s+|^[☐□☑✅✓✔]\s*/;
export const TABLE_ROW_PATTERN = /^\|.*\|\s*$/;
export const TABLE_SEPARATOR_PATTERN = /^\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)+\|?\s*$/;
export const QUOTE_PATTERN = /^>\s?/;
export const SEPARATOR_PATTERN = /^([-*_—])(?:\s*\1){2,}$/;
export const PAGE_BREAK_PATTERN = /^\[\s*(?:saut de page|nouvelle page|page break|new page|salto de página|nueva página)\s*\]$/i;
export const ANSWER_SPACE_PATTERN = /^\[\s*(?:lignes|espace de réponse|zone de réponse|lines|answer space|líneas|espacio de respuesta)(?:\s*[:=]\s*(\d{1,2}))?\s*\]$/i;
export const IMAGE_PATTERN = /^!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)$/;
export const TIMESTAMP_PATTERN = /^\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*(\p{L}.{0,48})$/u;

const PICTOGRAPH_PREFIX = /^(?:[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}]+\s*)+/u;

/** A heading's plain text: no `#` marker, no wrapping bold, no leading emoji. */
export function cleanHeadingText(line: string): string {
  let text = line.replace(MARKDOWN_HEADING_PATTERN, '').trim();
  const wrapped = text.match(/^(\*\*|__)(.+)\1$/);
  if (wrapped && !wrapped[2].includes(wrapped[1])) text = wrapped[2].trim();
  return text.replace(PICTOGRAPH_PREFIX, '').trim();
}

export function stripListMarker(line: string): string {
  return line
    .replace(CHECK_PATTERN, '')
    .replace(/^\s*(?:[-*+•●○◦▪■‣]|\d{1,3}[.)]|[a-hA-H][.)])\s+/, '');
}

export function isChecked(line: string): boolean {
  return /^(?:[-*+]\s+)?\[[xX]\]|^[☑✅✓✔]/.test(line);
}

export function letterOf(line: string): string | undefined {
  return line.match(/^([a-hA-H])[.)]\s+/)?.[1];
}

/** Cells of a `| a | b |` Markdown row, or of a tab-separated pasted row. */
export function tableCells(line: string): string[] {
  if (!line.includes('|') && line.includes('\t')) {
    return line.split('\t').map((cell) => cell.trim());
  }
  const inner = line.trim().replace(/^\|/, '').replace(/\|\s*$/, '');
  return inner.split('|').map((cell) => cell.trim());
}

// "Label : value" lines (fiches, briefs, cadres de séance). The label is short,
// starts with a letter, and may be wrapped in bold on either side of the colon.
const FIELD_PATTERN = /^(?:\*\*|__)?([\p{L}][^:*_()\n]{0,44}?)\s*(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s+(\S.*)$/u;

export function parseField(line: string): { label: string; value: string } | null {
  if (/^https?:/i.test(line)) return null;
  const match = line.match(FIELD_PATTERN);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim().replace(/^(?:\*\*|__)\s*/, '');
  if (!label || !value || label.split(/\s+/).length > 7) return null;
  return { label, value };
}

const WORD_BANK_LABEL = /^(?:banque de mots|mots utiles|vocabulaire utile|mots à utiliser|lexique utile|word bank|useful words|useful vocabulary|words to use|banco de palabras|palabras útiles)$/i;

export function isWordBankLabel(label: string): boolean {
  return WORD_BANK_LABEL.test(label.trim());
}

export function wordBankItems(value: string): string[] {
  return value
    .split(/\s*[,;/•·|]\s*/)
    .map((word) => word.replace(/^[*_]+|[*_.]+$/g, '').trim())
    .filter(Boolean);
}

// Section labels that read as headings even with a colon: "Activité 1 : …".
const SECTION_LABEL = /^(?:activité|activite|étape|etape|exercice|partie|séance|seance|section|module|phase|unité|unite|leçon|lecon|tâche|tache|annexe|task|activity|step|exercise|part|session|unit|lesson|appendix|actividad|paso|ejercicio|parte|sesión|sesion|unidad|lección|leccion|tarea)\b/i;

export function isSectionLabel(label: string): boolean {
  return SECTION_LABEL.test(label.trim());
}

/** A whole line wrapped in bold: `**Contexte professionnel**`. */
export function wholeBoldText(line: string): string | null {
  const match = line.match(/^(\*\*|__)(.+)\1$/);
  if (!match) return null;
  const inner = match[2].trim();
  return inner ? inner : null;
}

const MARKDOWN_ESCAPE = /\\([\\`*_{}[\]()#+\-.!=<>~])/g;
const LIST_ARTIFACT = /^(?:[-*+•●○◦▪■‣]|\d{1,3}[.)])(?:\s+(?:\*\*|__)?)?\s*$/;

/**
 * Cleans transport artifacts out of a paste without touching the words:
 * Markdown escapes (`1\.`, `\!`), empty list items and stray bold markers that
 * Google Docs leaves behind, zero-width characters. Text that carries none of
 * these comes back byte-identical.
 */
export function normalizeTeacherSource(content: string): string {
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let changed = false;

  for (const original of lines) {
    let line = original.replace(/[​﻿]/g, '');
    // Escapes come out of Docs/Drive exports, sometimes doubled.
    for (let pass = 0; pass < 3 && /\\[\\`*_{}[\]()#+\-.!=<>~]/.test(line); pass += 1) {
      line = line.replace(MARKDOWN_ESCAPE, '$1');
    }
    // Five or more asterisks are a bold/italic boundary collision; four are an
    // empty bold run. Neither carries meaning on its own.
    line = line.replace(/\*{5,}/g, '*').replace(/\*{4}/g, '');
    const trimmed = line.trim();
    if (trimmed === '**' || trimmed === '__' || LIST_ARTIFACT.test(trimmed)) {
      changed = true;
      out.push('');
      continue;
    }
    if (line !== original) changed = true;
    out.push(trimmed === '' ? '' : line.replace(/\s+$/, ''));
  }

  if (!changed) return content;
  // Collapse the blank runs the dropped artifacts leave behind.
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Leading indentation width, tabs counting as four spaces. */
export function indentWidth(line: string): number {
  const match = line.match(/^[ \t]*/)?.[0] ?? '';
  return match.replace(/\t/g, '    ').length;
}
