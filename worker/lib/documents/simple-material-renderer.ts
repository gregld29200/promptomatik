import type { MaterialBlock, TransformMaterial } from './types';

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
  const explicitHeading = lines.length === 1 ? lines[0].match(/^#{1,3}\s+(.+)$/)?.[1] : undefined;
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

function buildCss(): string {
  return `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Source+Sans+3:wght@400;600;700&display=swap');

  @page { size: A4; margin: 17mm 19mm 18mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: #ffffff;
    color: #202633;
    font-family: 'Source Sans 3', 'Helvetica Neue', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.58;
    orphans: 3;
    widows: 3;
  }
  main { max-width: 165mm; margin: 0 auto; }
  header {
    margin-bottom: 8mm;
    padding-bottom: 4mm;
    border-bottom: 1.5px solid #243b61;
    break-after: avoid;
  }
  h1 {
    margin: 0;
    color: #16253f;
    font-family: 'Cormorant Garamond', 'Times New Roman', serif;
    font-size: 27pt;
    line-height: 1.08;
  }
  section { margin: 0 0 5.5mm; }
  section:last-child { margin-bottom: 0; }
  h2 {
    margin: 0 0 2.5mm;
    color: #16253f;
    font-family: 'Cormorant Garamond', 'Times New Roman', serif;
    font-size: 17pt;
    line-height: 1.15;
    break-after: avoid;
  }
  h3 { margin: 0 0 2mm; color: #16253f; font-size: 12pt; }
  p { margin: 0 0 3.5mm; }
  p:last-child { margin-bottom: 0; }
  strong { color: #16253f; font-weight: 700; }
  ul, ol { margin: 2mm 0 0 6mm; padding-left: 5mm; }
  li { margin-bottom: 1.5mm; break-inside: avoid; }
  dl { margin: 0; }
  .reference-item {
    display: grid;
    grid-template-columns: minmax(32mm, 0.35fr) 1fr;
    gap: 5mm;
    padding: 2.5mm 0;
    border-bottom: 1px solid #d9dee7;
    break-inside: avoid;
  }
  dt { color: #16253f; font-weight: 700; }
  dd { margin: 0; }
  .example { display: block; margin-top: 1mm; color: #626b78; font-style: italic; }
  .word-bank { padding: 3mm 4mm; background: #eef2f7; border-left: 2px solid #243b61; }
  .matching { margin-left: 0; padding: 0; list-style: none; }
  .matching li { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; padding: 2mm 0; border-bottom: 1px solid #d9dee7; }
  .role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5mm; }
  .role-card { padding: 4mm; border: 1px solid #d9dee7; break-inside: avoid; }
  .role-card p { margin-bottom: 2mm; }
  @media screen {
    body { padding: 17mm 19mm 18mm; }
    main { min-height: 262mm; }
  }`;
}

export function renderSimpleMaterialHtml(material: TransformMaterial): string {
  const source = renderSource(material);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(material.title)}</title>
    <style>${buildCss()}</style>
  </head>
  <body>
    <main>
      <header><h1>${renderInlineText(material.title)}</h1></header>
      ${source || material.blocks.map((block) => renderBlock(block, material.title)).join('')}
      ${source ? material.blocks.map((block) => renderBlock(block, material.title)).join('') : ''}
    </main>
  </body>
</html>`;
}
