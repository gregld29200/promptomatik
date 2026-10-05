import type {
  DocumentDesign,
  DocumentOrientation,
  DocumentType,
  MaterialBlock,
  SimpleTemplateId,
  TransformMaterial,
} from './types';
import type { ListItemKind, SimpleStructureBlock } from './simple-structure';
import { documentFontFaceCss } from './fonts.generated';
import {
  ANSWER_SPACE_PATTERN,
  IMAGE_PATTERN,
  QUOTE_PATTERN,
  TABLE_SEPARATOR_PATTERN,
  TIMESTAMP_PATTERN,
  cleanHeadingText,
  isChecked,
  parseField,
  stripListMarker,
  tableCells,
  wordBankItems,
} from './markdown-lines';

// Print chrome labels follow the UI language at generation time; the body of
// the document is always the teacher's own text.
type BadgeType = Exclude<DocumentType, 'free' | 'reading'>;

type ChromeLabels = Record<BadgeType, string> & {
  name: string;
  date: string;
  level: string;
  language: string;
  word_bank: string;
  situation: string;
  goal: string;
  answer: string;
  true_label: string;
  false_label: string;
  image_missing: string;
  image_external: string;
};

const CHROME_LABELS: Record<'fr' | 'en' | 'es', ChromeLabels> = {
  fr: {
    worksheet: "Fiche d'exercices",
    teacher_guide: "Guide de l'enseignant",
    lesson_plan: 'Plan de cours',
    role_cards: 'Cartes de rôle',
    dialogue_script: 'Script de dialogue',
    session_plan: 'Fiche de séance',
    checklist: 'Grille de vérification',
    learner_profile: 'Fiche apprenant',
    course_brief: 'Brief de formation',
    course_calendar: 'Calendrier de formation',
    name: 'Nom',
    date: 'Date',
    level: 'Niveau',
    language: 'Langue cible',
    word_bank: 'Banque de mots',
    situation: 'Situation',
    goal: 'Objectif',
    answer: 'Réponse',
    true_label: 'Vrai',
    false_label: 'Faux',
    image_missing: 'Image introuvable',
    image_external: 'Image non intégrée',
  },
  en: {
    worksheet: 'Student worksheet',
    teacher_guide: 'Teacher guide',
    lesson_plan: 'Lesson plan',
    role_cards: 'Role cards',
    dialogue_script: 'Dialogue script',
    session_plan: 'Session plan',
    checklist: 'Checklist',
    learner_profile: 'Learner profile',
    course_brief: 'Course brief',
    course_calendar: 'Course calendar',
    name: 'Name',
    date: 'Date',
    level: 'Level',
    language: 'Target language',
    word_bank: 'Word bank',
    situation: 'Situation',
    goal: 'Goal',
    answer: 'Answer',
    true_label: 'True',
    false_label: 'False',
    image_missing: 'Image not found',
    image_external: 'Image not embedded',
  },
  es: {
    worksheet: 'Ficha de ejercicios',
    teacher_guide: 'Guía del docente',
    lesson_plan: 'Plan de clase',
    role_cards: 'Tarjetas de rol',
    dialogue_script: 'Guion del diálogo',
    session_plan: 'Ficha de sesión',
    checklist: 'Lista de verificación',
    learner_profile: 'Ficha del estudiante',
    course_brief: 'Resumen del curso',
    course_calendar: 'Calendario del curso',
    name: 'Nombre',
    date: 'Fecha',
    level: 'Nivel',
    language: 'Lengua meta',
    word_bank: 'Banco de palabras',
    situation: 'Situación',
    goal: 'Objetivo',
    answer: 'Respuesta',
    true_label: 'Verdadero',
    false_label: 'Falso',
    image_missing: 'Imagen no encontrada',
    image_external: 'Imagen no integrada',
  },
};

function resolveLabels(locale?: string): { lang: string; labels: ChromeLabels } {
  const lang = locale === 'en' || locale === 'es' ? locale : 'fr';
  return { lang, labels: CHROME_LABELS[lang] };
}

function resolveDocumentType(material: TransformMaterial): DocumentType {
  return 'document_type' in material && material.document_type ? material.document_type : 'reading';
}

function resolveOrientation(material: TransformMaterial): DocumentOrientation {
  if ('orientation' in material && material.orientation) return material.orientation;
  return resolveDocumentType(material) === 'course_calendar' ? 'landscape' : 'portrait';
}

type SimpleTemplate = {
  id: SimpleTemplateId;
  pageMargin: string;
  paper: string;
  ink: string;
  muted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  rule: string;
  headingFont: string;
  bodyFont: string;
  bodySize: string;
  bodyLeading: string;
  titleSize: string;
  headingSize: string;
  sectionGap: string;
};

const SIMPLE_TEMPLATES: Record<SimpleTemplateId, SimpleTemplate> = {
  editorial_reader: {
    id: 'editorial_reader',
    pageMargin: '14mm 18mm 16mm',
    paper: '#fbfaf6',
    ink: '#202b3d',
    muted: '#697180',
    accent: '#a35d45',
    accentStrong: '#243b61',
    accentSoft: '#f1e7df',
    rule: '#cfd5dd',
    headingFont: "'Cormorant Garamond', Georgia, serif",
    bodyFont: "'Source Sans 3', 'Helvetica Neue', sans-serif",
    bodySize: '10.7pt',
    bodyLeading: '1.54',
    titleSize: '22.5pt',
    headingSize: '14pt',
    sectionGap: '3.2mm',
  },
  classroom_handout: {
    id: 'classroom_handout',
    pageMargin: '14mm 17mm 16mm',
    paper: '#faf7ef',
    ink: '#26322b',
    muted: '#687269',
    accent: '#b45f3f',
    accentStrong: '#355343',
    accentSoft: '#e8eee7',
    rule: '#ccd7ce',
    headingFont: "'Fraunces', Georgia, serif",
    bodyFont: "'Nunito Sans', 'Trebuchet MS', sans-serif",
    bodySize: '10.4pt',
    bodyLeading: '1.5',
    titleSize: '20pt',
    headingSize: '13.2pt',
    sectionGap: '3mm',
  },
  compact_professional: {
    id: 'compact_professional',
    pageMargin: '14mm 17mm 17mm',
    paper: '#f7f9f8',
    ink: '#17262d',
    muted: '#5d6c72',
    accent: '#315f70',
    accentStrong: '#214654',
    accentSoft: '#e3ecee',
    rule: '#c5d2d5',
    headingFont: "'Space Grotesk', 'Trebuchet MS', sans-serif",
    bodyFont: "'Manrope', 'Helvetica Neue', sans-serif",
    bodySize: '10.3pt',
    bodyLeading: '1.5',
    titleSize: '20.5pt',
    headingSize: '12.5pt',
    sectionGap: '2.7mm',
  },
};

function resolveSimpleTemplate(id?: SimpleTemplateId): SimpleTemplate {
  return SIMPLE_TEMPLATES[id ?? 'editorial_reader'] ?? SIMPLE_TEMPLATES.editorial_reader;
}

const HEADING_FONT_STACKS: Record<NonNullable<DocumentDesign['headingFont']>, string> = {
  cormorant: "'Cormorant Garamond', Georgia, serif",
  fraunces: "'Fraunces', Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  space_grotesk: "'Space Grotesk', 'Trebuchet MS', sans-serif",
  inter: "'Inter', 'Helvetica Neue', sans-serif",
  manrope: "'Manrope', 'Helvetica Neue', sans-serif",
};

const BODY_FONT_STACKS: Record<NonNullable<DocumentDesign['bodyFont']>, string> = {
  source_sans: "'Source Sans 3', 'Helvetica Neue', sans-serif",
  nunito_sans: "'Nunito Sans', 'Trebuchet MS', sans-serif",
  manrope: "'Manrope', 'Helvetica Neue', sans-serif",
  inter: "'Inter', 'Helvetica Neue', sans-serif",
};

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

function mix(hex: string, target: [number, number, number], amount: number): string {
  const rgb = hexToRgb(hex);
  return rgbToHex(rgb.map((channel, index) => channel + (target[index] - channel) * amount) as [number, number, number]);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The teacher's overrides on top of a style. One accent colour derives the
 * whole palette: a darker shade for headings and table heads (kept dark
 * enough for white text), a pale tint for boxes.
 */
function applyDesign(base: SimpleTemplate, design: DocumentDesign | undefined): SimpleTemplate {
  if (!design) return base;
  const template = { ...base };
  if (design.accent) {
    template.accent = design.accent;
    let strong = mix(design.accent, [16, 24, 40], 0.35);
    for (let step = 0; step < 6 && luminance(strong) > 0.16; step += 1) strong = mix(strong, [16, 24, 40], 0.25);
    template.accentStrong = strong;
    template.accentSoft = mix(design.accent, [255, 255, 255], 0.88);
  }
  if (design.headingFont) template.headingFont = HEADING_FONT_STACKS[design.headingFont];
  if (design.bodyFont) template.bodyFont = BODY_FONT_STACKS[design.bodyFont];
  if (design.density && design.density !== 'standard') {
    const airy = design.density === 'airy';
    const scale = (value: string, factor: number) => value.replace(/[\d.]+/, (number) => (Number(number) * factor).toFixed(2));
    template.bodySize = scale(template.bodySize, airy ? 1.06 : 0.94);
    template.sectionGap = scale(template.sectionGap, airy ? 1.45 : 0.7);
    template.bodyLeading = (Number(template.bodyLeading) + (airy ? 0.1 : -0.08)).toFixed(2);
  }
  return template;
}

function resolveDesign(material: TransformMaterial, override?: DocumentDesign): DocumentDesign | undefined {
  const stored = 'design' in material ? material.design : undefined;
  if (!stored && !override) return undefined;
  return { ...stored, ...override };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameText(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: 'base' }) === 0;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Render a deliberately small, safe subset of inline Markdown. */
export function renderInlineText(value: string, boldPhrases: string[] = []): string {
  const markedUp = escapeHtml(value)
    // Links keep their words only: a printed page cannot be clicked.
    .replace(/\[([^\]\n]+)\]\((?:https?:|mailto:)[^)\s]+\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  if (boldPhrases.length === 0) return markedUp;

  const phrasePattern = boldPhrases
    .map((phrase) => escapeRegex(escapeHtml(phrase)))
    .sort((left, right) => right.length - left.length)
    .join('|');
  if (!phrasePattern) return markedUp;
  const pattern = new RegExp(`(${phrasePattern})`, 'gi');

  // Existing emphasis tags are left intact; exact source phrases are marked
  // only in ordinary text nodes, never inside generated HTML.
  return markedUp
    .split(/(<(?:strong|em)>.*?<\/(?:strong|em)>)/g)
    .map((part) => part.startsWith('<') ? part : part.replace(pattern, '<strong>$1</strong>'))
    .join('');
}

/** Inline text plus the `<br>` line breaks Gemini puts inside table cells. */
function renderCellText(value: string, boldPhrases: string[]): string {
  return renderInlineText(value, boldPhrases).replace(/&lt;br\s*\/?&gt;/gi, '<br />');
}

function stripEmphasis(value: string): string {
  return value.replace(/\*\*/g, '').trim();
}

// ---------------------------------------------------------------------------
// Model-added blocks (explicit additions only)
// ---------------------------------------------------------------------------

function heading(value?: string): string {
  return value ? `<h2>${renderInlineText(value)}</h2>` : '';
}

function articleHeading(
  block: Extract<MaterialBlock, { type: 'article' }>,
  materialTitle: string,
): string | undefined {
  const candidates = [block.heading, block.title].filter((value): value is string => Boolean(value));
  return candidates.find((value, index) => (
    !sameText(value, materialTitle)
    && candidates.findIndex((candidate) => sameText(candidate, value)) === index
  ));
}

function renderArticle(
  block: Extract<MaterialBlock, { type: 'article' }>,
  materialTitle: string,
): string {
  const paragraphs = block.paragraphs
    .map((paragraph) => `<p>${renderInlineText(paragraph)}</p>`)
    .join('');
  return `<section>${heading(articleHeading(block, materialTitle))}${paragraphs}</section>`;
}

function wordBankBox(label: string, words: string[]): string {
  const chips = words.map((word) => `<li>${renderInlineText(word)}</li>`).join('');
  return `<div class="word-bank"><p class="word-bank-label">${escapeHtml(label)}</p><ul>${chips}</ul></div>`;
}

function renderTextBlock(
  block: Extract<MaterialBlock, { type: 'instructions' | 'notes' }>,
  labels: ChromeLabels,
): string {
  const bullets = block.bullets?.length
    ? `<ul>${block.bullets.map((item) => `<li>${renderInlineText(item)}</li>`).join('')}</ul>`
    : '';
  const wordBank = 'word_bank' in block && block.word_bank?.length
    ? wordBankBox(labels.word_bank, block.word_bank)
    : '';
  return `<section>${heading(block.heading)}<p>${renderInlineText(block.text)}</p>${bullets}${wordBank}</section>`;
}

function renderReferenceList(
  block: Extract<MaterialBlock, { type: 'reference_list' }>,
): string {
  const items = block.items.map((item) => `<div class="reference-item">
    <dt>${renderInlineText(item.term)}</dt>
    <dd>${renderInlineText(item.detail)}${item.example ? `<span class="example">${renderInlineText(item.example)}</span>` : ''}</dd>
  </div>`).join('');
  return `<section>${heading(block.heading)}<dl>${items}</dl></section>`;
}

const ANSWER_LINES = '<span class="answer-lines" aria-hidden="true"></span>';

function renderQuestions(
  block: Extract<MaterialBlock, { type: 'questions' }>,
  documentType: DocumentType,
  labels: ChromeLabels,
): string {
  const answerSpace = documentType === 'worksheet' ? ANSWER_LINES : '';
  // Teacher-facing documents show the answers; learner-facing ones never do.
  const showAnswers = documentType === 'teacher_guide' || documentType === 'lesson_plan';
  const items = block.items.map((item) => {
    const answer = showAnswers ? `<span class="model-answer"><b>${escapeHtml(labels.answer)} :</b> ${renderInlineText(item.answer)}</span>` : '';
    return `<li>${renderInlineText(item.prompt)}${answer}${answerSpace}</li>`;
  }).join('');
  return `<section>${heading(block.heading)}<ol>${items}</ol></section>`;
}

function renderFillBlanks(block: Extract<MaterialBlock, { type: 'fill_blanks' }>, labels: ChromeLabels): string {
  const wordBank = block.word_bank?.length ? wordBankBox(labels.word_bank, block.word_bank) : '';
  const items = block.items.map((item) => `<li>${renderInlineText(item.sentence)}</li>`).join('');
  return `<section>${heading(block.heading)}${wordBank}<ol>${items}</ol></section>`;
}

function renderMatching(block: Extract<MaterialBlock, { type: 'matching' }>): string {
  const items = block.pairs.map((pair) => `<li><span>${renderInlineText(pair.left)}</span><span>${renderInlineText(pair.right)}</span></li>`).join('');
  return `<section>${heading(block.heading)}<ul class="matching">${items}</ul></section>`;
}

function renderRoleCards(block: Extract<MaterialBlock, { type: 'role_cards' }>, labels: ChromeLabels): string {
  const cards = block.cards.map((card) => `<article class="role-card">
    <h3>${renderInlineText(card.role)}</h3>
    <p><strong>${escapeHtml(labels.situation)} :</strong> ${renderInlineText(card.situation)}</p>
    <p><strong>${escapeHtml(labels.goal)} :</strong> ${renderInlineText(card.goal)}</p>
  </article>`).join('');
  return `<section>${heading(block.heading)}<div class="role-grid">${cards}</div></section>`;
}

function renderBlock(
  block: MaterialBlock,
  materialTitle: string,
  documentType: DocumentType,
  labels: ChromeLabels,
): string {
  switch (block.type) {
    case 'article': return renderArticle(block, materialTitle);
    case 'instructions':
    case 'notes': return renderTextBlock(block, labels);
    case 'reference_list': return renderReferenceList(block);
    case 'questions': return renderQuestions(block, documentType, labels);
    case 'fill_blanks': return renderFillBlanks(block, labels);
    case 'matching': return renderMatching(block);
    case 'role_cards': return renderRoleCards(block, labels);
    default: return '';
  }
}

// ---------------------------------------------------------------------------
// Teacher-owned source
// ---------------------------------------------------------------------------

function nonEmptySourceLines(source: string): string[] {
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

type StructureBlock = Pick<SimpleStructureBlock, 'type' | 'line_ids' | 'level' | 'depths' | 'kinds'>;

function sourceStructure(material: TransformMaterial): StructureBlock[] | undefined {
  return 'structure' in material ? material.structure as StructureBlock[] | undefined : undefined;
}

function hasCompleteStructure(structure: StructureBlock[] | undefined, lineCount: number): structure is StructureBlock[] {
  if (!structure?.length) return false;
  const ids = structure.flatMap((block) => block.line_ids);
  return ids.length === lineCount && ids.every((id, index) => id === index + 1);
}

interface RenderContext {
  documentType: DocumentType;
  boldPhrases: string[];
  labels: ChromeLabels;
  images: Record<string, string>;
  /** Plain text of the section heading in force, for worksheet cues. */
  sectionHeading: string;
}

const TRUE_FALSE_SECTION = /vrai ou faux|vrai\s*\/\s*faux|true or false|true\s*\/\s*false|verdadero o falso/i;
const CLOSED_ANSWER_SECTION = /qcm|cochez|entourez|soulignez|reliez|associez|choisissez|multiple choice|tick|circle|underline|match|choose|marque|elige|relaciona/i;
const GAP_PATTERN = /_{3,}|…{2,}|\.{4,}/;
const ANSWER_KEY_SECTION = /corrig|réponses|reponses|solutions?\b|clé|answer key|answers|key\b|respuestas|solucionario/i;

function listItemsHtml(
  lines: string[],
  block: StructureBlock,
  ctx: RenderContext,
): string {
  const topKind: ListItemKind = block.type === 'numbered_list'
    ? 'numbered'
    : block.type === 'lettered_list'
      ? 'lettered'
      : block.type === 'checklist'
        ? 'check'
        : 'bullet';
  const kinds = lines.map((_, index) => block.kinds?.[index] ?? topKind);
  const depths = lines.map((_, index) => block.depths?.[index] ?? 0);
  const checklistDoc = ctx.documentType === 'checklist';

  const openTag = (kind: ListItemKind): string => {
    if (kind === 'numbered') return '<ol>';
    if (kind === 'lettered') return '<ol type="a" class="lettered">';
    if (kind === 'check' || (kind === 'bullet' && checklistDoc)) return '<ul class="checks">';
    return '<ul>';
  };
  const closeTag = (kind: ListItemKind): string => (kind === 'numbered' || kind === 'lettered' ? '</ol>' : '</ul>');

  const isWorksheet = ctx.documentType === 'worksheet';
  const trueFalse = isWorksheet && TRUE_FALSE_SECTION.test(ctx.sectionHeading);
  const closedAnswers = isWorksheet && CLOSED_ANSWER_SECTION.test(ctx.sectionHeading);

  const itemExtra = (index: number): string => {
    if (!isWorksheet || kinds[index] !== 'numbered') return '';
    if (trueFalse) {
      return `<span class="true-false"><span class="box"></span>${escapeHtml(ctx.labels.true_label)}<span class="box"></span>${escapeHtml(ctx.labels.false_label)}</span>`;
    }
    const hasChildren = (depths[index + 1] ?? -1) > depths[index];
    if (closedAnswers || hasChildren || GAP_PATTERN.test(lines[index])) return '';
    // Worksheets give students ruled writing space under each open item.
    return ANSWER_LINES;
  };

  const itemContent = (index: number): string => {
    const kind = kinds[index];
    const text = renderInlineText(stripListMarker(lines[index]), ctx.boldPhrases);
    if (kind === 'check' || (kind === 'bullet' && checklistDoc)) {
      const checked = kind === 'check' && isChecked(lines[index]);
      return `<span class="box${checked ? ' checked' : ''}"></span>${text}`;
    }
    return text;
  };

  // Rebuild the nesting from depths: a stack of open lists, one per depth.
  let html = '';
  const stack: ListItemKind[] = [];
  lines.forEach((_, index) => {
    const depth = depths[index];
    const kind = kinds[index];
    while (stack.length > depth + 1) {
      html += `</li>${closeTag(stack.pop() as ListItemKind)}`;
    }
    if (stack.length === depth + 1) {
      if (stack[depth] !== kind) {
        html += `</li>${closeTag(stack.pop() as ListItemKind)}`;
      } else {
        html += '</li>';
      }
    }
    while (stack.length < depth + 1) {
      html += openTag(kind);
      stack.push(kind);
    }
    html += `<li>${itemContent(index)}${itemExtra(index)}`;
  });
  while (stack.length > 0) html += `</li>${closeTag(stack.pop() as ListItemKind)}`;
  return html;
}

function renderTable(lines: string[], ctx: RenderContext): string {
  let rows = lines
    .filter((line) => !TABLE_SEPARATOR_PATTERN.test(line))
    .map(tableCells);
  // Google Docs exports open tables with an empty header row.
  while (rows.length > 1 && rows[0].every((cell) => !cell)) rows = rows.slice(1);
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill('')];
  const [head, ...body] = rows.map(pad);
  const headHtml = head.map((cell) => `<th>${renderCellText(stripEmphasis(cell), ctx.boldPhrases)}</th>`).join('');
  const bodyHtml = body
    .map((row) => `<tr>${row.map((cell) => `<td>${renderCellText(cell, ctx.boldPhrases)}</td>`).join('')}</tr>`)
    .join('');
  return `<table><thead><tr>${headHtml}</tr></thead>${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ''}</table>`;
}

/** "Niveau : B1+ · Durée : 90 min" on one line becomes two fields. */
function splitFields(line: string): Array<{ label: string; value: string }> {
  const field = parseField(line);
  if (!field) return [];
  const parts = field.value.split(/\s+[·|]\s+(?=(?:\*\*|__)?[\p{L}][^:]{0,44}:)/u);
  const first = { label: field.label, value: parts[0] };
  const rest = parts.slice(1).flatMap((part) => splitFields(part));
  return [first, ...rest];
}

function renderFields(lines: string[], ctx: RenderContext): string {
  const items = lines.flatMap(splitFields).map((field) => (
    `<div><dt>${renderInlineText(stripEmphasis(field.label), ctx.boldPhrases)}</dt><dd>${renderInlineText(field.value.replace(/^(?:\*\*|__)\s*/, ''), ctx.boldPhrases)}</dd></div>`
  ));
  return `<dl class="fields">${items.join('')}</dl>`;
}

function renderStageDirections(html: string): string {
  return html.replace(/\[([^\]\n]{1,60})\]/g, '<em class="stage">[$1]</em>');
}

function renderDialogue(lines: string[], ctx: RenderContext): string {
  const turns = lines.map((line) => {
    const field = parseField(line);
    if (!field) return `<p>${renderInlineText(line, ctx.boldPhrases)}</p>`;
    return `<div class="turn"><span class="speaker">${renderInlineText(stripEmphasis(field.label))}</span><p>${renderStageDirections(renderInlineText(field.value, ctx.boldPhrases))}</p></div>`;
  });
  return `<div class="dialogue">${turns.join('')}</div>`;
}

function renderTranscript(lines: string[], ctx: RenderContext): string {
  let html = '';
  let text: string[] = [];
  const flush = () => {
    if (text.length > 0) html += `<p>${renderInlineText(text.join(' '), ctx.boldPhrases)}</p>`;
    text = [];
  };
  for (const line of lines) {
    const header = line.match(TIMESTAMP_PATTERN);
    if (header) {
      flush();
      html += `<p class="turn-head"><span class="time">${escapeHtml(header[1])}</span>${renderInlineText(header[2])}</p>`;
    } else {
      text.push(line);
    }
  }
  flush();
  return `<div class="transcript">${html}</div>`;
}

function renderImage(line: string, ctx: RenderContext): string {
  const match = line.match(IMAGE_PATTERN);
  if (!match) return '';
  const alt = match[1].trim();
  const src = match[2];
  const caption = alt && !/^(?:image|img|photo|illustration)\s*\d*$/i.test(alt)
    ? `<figcaption>${renderInlineText(alt)}</figcaption>`
    : '';
  const id = src.startsWith('studio:') ? src.slice('studio:'.length) : null;
  if (id && ctx.images[id]) {
    return `<figure><img src="${escapeHtml(ctx.images[id])}" alt="${escapeHtml(alt)}" />${caption}</figure>`;
  }
  const label = id ? ctx.labels.image_missing : ctx.labels.image_external;
  return `<figure class="image-missing"><span>${escapeHtml(label)}${alt ? ` : ${escapeHtml(alt)}` : ''}</span></figure>`;
}

interface RenderedBlock {
  html: string;
  /** Present on headings so wrappers (answer keys, role cards) can close. */
  headingLevel?: 2 | 3;
  headingText?: string;
}

function renderStructuredBlocks(
  material: TransformMaterial,
  structure: StructureBlock[],
  lines: string[],
  ctx: RenderContext,
): RenderedBlock[] {
  const rendered: RenderedBlock[] = [];

  structure.forEach((block, blockIndex) => {
    const blockLines = block.line_ids.map((id) => lines[id - 1]).filter(Boolean);
    if (blockLines.length === 0) return;

    switch (block.type) {
      case 'heading': {
        const text = cleanHeadingText(blockLines.join(' '));
        if (blockIndex === 0 && block.line_ids[0] === 1 && sameText(text, material.title)) return;
        const level = block.level === 3 ? 3 : 2;
        ctx.sectionHeading = stripEmphasis(text);
        rendered.push({
          html: `<h${level}>${renderInlineText(text, ctx.boldPhrases)}</h${level}>`,
          headingLevel: level,
          headingText: ctx.sectionHeading,
        });
        return;
      }
      case 'subtitle':
        return; // Rendered inside the header.
      case 'bullet_list':
      case 'numbered_list':
      case 'lettered_list':
      case 'checklist':
        rendered.push({ html: `<section>${listItemsHtml(blockLines, block, ctx)}</section>` });
        return;
      case 'table':
        rendered.push({ html: `<section class="table-wrap">${renderTable(blockLines, ctx)}</section>` });
        return;
      case 'callout': {
        const body = blockLines
          .map((line) => line.replace(QUOTE_PATTERN, '').trim())
          .filter(Boolean)
          .map((line) => renderInlineText(line, ctx.boldPhrases))
          .join('<br />');
        rendered.push({ html: `<aside class="callout"><p>${body}</p></aside>` });
        return;
      }
      case 'fields':
        rendered.push({ html: `<section>${renderFields(blockLines, ctx)}</section>` });
        return;
      case 'word_bank': {
        const field = parseField(blockLines[0]);
        if (!field) return;
        rendered.push({ html: `<section>${wordBankBox(stripEmphasis(field.label), wordBankItems(field.value))}</section>` });
        return;
      }
      case 'dialogue':
        rendered.push({ html: `<section>${renderDialogue(blockLines, ctx)}</section>` });
        return;
      case 'transcript':
        rendered.push({ html: `<section>${renderTranscript(blockLines, ctx)}</section>` });
        return;
      case 'separator':
        rendered.push({ html: '<hr />' });
        return;
      case 'page_break':
        rendered.push({ html: '<div class="page-break" aria-hidden="true"></div>' });
        return;
      case 'answer_space': {
        const count = Math.min(20, Math.max(1, Number(blockLines[0].match(ANSWER_SPACE_PATTERN)?.[1] ?? 4)));
        rendered.push({ html: `<div class="answer-lines" style="height:${count * 7}mm" aria-hidden="true"></div>` });
        return;
      }
      case 'image':
        rendered.push({ html: renderImage(blockLines[0], ctx) });
        return;
      default:
        rendered.push({ html: `<section><p>${renderInlineText(blockLines.join(' '), ctx.boldPhrases)}</p></section>` });
    }
  });

  return rendered;
}

/**
 * Wraps runs of blocks: an answer key in a teacher guide gets a tinted box,
 * and every section of a role-card sheet becomes a card with cut lines.
 */
function wrapSections(blocks: RenderedBlock[], documentType: DocumentType): string {
  let html = '';
  let open: { level: number; className: string } | null = null;
  const close = () => {
    if (open) html += open.className === 'role-card' ? '</article>' : '</div>';
    open = null;
  };

  for (const block of blocks) {
    if (block.headingLevel) {
      if (open && block.headingLevel <= open.level) close();
      if (!open && documentType === 'role_cards' && block.headingLevel === 2) {
        html += '<article class="role-card">';
        open = { level: 2, className: 'role-card' };
      } else if (
        !open
        && (documentType === 'teacher_guide' || documentType === 'lesson_plan')
        && ANSWER_KEY_SECTION.test(block.headingText ?? '')
      ) {
        html += '<div class="answer-key">';
        open = { level: block.headingLevel, className: 'answer-key' };
      }
    }
    html += block.html;
  }
  close();
  return html;
}

function renderSourceBody(material: TransformMaterial, ctx: RenderContext): string {
  if (!('source_text' in material) || !material.source_text?.trim()) return '';
  const lines = nonEmptySourceLines(material.source_text);
  const structure = sourceStructure(material);
  if (hasCompleteStructure(structure, lines.length)) {
    return wrapSections(renderStructuredBlocks(material, structure, lines, ctx), ctx.documentType);
  }
  return renderLegacySource(material, ctx);
}

/** Jobs stored before structures existed: blank-line chunks, best effort. */
function renderLegacySource(material: TransformMaterial, ctx: RenderContext): string {
  if (!('source_text' in material) || !material.source_text) return '';
  const headingPhrases = material.heading_phrases ?? [];
  return material.source_text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((chunk, index) => {
      const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) return '';
      if (lines.every((line) => /^[-*•]\s+/.test(line))) {
        return `<section><ul>${lines.map((line) => `<li>${renderInlineText(stripListMarker(line), ctx.boldPhrases)}</li>`).join('')}</ul></section>`;
      }
      if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
        const answerSpace = ctx.documentType === 'worksheet' ? ANSWER_LINES : '';
        return `<section><ol>${lines.map((line) => `<li>${renderInlineText(stripListMarker(line), ctx.boldPhrases)}${answerSpace}</li>`).join('')}</ol></section>`;
      }
      const single = lines.length === 1 ? lines[0] : undefined;
      const headingText = single && (
        headingPhrases.find((candidate) => sameText(candidate, single))
        ?? single.match(/^#{1,6}\s+(.+)$/)?.[1]
        ?? (single.length <= 90 && !/[.!?;:]$/.test(single) ? single : undefined)
      );
      if (headingText) {
        if (index === 0 && sameText(cleanHeadingText(headingText), material.title)) return '';
        return `<h2>${renderInlineText(cleanHeadingText(headingText), ctx.boldPhrases)}</h2>`;
      }
      return `<section><p>${lines.map((line) => renderInlineText(line, ctx.boldPhrases)).join('<br />')}</p></section>`;
    })
    .filter(Boolean)
    .join('');
}

function subtitleText(material: TransformMaterial): string | undefined {
  const structure = sourceStructure(material);
  const block = structure?.find((candidate) => candidate.type === 'subtitle');
  if (!block || !('source_text' in material) || !material.source_text) return undefined;
  const line = nonEmptySourceLines(material.source_text)[block.line_ids[0] - 1];
  return line ? cleanHeadingText(line) : undefined;
}

// First quoted family name of each font stack — the face we self-host.
function primaryFamilies(...stacks: string[]): string[] {
  const families = stacks
    .map((stack) => stack.match(/^'([^']+)'/)?.[1])
    .filter((family): family is string => Boolean(family));
  return Array.from(new Set(families));
}

function buildCss(template: SimpleTemplate, orientation: DocumentOrientation): string {
  const landscape = orientation === 'landscape';
  return `${documentFontFaceCss(primaryFamilies(template.headingFont, template.bodyFont))}

  @page { size: A4${landscape ? ' landscape' : ''}; margin: ${template.pageMargin}; }
  * { box-sizing: border-box; }
  html { background: ${template.paper}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    background: ${template.paper};
    color: ${template.ink};
    font-family: ${template.bodyFont};
    font-size: ${template.bodySize};
    line-height: ${template.bodyLeading};
    orphans: 3;
    widows: 3;
    text-rendering: optimizeLegibility;
  }
  main { max-width: ${landscape ? '255mm' : '158mm'}; margin: 0 auto; }
  header {
    position: relative;
    margin-bottom: 6mm;
    padding: 0 0 4mm;
    border-bottom: 1px solid ${template.rule};
    break-after: avoid;
  }
  header::before {
    display: block;
    width: 18mm;
    height: 1.4mm;
    margin-bottom: 4mm;
    background: ${template.accent};
    content: '';
  }
  h1 {
    margin: 0;
    max-width: ${landscape ? '240mm' : '150mm'};
    color: ${template.accentStrong};
    font-family: ${template.headingFont};
    font-size: ${template.titleSize};
    font-weight: 700;
    line-height: 1.12;
    letter-spacing: -0.012em;
  }
  .subtitle { margin: 2mm 0 0; color: ${template.muted}; font-size: 10.5pt; font-weight: 600; }
  section { margin: 0 0 ${template.sectionGap}; }
  section:last-child { margin-bottom: 0; }
  h2 {
    margin: 5.5mm 0 2mm;
    color: ${template.accentStrong};
    font-family: ${template.headingFont};
    font-size: ${template.headingSize};
    font-weight: 700;
    line-height: 1.22;
    break-after: avoid;
  }
  header + h2 { margin-top: 0; }
  h3 { margin: 4mm 0 1.6mm; color: ${template.accentStrong}; font-size: 11.5pt; line-height: 1.25; break-after: avoid; }
  p { margin: 0 0 3mm; }
  p:last-child { margin-bottom: 0; }
  strong { color: ${template.accentStrong}; font-weight: 700; }
  ul, ol { margin: 1mm 0 0; padding: 3mm 5mm 3mm 9mm; background: ${template.accentSoft}; }
  li { margin-bottom: 1.4mm; padding-left: 1.5mm; break-inside: avoid; }
  li:last-child { margin-bottom: 0; }
  li::marker { color: ${template.accent}; font-weight: 700; }
  li > ul, li > ol { margin: 1.2mm 0 0; padding: 0 0 0 6mm; background: none; }
  ol.lettered > li::marker { font-weight: 600; }
  ul.checks { list-style: none; padding-left: 5mm; }
  ul.checks > li { display: flex; gap: 2.5mm; align-items: baseline; padding-left: 0; }
  .box {
    display: inline-block;
    flex: none;
    width: 3.4mm;
    height: 3.4mm;
    border: 0.3mm solid ${template.accentStrong};
    border-radius: 0.6mm;
    background: #fff;
    vertical-align: -0.4mm;
  }
  .box.checked { background: ${template.accentStrong}; }
  .true-false { display: inline-flex; gap: 2mm; align-items: baseline; margin-left: 4mm; color: ${template.muted}; font-size: 0.92em; white-space: nowrap; }
  .true-false .box + * { margin-right: 2mm; }
  dl { margin: 0; }
  .reference-item {
    display: grid;
    grid-template-columns: minmax(32mm, 0.35fr) 1fr;
    gap: 5mm;
    padding: 2.5mm 0;
    border-bottom: 1px solid ${template.rule};
    break-inside: avoid;
  }
  dt { color: ${template.accentStrong}; font-weight: 700; }
  dd { margin: 0; }
  .example { display: block; margin-top: 1mm; color: ${template.muted}; font-style: italic; }
  .fields { display: grid; grid-template-columns: ${landscape ? 'repeat(3, 1fr)' : '1fr 1fr'}; gap: 2.5mm 6mm; padding: 3mm 0; border-top: 1px solid ${template.rule}; border-bottom: 1px solid ${template.rule}; }
  .fields > div { break-inside: avoid; }
  .fields dt { font-size: 8.4pt; letter-spacing: 0.08em; text-transform: uppercase; color: ${template.accent}; }
  .fields dd { margin-top: 0.4mm; }
  .word-bank { margin: 1mm 0 0; padding: 3mm 4mm; border: 1px dashed ${template.accent}; break-inside: avoid; }
  .word-bank-label { margin: 0 0 1.6mm; color: ${template.accent}; font-size: 8.4pt; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .word-bank ul { display: flex; flex-wrap: wrap; gap: 1.6mm 2mm; margin: 0; padding: 0; list-style: none; background: none; }
  .word-bank li { margin: 0; padding: 0.6mm 2.6mm; border: 1px solid ${template.rule}; background: #fff; }
  .callout { margin: 1mm 0 ${template.sectionGap}; padding: 3mm 4mm; border-left: 1.2mm solid ${template.accent}; background: ${template.accentSoft}; break-inside: avoid; }
  .table-wrap { overflow: visible; }
  table { width: 100%; border-collapse: collapse; font-size: 0.94em; line-height: 1.4; }
  thead { display: table-header-group; }
  th { padding: 2mm 2.4mm; background: ${template.accentStrong}; color: #fff; font-weight: 700; text-align: left; vertical-align: bottom; }
  th strong { color: #fff; }
  td { padding: 2mm 2.4mm; border-bottom: 1px solid ${template.rule}; vertical-align: top; }
  tbody tr:nth-child(even) td { background: ${template.accentSoft}; }
  tr { break-inside: avoid; }
  .dialogue .turn { display: grid; grid-template-columns: 30mm 1fr; gap: 4mm; padding: 1.6mm 0; border-bottom: 1px solid ${template.rule}; break-inside: avoid; }
  .dialogue .speaker { color: ${template.accentStrong}; font-weight: 700; }
  .dialogue p { margin: 0; }
  .stage { color: ${template.muted}; font-size: 0.92em; }
  .transcript .turn-head { margin: 3mm 0 0.8mm; color: ${template.accentStrong}; font-weight: 700; break-after: avoid; }
  .transcript .time { margin-right: 2.4mm; padding: 0.2mm 1.6mm; background: ${template.accentSoft}; color: ${template.accent}; font-size: 0.86em; font-variant-numeric: tabular-nums; }
  hr { margin: 4mm 0; border: 0; border-top: 1px solid ${template.rule}; }
  .page-break { break-after: page; height: 0; }
  figure { margin: 2mm 0 ${template.sectionGap}; text-align: center; break-inside: avoid; }
  figure img { max-width: 100%; max-height: ${landscape ? '120mm' : '150mm'}; object-fit: contain; }
  figcaption { margin-top: 1.4mm; color: ${template.muted}; font-size: 9pt; font-style: italic; }
  .image-missing { padding: 6mm; border: 1px dashed ${template.rule}; color: ${template.muted}; font-size: 9pt; }
  .model-answer { display: block; margin-top: 1mm; color: ${template.muted}; }
  .answer-key { margin-top: 4mm; padding: 1mm 4mm 4mm; border: 1px solid ${template.rule}; background: ${template.accentSoft}; }
  .answer-key ul, .answer-key ol { background: none; }
  .matching { margin-left: 0; padding: 0; list-style: none; }
  .matching li { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; padding: 2mm 0; border-bottom: 1px solid ${template.rule}; }
  .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  .role-card { padding: 4mm; border: 1px solid ${template.rule}; break-inside: avoid; }
  .role-card p { margin-bottom: 2mm; }

  body[data-template='classroom_handout'] header {
    padding: 3mm 5mm;
    border: 1px solid ${template.rule};
    background: ${template.accentSoft};
  }
  body[data-template='classroom_handout'] header::before { width: 10mm; height: 1mm; margin-bottom: 3mm; }
  body[data-template='classroom_handout'] h2 {
    padding-bottom: 1.4mm;
    border-bottom: 1px solid ${template.rule};
  }
  body[data-template='classroom_handout'] p strong,
  body[data-template='classroom_handout'] li strong {
    padding: 0 0.7mm;
    background: ${template.accentSoft};
  }

  body[data-template='compact_professional'] main { max-width: ${landscape ? '260mm' : '163mm'}; }
  body[data-template='compact_professional'] header { margin-bottom: 6mm; padding-bottom: 3.5mm; border-top: 1.2mm solid ${template.accent}; }
  body[data-template='compact_professional'] header::before { display: none; }
  body[data-template='compact_professional'] h1 { letter-spacing: -0.02em; }
  body[data-template='compact_professional'] h2 {
    margin-top: 5mm;
    letter-spacing: 0.045em;
    text-transform: uppercase;
  }
  body[data-template='compact_professional'] ul,
  body[data-template='compact_professional'] ol { padding-top: 2.5mm; padding-bottom: 2.5mm; }

  .doc-badge {
    margin: 0 0 2mm;
    color: ${template.accent};
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .meta-strip {
    display: flex;
    gap: 8mm;
    margin: 2.5mm 0 0;
    color: ${template.muted};
    font-size: 9.2pt;
  }
  .meta-strip b { color: ${template.accentStrong}; font-weight: 700; }
  .ws-fields {
    display: flex;
    gap: 10mm;
    margin: 3mm 0 0;
    font-size: 9.2pt;
    color: ${template.muted};
  }
  .ws-field {
    display: flex;
    flex: 1;
    gap: 2mm;
    align-items: baseline;
  }
  .ws-field::after {
    content: '';
    flex: 1;
    border-bottom: 0.3mm solid ${template.rule};
  }
  .answer-lines {
    display: block;
    height: 14mm;
    margin: 1.6mm 0 0.6mm;
    background: repeating-linear-gradient(
      to bottom,
      transparent 0,
      transparent 6.7mm,
      ${template.rule} 6.7mm,
      ${template.rule} 7mm
    );
  }
  div.answer-lines { margin: 1mm 0 ${template.sectionGap}; break-inside: avoid; }
  body[data-doctype='worksheet'] ol li { break-inside: avoid; }

  body[data-doctype='teacher_guide'] main { font-size: 0.95em; }

  body[data-doctype='lesson_plan'] main { counter-reset: stage; }
  body[data-doctype='lesson_plan'] h2 { counter-increment: stage; }
  body[data-doctype='lesson_plan'] h2::before {
    margin-right: 2.2mm;
    color: ${template.accent};
    content: counter(stage) ' —';
  }
  body[data-doctype='lesson_plan'] .answer-key h2::before { content: none; }

  body[data-doctype='role_cards'] .role-card {
    margin: 0 0 6mm;
    padding: 5mm 6mm;
    border: 0.4mm dashed ${template.muted};
    background: #fff;
  }
  body[data-doctype='role_cards'] .role-card h2 { margin-top: 0; }

  body[data-doctype='learner_profile'] .fields,
  body[data-doctype='course_brief'] .fields,
  body[data-doctype='session_plan'] .fields { background: ${template.accentSoft}; padding: 3mm 4mm; border: 0; }

  header.with-logo { display: grid; grid-template-columns: 1fr auto; gap: 6mm; align-items: start; }
  header.with-logo::before { grid-column: 1 / -1; }
  .header-logo { max-width: 40mm; max-height: 16mm; object-fit: contain; }
  body[data-header='band'] header {
    padding: 5mm 6mm;
    border: 0;
    background: ${template.accentStrong};
    color: #fff;
  }
  body[data-header='band'] header::before { background: ${template.accentSoft}; }
  body[data-header='band'] h1,
  body[data-header='band'] .doc-badge,
  body[data-header='band'] .meta-strip b { color: #fff; }
  body[data-header='band'] .subtitle,
  body[data-header='band'] .meta-strip,
  body[data-header='band'] .ws-fields { color: ${template.accentSoft}; }
  body[data-header='band'] .ws-field::after { border-color: ${template.accentSoft}; }
  body[data-header='frame'] header {
    padding: 4mm 5mm;
    border: 0.5mm solid ${template.accentStrong};
    background: transparent;
  }
  body[data-header='rule'] header { padding: 0 0 4mm; border: 0; border-bottom: 0.6mm solid ${template.accentStrong}; background: transparent; }
  .doc-footer { margin-top: 10mm; padding-top: 2mm; border-top: 1px solid ${template.rule}; color: ${template.muted}; font-size: 8.5pt; }

  @media screen {
    body { min-height: ${landscape ? '210mm' : '297mm'}; padding: ${template.pageMargin}; }
    .page-break { height: 0; margin: 6mm 0; border-top: 1px dashed ${template.rule}; }
  }
  /* In the PDF the footer text is printed on every page by the PDF engine. */
  @media print { .doc-footer { display: none; } }`;
}

function metaStrip(labels: ChromeLabels, material: TransformMaterial): string {
  const level = 'level' in material ? material.level : undefined;
  const languageFocus = 'language_focus' in material ? material.language_focus : undefined;
  const entries = [
    level ? `<span><b>${escapeHtml(labels.level)}</b> ${escapeHtml(level)}</span>` : '',
    languageFocus ? `<span><b>${escapeHtml(labels.language)}</b> ${escapeHtml(languageFocus)}</span>` : '',
  ].filter(Boolean);
  return entries.length > 0 ? `<div class="meta-strip">${entries.join('')}</div>` : '';
}

function renderHeaderChrome(
  documentType: DocumentType,
  labels: ChromeLabels,
  material: TransformMaterial,
): { badge: string; belowTitle: string } {
  if (documentType === 'free' || documentType === 'reading') {
    return { badge: '', belowTitle: documentType === 'reading' ? metaStrip(labels, material) : '' };
  }
  const badge = `<p class="doc-badge">${escapeHtml(labels[documentType])}</p>`;
  if (documentType === 'worksheet') {
    return {
      badge,
      belowTitle: `<div class="ws-fields"><span class="ws-field">${escapeHtml(labels.name)}</span><span class="ws-field">${escapeHtml(labels.date)}</span></div>`,
    };
  }
  return { badge, belowTitle: metaStrip(labels, material) };
}

export interface SimpleRenderOptions {
  /** Uploaded images, by id, as data URIs: `![légende](studio:<id>)`. */
  images?: Record<string, string>;
  /** Live design overrides (preview) on top of the stored design. */
  design?: DocumentDesign;
}

export function renderSimpleMaterialHtml(
  material: TransformMaterial,
  templateId?: SimpleTemplateId,
  options: SimpleRenderOptions = {},
): string {
  const design = resolveDesign(material, options.design);
  const template = applyDesign(
    resolveSimpleTemplate(templateId ?? ('template_id' in material ? material.template_id : undefined)),
    design,
  );
  const documentType = resolveDocumentType(material);
  const orientation = resolveOrientation(material);
  const { lang, labels } = resolveLabels('locale' in material ? material.locale : undefined);
  const { badge, belowTitle } = renderHeaderChrome(documentType, labels, material);
  const ctx: RenderContext = {
    documentType,
    boldPhrases: ('bold_phrases' in material ? material.bold_phrases : undefined) ?? [],
    labels,
    images: options.images ?? {},
    sectionHeading: '',
  };
  const source = renderSourceBody(material, ctx);
  const blocks = material.blocks.map((block) => renderBlock(block, material.title, documentType, labels)).join('');
  const subtitle = subtitleText(material);
  const logo = design?.logoImageId ? ctx.images[design.logoImageId] : undefined;
  return `<!DOCTYPE html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(material.title)}</title>
    <style>${buildCss(template, orientation)}</style>
  </head>
  <body data-template="${template.id}" data-doctype="${documentType}" data-orientation="${orientation}"${design?.header ? ` data-header="${design.header}"` : ''}>
    <main>
      ${renderHeader(material, { badge, belowTitle, subtitle, logo })}
      ${source || blocks}
      ${source ? blocks : ''}
      ${design?.footerText ? `<footer class="doc-footer">${escapeHtml(design.footerText)}</footer>` : ''}
    </main>
  </body>
</html>`;
}

function renderHeader(
  material: TransformMaterial,
  parts: { badge: string; belowTitle: string; subtitle?: string; logo?: string },
): string {
  const titleBlock = `${parts.badge}<h1>${renderInlineText(material.title)}</h1>${parts.subtitle ? `<p class="subtitle">${renderInlineText(parts.subtitle)}</p>` : ''}${parts.belowTitle}`;
  if (!parts.logo) return `<header>${titleBlock}</header>`;
  return `<header class="with-logo"><div>${titleBlock}</div><img class="header-logo" src="${escapeHtml(parts.logo)}" alt="" /></header>`;
}

/** Image ids a document references, for the route to load before rendering. */
export function referencedImageIds(material: TransformMaterial, design?: DocumentDesign): string[] {
  const ids = new Set<string>();
  const logo = design?.logoImageId ?? ('design' in material ? material.design?.logoImageId : undefined);
  if (logo) ids.add(logo);
  if (!('source_text' in material) || !material.source_text) return Array.from(ids);
  for (const line of nonEmptySourceLines(material.source_text)) {
    const src = line.match(IMAGE_PATTERN)?.[2];
    if (src?.startsWith('studio:')) ids.add(src.slice('studio:'.length));
  }
  return Array.from(ids);
}
