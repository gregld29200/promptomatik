import type {
  MaterialBlock,
  StylePreset,
  TransformMaterial,
} from './types';

type PresetConfig = {
  label: string;
  description: string;
  pageMargin: string;
  headerGap: string;
  sectionGap: string;
  pageBg: string;
  surface: string;
  surfaceAlt: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  text: string;
  muted: string;
  border: string;
  headingFont: string;
  bodyFont: string;
  displayFont: string;
  radius: string;
  titleTransform: string;
  headerVariant: 'folio' | 'slab' | 'paper';
  sectionVariant: 'rule' | 'panel' | 'soft';
  stamp: string;
};

const PRESETS: Record<StylePreset, PresetConfig> = {
  studio_academic: {
    label: 'Studio Academic',
    description: 'Editorial and text-led, built for reading-heavy classroom materials.',
    pageMargin: '16mm 18mm 19mm 18mm',
    headerGap: '22px',
    sectionGap: '18px',
    pageBg: '#f6f1e7',
    surface: '#fffdf8',
    surfaceAlt: '#f1eadc',
    accent: '#243b61',
    accentStrong: '#16253f',
    accentSoft: '#e5ecf6',
    text: '#1f2430',
    muted: '#6c7483',
    border: '#cbd3df',
    headingFont: "'Cormorant Garamond', 'Times New Roman', serif",
    bodyFont: "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif",
    displayFont: "'Cormorant Garamond', 'Times New Roman', serif",
    radius: '4px',
    titleTransform: 'none',
    headerVariant: 'folio',
    sectionVariant: 'rule',
    stamp: 'Editorial Worksheet Series',
  },
  modern_training: {
    label: 'Modern Training',
    description: 'Crisp corporate learning design with stronger hierarchy and guided blocks.',
    pageMargin: '15mm 16mm 18mm 16mm',
    headerGap: '20px',
    sectionGap: '16px',
    pageBg: '#eef3f7',
    surface: '#ffffff',
    surfaceAlt: '#dfeaf2',
    accent: '#0c527f',
    accentStrong: '#083b5c',
    accentSoft: '#e2eef6',
    text: '#13222f',
    muted: '#5c6e7d',
    border: '#c4d4df',
    headingFont: "'Space Grotesk', 'Trebuchet MS', sans-serif",
    bodyFont: "'Manrope', 'Helvetica Neue', Arial, sans-serif",
    displayFont: "'Space Grotesk', 'Trebuchet MS', sans-serif",
    radius: '14px',
    titleTransform: 'uppercase',
    headerVariant: 'slab',
    sectionVariant: 'panel',
    stamp: 'Professional Classroom Pack',
  },
  warm_coaching: {
    label: 'Warm Coaching',
    description: 'Softer, conversational print design for speaking, reflection, and support.',
    pageMargin: '16mm 17mm 19mm 17mm',
    headerGap: '22px',
    sectionGap: '18px',
    pageBg: '#fcf4eb',
    surface: '#fffdf8',
    surfaceAlt: '#f7eadb',
    accent: '#a95e35',
    accentStrong: '#7f4322',
    accentSoft: '#f4e0cf',
    text: '#2a2521',
    muted: '#75685f',
    border: '#e5ceb9',
    headingFont: "'Fraunces', Georgia, serif",
    bodyFont: "'Nunito Sans', 'Trebuchet MS', sans-serif",
    displayFont: "'Fraunces', Georgia, serif",
    radius: '18px',
    titleTransform: 'none',
    headerVariant: 'paper',
    sectionVariant: 'soft',
    stamp: 'Conversation Studio Sheet',
  },
};

const PRESET_ORDER: StylePreset[] = ['studio_academic', 'modern_training', 'warm_coaching'];

function resolvePreset(presetId?: StylePreset): PresetConfig {
  return PRESETS[presetId ?? 'studio_academic'] || PRESETS.studio_academic;
}

export function presetForIndex(index: number): StylePreset {
  return PRESET_ORDER[index] || PRESET_ORDER[0];
}

export function presetLabel(presetId?: StylePreset): string {
  return resolvePreset(presetId).label;
}

export function presetMeta(presetId?: StylePreset): {
  label: string;
  description: string;
  accent: string;
} {
  const preset = resolvePreset(presetId);
  return {
    label: preset.label,
    description: preset.description,
    accent: preset.accent,
  };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function interactionLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

function sectionClass(
  preset: PresetConfig,
  tone: 'default' | 'soft' | 'airy' = 'default',
): string {
  const variant =
    tone === 'soft'
      ? 'section-soft'
      : tone === 'airy'
        ? 'section-airy'
        : `section-${preset.sectionVariant}`;
  return `section-shell ${variant}`;
}

function renderHeading(heading: string | undefined): string {
  if (!heading) return '';
  return `<h2 class="section-heading">${esc(heading)}</h2>`;
}

function wrapSection(
  preset: PresetConfig,
  content: string,
  tone: 'default' | 'soft' | 'airy' = 'default',
): string {
  return `<section class="${sectionClass(preset, tone)}">${content}</section>`;
}

function renderInstructions(
  block: Extract<MaterialBlock, { type: 'instructions' }>,
  preset: PresetConfig,
): string {
  const bullets = block.bullets?.length
    ? `<ul class="bullet-list">${block.bullets.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';
  const wordBank = block.word_bank?.length
    ? `<div class="chip-row">${block.word_bank.map((word) => `<span class="chip">${esc(word)}</span>`).join('')}</div>`
    : '';

  return wrapSection(
    preset,
    `${renderHeading(block.heading)}<p class="lead-copy">${esc(block.text)}</p>${bullets}${wordBank}`,
    'soft',
  );
}

function renderArticle(
  block: Extract<MaterialBlock, { type: 'article' }>,
  preset: PresetConfig,
): string {
  const [first, ...rest] = block.paragraphs;
  const firstParagraph = first
    ? `<p class="article-paragraph article-opening"><span class="dropcap">${esc(first.charAt(0))}</span>${esc(first.slice(1))}</p>`
    : '';
  const paragraphs = rest
    .map((paragraph) => `<p class="article-paragraph">${esc(paragraph)}</p>`)
    .join('');

  return wrapSection(
    preset,
    `${renderHeading(block.heading ?? block.title)}<div class="article-frame">${block.title ? `<div class="article-kicker">${esc(block.title)}</div>` : ''}${firstParagraph}${paragraphs}</div>`,
    'airy',
  );
}

function renderQuestions(
  block: Extract<MaterialBlock, { type: 'questions' }>,
  preset: PresetConfig,
): string {
  return wrapSection(
    preset,
    `${renderHeading(block.heading)}<ol class="question-list">${block.items
      .map(
        (item, index) => `<li class="question-item">
            <div class="question-index">${index + 1}</div>
            <div class="question-body">
              <div class="question-prompt">${esc(item.prompt)}</div>
              <div class="answer-line"></div>
              <div class="answer-line"></div>
            </div>
          </li>`,
      )
      .join('')}</ol>`,
  );
}

function renderReferenceList(
  block: Extract<MaterialBlock, { type: 'reference_list' }>,
  preset: PresetConfig,
): string {
  return wrapSection(
    preset,
    `${renderHeading(block.heading)}<table class="reference-table">${block.items
      .map(
        (item) => `<tr>
            <td class="reference-term">${esc(item.term)}</td>
            <td class="reference-detail">
              <div>${esc(item.detail)}</div>
              ${item.example ? `<div class="reference-example">${esc(item.example)}</div>` : ''}
            </td>
          </tr>`,
      )
      .join('')}</table>`,
  );
}

function matchingRightColumn(pairs: Extract<MaterialBlock, { type: 'matching' }>['pairs']): string[] {
  if (pairs.length <= 1) return pairs.map((pair) => pair.right);
  return pairs.map((_, index) => pairs[(index + 2) % pairs.length].right);
}

function renderMatching(
  block: Extract<MaterialBlock, { type: 'matching' }>,
  preset: PresetConfig,
): string {
  const rightItems = matchingRightColumn(block.pairs);

  return wrapSection(
    preset,
    `${renderHeading(block.heading)}
      <table class="matching-table">
        <tr>
          <td class="matching-col">
            ${block.pairs
              .map(
                (pair, index) => `<div class="match-pill match-left"><strong>${index + 1}.</strong> ${esc(pair.left)}</div>`,
              )
              .join('')}
          </td>
          <td class="matching-col">
            ${rightItems
              .map(
                (item, index) => `<div class="match-pill match-right"><strong>${String.fromCharCode(97 + index)})</strong> ${esc(item)}</div>`,
              )
              .join('')}
          </td>
        </tr>
      </table>`,
  );
}

function blankSentence(sentence: string): string {
  if (sentence.includes('_____')) return sentence;
  return sentence.replace(/\b_{3,}\b/g, '________________');
}

function renderFillBlanks(
  block: Extract<MaterialBlock, { type: 'fill_blanks' }>,
  preset: PresetConfig,
): string {
  const wordBank = block.word_bank?.length
    ? `<div class="chip-row">${block.word_bank.map((word) => `<span class="chip">${esc(word)}</span>`).join('')}</div>`
    : '';

  return wrapSection(
    preset,
    `${renderHeading(block.heading)}${wordBank}<ol class="blank-list">${block.items
      .map((item) => `<li>${esc(blankSentence(item.sentence))}</li>`)
      .join('')}</ol>`,
  );
}

function renderRoleCards(
  block: Extract<MaterialBlock, { type: 'role_cards' }>,
  preset: PresetConfig,
): string {
  return wrapSection(
    preset,
    `${renderHeading(block.heading)}
      <div class="role-grid">${block.cards
        .map(
          (card, index) => `<div class="role-cell">
              <div class="role-card ${index === 0 ? 'role-card-primary' : 'role-card-secondary'}">
                <div class="role-eyebrow">${index === 0 ? 'Speaker A' : 'Speaker B'}</div>
                <h3 class="role-title">${esc(card.role)}</h3>
                <p class="role-copy"><strong>Situation</strong> ${esc(card.situation)}</p>
                <p class="role-copy"><strong>Goal</strong> ${esc(card.goal)}</p>
                ${card.bullets?.length ? `<ul class="bullet-list">${card.bullets.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
                ${card.prompts?.length ? `<div class="prompt-box"><div class="prompt-label">Useful language</div>${card.prompts.map((item) => `<div class="prompt-line">${esc(item)}</div>`).join('')}</div>` : ''}
              </div>
            </div>`,
        )
        .join('')}</div>`,
    'airy',
  );
}

function renderNotes(
  block: Extract<MaterialBlock, { type: 'notes' }>,
  preset: PresetConfig,
): string {
  const bullets = block.bullets?.length
    ? `<ul class="bullet-list">${block.bullets.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';

  return wrapSection(
    preset,
    `${renderHeading(block.heading)}<p class="lead-copy">${esc(block.text)}</p>${bullets}`,
    'soft',
  );
}

function renderBlock(block: MaterialBlock, preset: PresetConfig): string {
  switch (block.type) {
    case 'instructions':
      return renderInstructions(block, preset);
    case 'article':
      return renderArticle(block, preset);
    case 'questions':
      return renderQuestions(block, preset);
    case 'reference_list':
      return renderReferenceList(block, preset);
    case 'matching':
      return renderMatching(block, preset);
    case 'fill_blanks':
      return renderFillBlanks(block, preset);
    case 'role_cards':
      return renderRoleCards(block, preset);
    case 'notes':
      return renderNotes(block, preset);
    default:
      return '';
  }
}

function renderBrandPanel(preset: PresetConfig): string {
  if (preset.headerVariant === 'folio') {
    return `<div class="brand-panel folio-brand">
      <div class="brand-mark">TI</div>
      <div class="brand-copy">${esc(preset.stamp)}</div>
    </div>`;
  }

  if (preset.headerVariant === 'slab') {
    return `<div class="brand-panel slab-brand">
      <div class="brand-mark">01</div>
      <div class="brand-copy">${esc(preset.stamp)}</div>
    </div>`;
  }

  return `<div class="brand-panel paper-brand">
    <div class="brand-mark">TI</div>
    <div class="brand-copy">${esc(preset.stamp)}</div>
  </div>`;
}

function renderHeader(material: TransformMaterial, preset: PresetConfig): string {
  return `<header class="doc-header">
    <div class="header-grid">
      <div class="header-main">
        <div class="doc-kicker">${esc(preset.label)}</div>
        <h1 class="doc-title">${esc(material.title)}</h1>
        <div class="meta-strip">
          <span>${esc(material.skill_focus)}</span>
          <span>${esc(interactionLabel(material.interaction_pattern))}</span>
          <span>${material.estimated_minutes} min</span>
        </div>
        <div class="name-line">Name _______________________________ &nbsp;&nbsp; Date _______________________________</div>
      </div>
      <div class="header-brand">${renderBrandPanel(preset)}</div>
    </div>
  </header>`;
}

function buildAnswerKey(material: TransformMaterial): string {
  const items: string[] = [];

  for (const block of material.blocks) {
    if (block.type === 'questions') {
      block.items.forEach((item, index) => {
        items.push(`<div class="answer-item"><strong>${index + 1}.</strong> ${esc(item.answer)}</div>`);
      });
    }
    if (block.type === 'matching') {
      block.pairs.forEach((pair, index) => {
        items.push(`<div class="answer-item"><strong>${index + 1}.</strong> ${esc(pair.left)} &rarr; ${esc(pair.right)}</div>`);
      });
    }
    if (block.type === 'fill_blanks') {
      block.items.forEach((item, index) => {
        items.push(`<div class="answer-item"><strong>${index + 1}.</strong> ${esc(item.answer)}</div>`);
      });
    }
  }

  if (items.length === 0) return '';

  return `<section class="answer-key">
    <h2 class="section-heading">Answer Key</h2>
    <div class="answer-columns">${items.join('')}</div>
  </section>`;
}

function buildCss(preset: PresetConfig): string {
  return `@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Source+Sans+3:wght@400;600;700&family=Space+Grotesk:wght@500;700&family=Manrope:wght@400;600;700&family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Nunito+Sans:wght@400;600;700&display=swap');

  @page {
    size: A4;
    margin: ${preset.pageMargin};
    @bottom-center { content: counter(page) " / " counter(pages); }
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: ${preset.pageBg};
    color: ${preset.text};
    font-family: ${preset.bodyFont};
    font-size: 12.6px;
    line-height: 1.6;
    orphans: 3;
    widows: 3;
  }

  .doc {
    background: ${preset.pageBg};
    padding-bottom: 1mm;
  }

  .doc-header {
    margin: 0 0 ${preset.headerGap} 0;
    page-break-inside: avoid;
    ${preset.headerVariant === 'folio' ? `padding: 0 0 14px 0; border-top: 1px solid ${preset.border}; border-bottom: 3px double ${preset.border};` : ''}
    ${preset.headerVariant === 'slab' ? `padding: 16px 18px; border-left: 12px solid ${preset.accent}; border-radius: ${preset.radius}; background: linear-gradient(180deg, ${preset.surface}, ${preset.accentSoft}); border: 1px solid ${preset.border};` : ''}
    ${preset.headerVariant === 'paper' ? `padding: 18px 18px 16px; border-radius: ${preset.radius}; background: ${preset.surface}; border: 1px solid ${preset.border}; box-shadow: 0 8px 18px rgba(99, 70, 50, 0.08);` : ''}
  }

  .header-grid {
    display: table;
    width: 100%;
    table-layout: fixed;
  }

  .header-main,
  .header-brand {
    display: table-cell;
    vertical-align: top;
  }

  .header-brand {
    width: 32%;
    text-align: right;
    padding-left: 14px;
  }

  .doc-kicker {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    font-weight: 700;
    color: ${preset.accent};
    margin-bottom: 6px;
  }

  .doc-title {
    margin: 0 0 8px 0;
    color: ${preset.text};
    font-family: ${preset.displayFont};
    font-size: 29px;
    line-height: 1.05;
    text-transform: ${preset.titleTransform};
    letter-spacing: ${preset.titleTransform === 'uppercase' ? '0.03em' : '0'};
  }

  .meta-strip span {
    display: inline-block;
    margin: 0 8px 8px 0;
    padding: 4px 8px;
    background: ${preset.accentSoft};
    border: 1px solid ${preset.border};
    border-radius: 999px;
    font-size: 11px;
    color: ${preset.accentStrong};
  }

  .name-line {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px solid ${preset.border};
    color: ${preset.muted};
    font-size: 11px;
  }

  .brand-panel {
    display: inline-block;
    min-width: 110px;
    text-align: center;
  }

  .brand-mark {
    font-family: ${preset.displayFont};
    font-size: ${preset.headerVariant === 'slab' ? '34px' : '28px'};
    line-height: 1;
    color: ${preset.accentStrong};
  }

  .brand-copy {
    margin-top: 7px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${preset.muted};
  }

  .folio-brand {
    padding-top: 6px;
    border-left: 1px solid ${preset.border};
  }

  .slab-brand {
    padding: 12px 10px;
    border-radius: 12px;
    background: ${preset.surface};
    border: 1px solid ${preset.border};
  }

  .paper-brand {
    padding: 12px 10px;
    border-radius: 999px;
    background: ${preset.surfaceAlt};
    border: 1px solid ${preset.border};
  }

  .section-shell {
    margin: 0 0 ${preset.sectionGap} 0;
    page-break-inside: avoid;
  }

  .section-shell:last-of-type {
    margin-bottom: 0;
  }

  .section-rule {
    padding: 16px 0 18px;
    border-top: 1px solid ${preset.border};
    border-bottom: 1px solid ${preset.border};
  }

  .section-panel {
    padding: 18px 18px 17px;
    background: ${preset.surface};
    border: 1px solid ${preset.border};
    border-left: 6px solid ${preset.accent};
    border-radius: ${preset.radius};
  }

  .section-soft {
    padding: 17px 18px 16px;
    background: ${preset.accentSoft};
    border: 1px solid ${preset.border};
    border-radius: ${preset.radius};
  }

  .section-airy {
    padding: 18px;
    background: ${preset.surface};
    border: 1px solid ${preset.border};
    border-radius: ${preset.radius};
  }

  .section-heading {
    margin: 0 0 12px 0;
    font-family: ${preset.headingFont};
    font-size: 17px;
    line-height: 1.15;
    color: ${preset.accentStrong};
    letter-spacing: 0.04em;
    text-transform: ${preset.headerVariant === 'slab' ? 'uppercase' : 'none'};
  }

  .lead-copy,
  .article-paragraph,
  .question-prompt,
  .role-copy,
  .answer-item,
  .prompt-line {
    margin: 0;
  }

  .lead-copy {
    line-height: 1.65;
  }

  .lead-copy + .bullet-list,
  .lead-copy + .chip-row,
  .bullet-list + .chip-row,
  .chip-row + .blank-list,
  .chip-row + .question-list,
  .reference-table,
  .matching-table,
  .role-grid {
    margin-top: 12px;
  }

  .article-kicker {
    margin-bottom: 12px;
    font-size: 11px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${preset.muted};
  }

  .article-frame {
    ${preset.headerVariant === 'folio' ? `column-count: 1;` : ''}
  }

  .article-paragraph {
    margin-bottom: 13px;
    line-height: 1.72;
  }

  .article-paragraph:last-child {
    margin-bottom: 0;
  }

  .dropcap {
    float: left;
    margin: 4px 7px 0 0;
    font-family: ${preset.displayFont};
    font-size: 42px;
    line-height: 0.8;
    color: ${preset.accent};
  }

  .bullet-list {
    margin: 10px 0 0 18px;
    padding: 0;
  }

  .bullet-list li {
    margin-bottom: 6px;
  }

  .bullet-list li:last-child,
  .match-pill:last-child,
  .prompt-line:last-child,
  .answer-item:last-child,
  .blank-list li:last-child,
  .question-item:last-child {
    margin-bottom: 0;
  }

  .chip-row {
    margin-top: 12px;
  }

  .chip {
    display: inline-block;
    margin: 0 7px 7px 0;
    padding: 4px 9px;
    border: 1px solid ${preset.border};
    border-radius: 999px;
    background: ${preset.surface};
    font-size: 11px;
    color: ${preset.accentStrong};
  }

  .question-list,
  .blank-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .question-item {
    display: table;
    width: 100%;
    margin-bottom: 16px;
  }

  .question-index,
  .question-body {
    display: table-cell;
    vertical-align: top;
  }

  .question-index {
    width: 34px;
    font-family: ${preset.displayFont};
    font-size: 18px;
    color: ${preset.accent};
  }

  .answer-line {
    height: 20px;
    border-bottom: 1px solid ${preset.border};
    margin-top: 8px;
  }

  .reference-table {
    width: 100%;
    border-collapse: collapse;
  }

  .reference-table tr:first-child td {
    border-top: 1px solid ${preset.border};
  }

  .reference-term,
  .reference-detail {
    padding: 11px 10px;
    border-bottom: 1px solid ${preset.border};
    vertical-align: top;
  }

  .reference-term {
    width: 28%;
    color: ${preset.accentStrong};
    font-weight: 700;
  }

  .reference-example {
    margin-top: 5px;
    color: ${preset.muted};
    font-style: italic;
  }

  .matching-table,
  .role-grid {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
  }

  .matching-col,
  .role-cell {
    width: 50%;
    vertical-align: top;
    padding-right: 8px;
  }

  .matching-col:last-child,
  .role-cell:last-child {
    padding-right: 0;
    padding-left: 8px;
  }

  .match-pill {
    margin-bottom: 10px;
    padding: 11px 12px;
    border-radius: ${preset.radius};
    line-height: 1.5;
  }

  .match-left {
    background: ${preset.accentSoft};
    border: 1px solid ${preset.border};
  }

  .match-right {
    background: ${preset.surface};
    border: 1px dashed ${preset.border};
  }

  .blank-list li {
    margin-bottom: 14px;
    line-height: 1.7;
  }

  .role-card {
    height: 100%;
    padding: 17px 16px 16px;
    border: 1px solid ${preset.border};
    border-radius: ${preset.radius};
  }

  .role-card-primary {
    background: ${preset.accentSoft};
  }

  .role-card-secondary {
    background: ${preset.surface};
  }

  .role-eyebrow {
    margin-bottom: 7px;
    font-size: 10px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: ${preset.muted};
  }

  .role-title {
    margin: 0 0 10px 0;
    font-family: ${preset.headingFont};
    font-size: 19px;
    color: ${preset.accentStrong};
  }

  .role-copy {
    margin-bottom: 10px;
    line-height: 1.6;
  }

  .role-copy strong {
    display: inline-block;
    margin-right: 4px;
    color: ${preset.accentStrong};
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 10px;
  }

  .prompt-box {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid ${preset.border};
  }

  .prompt-label {
    margin-bottom: 6px;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: ${preset.accent};
  }

  .prompt-line {
    margin-bottom: 5px;
  }

  .answer-key {
    page-break-before: always;
    padding: 18px 18px 16px;
    border: 1px solid ${preset.border};
    border-radius: ${preset.radius};
    background: ${preset.surface};
  }

  .answer-columns {
    column-count: 2;
    column-gap: 18px;
    margin-top: 10px;
  }

  .answer-item {
    break-inside: avoid;
    margin-bottom: 12px;
    line-height: 1.55;
  }

  .footer-note {
    margin-top: 16px;
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${preset.muted};
  }`;
}

export function renderMaterialHtml(material: TransformMaterial): string {
  const preset = resolvePreset(material.preset_id);

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>${buildCss(preset)}</style>
  </head>
  <body>
    <div class="doc">
      ${renderHeader(material, preset)}
      ${material.blocks.map((block) => renderBlock(block, preset)).join('')}
      ${buildAnswerKey(material)}
      <div class="footer-note">TeachInspire Studio • ${esc(material.material_type.replace(/_/g, ' '))} • ${esc(preset.label)}</div>
    </div>
  </body>
</html>`;
}
