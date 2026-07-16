import type { MaterialBlock, SimpleTemplateId, TransformMaterial } from './types';
import { documentFontFaceCss } from './fonts.generated';

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

/** Render a deliberately small, safe subset of inline Markdown. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function renderInlineText(value: string, boldPhrases: string[] = []): string {
  const markedUp = escapeHtml(value)
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

function renderTextBlock(
  block: Extract<MaterialBlock, { type: 'instructions' | 'notes' }>,
): string {
  const bullets = block.bullets?.length
    ? `<ul>${block.bullets.map((item) => `<li>${renderInlineText(item)}</li>`).join('')}</ul>`
    : '';
  const wordBank = 'word_bank' in block && block.word_bank?.length
    ? `<p class="word-bank"><strong>Word bank:</strong> ${block.word_bank.map((word: string) => renderInlineText(word)).join(', ')}</p>`
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

function renderQuestions(block: Extract<MaterialBlock, { type: 'questions' }>): string {
  const items = block.items.map((item) => `<li>${renderInlineText(item.prompt)}</li>`).join('');
  return `<section>${heading(block.heading)}<ol>${items}</ol></section>`;
}

function renderFillBlanks(block: Extract<MaterialBlock, { type: 'fill_blanks' }>): string {
  const wordBank = block.word_bank?.length
    ? `<p class="word-bank"><strong>Word bank:</strong> ${block.word_bank.map((word) => renderInlineText(word)).join(', ')}</p>`
    : '';
  const items = block.items.map((item) => `<li>${renderInlineText(item.sentence)}</li>`).join('');
  return `<section>${heading(block.heading)}${wordBank}<ol>${items}</ol></section>`;
}

function renderMatching(block: Extract<MaterialBlock, { type: 'matching' }>): string {
  const items = block.pairs.map((pair) => `<li><span>${renderInlineText(pair.left)}</span><span>${renderInlineText(pair.right)}</span></li>`).join('');
  return `<section>${heading(block.heading)}<ul class="matching">${items}</ul></section>`;
}

function renderRoleCards(block: Extract<MaterialBlock, { type: 'role_cards' }>): string {
  const cards = block.cards.map((card) => `<article class="role-card">
    <h3>${renderInlineText(card.role)}</h3>
    <p><strong>Situation:</strong> ${renderInlineText(card.situation)}</p>
    <p><strong>Goal:</strong> ${renderInlineText(card.goal)}</p>
  </article>`).join('');
  return `<section>${heading(block.heading)}<div class="role-grid">${cards}</div></section>`;
}

function renderBlock(block: MaterialBlock, materialTitle: string): string {
  switch (block.type) {
    case 'article': return renderArticle(block, materialTitle);
    case 'instructions':
    case 'notes': return renderTextBlock(block);
    case 'reference_list': return renderReferenceList(block);
    case 'questions': return renderQuestions(block);
    case 'fill_blanks': return renderFillBlanks(block);
    case 'matching': return renderMatching(block);
    case 'role_cards': return renderRoleCards(block);
    default: return '';
  }
}

function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '');
}

// Kept local (not imported from simple-structure) to avoid a module cycle
// through material-renderer. Same deliberate Markdown subset.
function stripHeadingMarker(line: string): string {
  return line.replace(/^#{1,6}\s+/, '');
}

function nonEmptySourceLines(source: string): string[] {
  return source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function hasCompleteStructure(material: TransformMaterial, lineCount: number): boolean {
  if (!('structure' in material) || !material.structure?.length) return false;
  const ids = material.structure.flatMap((block) => block.line_ids);
  return ids.length === lineCount && ids.every((id, index) => id === index + 1);
}

function renderStructuredSource(material: TransformMaterial): string {
  if (!('source_text' in material) || !material.source_text?.trim()) return '';
  const lines = nonEmptySourceLines(material.source_text);
  if (!hasCompleteStructure(material, lines.length) || !('structure' in material) || !material.structure) return '';
  const boldPhrases = material.bold_phrases ?? [];

  return material.structure.map((block, blockIndex) => {
    const blockLines = block.line_ids.map((id) => lines[id - 1]).filter(Boolean);
    if (blockLines.length === 0) return '';

    if (block.type === 'heading') {
      const text = stripHeadingMarker(blockLines.join(' '));
      if (blockIndex === 0 && block.line_ids[0] === 1 && sameText(text, material.title)) return '';
      return `<h2>${renderInlineText(text, boldPhrases)}</h2>`;
    }

    if (block.type === 'bullet_list' || block.type === 'numbered_list') {
      const tag = block.type === 'bullet_list' ? 'ul' : 'ol';
      const items = blockLines
        .map((line) => `<li>${renderInlineText(stripListMarker(line), boldPhrases)}</li>`)
        .join('');
      return `<section><${tag}>${items}</${tag}></section>`;
    }

    return `<section><p>${renderInlineText(blockLines.join(' '), boldPhrases)}</p></section>`;
  }).filter(Boolean).join('');
}

function renderSourceChunk(
  chunk: string,
  materialTitle: string,
  boldPhrases: string[],
  headingPhrases: string[],
  index: number,
): string {
  const lines = chunk.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return '';

  if (lines.every((line) => /^[-*•]\s+/.test(line))) {
    return `<ul>${lines.map((line) => `<li>${renderInlineText(stripListMarker(line), boldPhrases)}</li>`).join('')}</ul>`;
  }
  if (lines.every((line) => /^\d+[.)]\s+/.test(line))) {
    return `<ol>${lines.map((line) => `<li>${renderInlineText(stripListMarker(line), boldPhrases)}</li>`).join('')}</ol>`;
  }

  const directedHeading = lines.length === 1
    ? headingPhrases.find((candidate) => sameText(candidate, lines[0]))
    : undefined;
  const explicitHeading = lines.length === 1 ? lines[0].match(/^#{1,6}\s+(.+)$/)?.[1] : undefined;
  const implicitHeading = lines.length === 1
    && lines[0].length <= 90
    && !/[.!?;:]$/.test(lines[0])
    ? lines[0]
    : undefined;
  const headingText = directedHeading ?? explicitHeading ?? implicitHeading;
  if (headingText) {
    if (index === 0 && sameText(headingText, materialTitle)) return '';
    return `<h2>${renderInlineText(headingText, boldPhrases)}</h2>`;
  }

  return `<p>${lines.map((line) => renderInlineText(line, boldPhrases)).join('<br />')}</p>`;
}

function renderSource(material: TransformMaterial): string {
  if (!('source_text' in material) || !material.source_text?.trim()) return '';
  const structured = renderStructuredSource(material);
  if (structured) return structured;
  const boldPhrases = material.bold_phrases ?? [];
  const headingPhrases = material.heading_phrases ?? [];
  return material.source_text
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((chunk, index) => renderSourceChunk(chunk.trim(), material.title, boldPhrases, headingPhrases, index))
    .filter(Boolean)
    .map((content) => content.startsWith('<h2>') ? content : `<section>${content}</section>`)
    .join('');
}

// First quoted family name of each font stack — the face we self-host.
function primaryFamilies(...stacks: string[]): string[] {
  const families = stacks
    .map((stack) => stack.match(/^'([^']+)'/)?.[1])
    .filter((family): family is string => Boolean(family));
  return Array.from(new Set(families));
}

function buildCss(template: SimpleTemplate): string {
  return `${documentFontFaceCss(primaryFamilies(template.headingFont, template.bodyFont))}

  @page { size: A4; margin: ${template.pageMargin}; }
  * { box-sizing: border-box; }
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
  main { max-width: 158mm; margin: 0 auto; }
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
    max-width: 150mm;
    color: ${template.accentStrong};
    font-family: ${template.headingFont};
    font-size: ${template.titleSize};
    font-weight: 700;
    line-height: 1.12;
    letter-spacing: -0.012em;
  }
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
  h3 { margin: 0 0 2mm; color: ${template.accentStrong}; font-size: 12pt; }
  p { margin: 0 0 3mm; }
  p:last-child { margin-bottom: 0; }
  strong { color: ${template.accentStrong}; font-weight: 700; }
  ul, ol { margin: 1mm 0 0; padding: 3mm 5mm 3mm 9mm; background: ${template.accentSoft}; }
  li { margin-bottom: 1.4mm; padding-left: 1.5mm; break-inside: avoid; }
  li:last-child { margin-bottom: 0; }
  li::marker { color: ${template.accent}; font-weight: 700; }
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
  .word-bank { padding: 3mm 4mm; background: ${template.accentSoft}; }
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
  body[data-template='classroom_handout'] strong {
    padding: 0 0.7mm;
    background: ${template.accentSoft};
  }

  body[data-template='compact_professional'] main { max-width: 163mm; }
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

  @media screen {
    body { min-height: 297mm; padding: ${template.pageMargin}; }
  }`;
}

export function renderSimpleMaterialHtml(material: TransformMaterial, templateId?: SimpleTemplateId): string {
  const template = resolveSimpleTemplate(templateId ?? ('template_id' in material ? material.template_id : undefined));
  const source = renderSource(material);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(material.title)}</title>
    <style>${buildCss(template)}</style>
  </head>
  <body data-template="${template.id}">
    <main>
      <header><h1>${renderInlineText(material.title)}</h1></header>
      ${source || material.blocks.map((block) => renderBlock(block, material.title)).join('')}
      ${source ? material.blocks.map((block) => renderBlock(block, material.title)).join('') : ''}
    </main>
  </body>
</html>`;
}
