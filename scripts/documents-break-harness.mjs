// Documents D3 — mechanical page-break harness.
//
// Renders representative teaching materials with the SAME engine as
// production (renderMaterialHtml), prints each to PDF with local headless
// Chrome (same Chromium family as Cloudflare Browser Rendering), and
// mechanically measures every PDF for the three failure modes the D3 plan
// targets:
//
//   1. End-of-page whitespace  — a non-final page left more than 22% empty,
//      unless it deliberately precedes the Answer Key (a forced break).
//   2. Orphan heading          — a section heading is the last thing on a page.
//   3. Split atomic item       — a question / matching pill / gap-fill item /
//      reference row / role card broken across a page boundary, detected via
//      invisible Bmk<n>…Emk<n> sentinels emitted in harness marker mode.
//
// Run: npm run docs:breaks
// Exit code is non-zero if any fixture has a violation.
//
// Notes:
//  - Uses the local Google Chrome binary (macOS path) and poppler
//    (pdftotext -bbox, pdfinfo), both expected to be installed.
//  - The usable content band is derived empirically from the rendered PDF
//    (min/max text y across all pages) rather than assumed page margins, so
//    the measurement is correct regardless of how Chrome's CLI applies @page.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderMaterialHtml } from '../worker/lib/documents/material-renderer.ts';

const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VOID_THRESHOLD = 0.22; // fraction of usable band a non-final page may leave empty

// ---------------------------------------------------------------------------
// Fixtures — built in-line, long enough to force 2-3 pages each and to stress
// every atomic block type. Every fixture with questions/matching/fill_blanks
// also emits an Answer Key on a forced page, exercising the void exemption.
// ---------------------------------------------------------------------------

const LONG_PARAS = [
  'Remote work has transformed how language trainers organise their weeks, their energy, and their sense of professional boundary. Where a decade ago a freelance trainer might have taught six learners in a single town, the same trainer today can open a laptop and move between a business-English executive in Frankfurt, an exam candidate in Casablanca, and a conversational-French retiree in Lisbon, all before lunch. The map has been redrawn, and with it the daily rhythm of the job.',
  'The flexibility is genuine, but so is the fatigue that comes from being permanently reachable. A calendar that can be filled from any time zone tends, unless defended, to be filled from every time zone. Trainers describe the peculiar exhaustion of days that never quite start and never quite end, punctuated by messages that arrive at midnight and expect an answer by breakfast.',
  'Those who thrive tend to treat their calendar as a contract with themselves rather than a suggestion open to negotiation. They protect fixed preparation blocks the way they protect paid lessons, and they batch administrative work into deliberate windows instead of letting it leak across the day in a thin, distracting film.',
  'Preparation, in particular, rewards protection. A lesson designed in a focused ninety-minute block is almost always sharper than the same lesson assembled in six interrupted fragments. The trainers who report the highest satisfaction are rarely those who work the most hours; they are those whose hours are least fragmented.',
  'Community matters too. Isolation is the quiet occupational hazard of remote teaching, and the trainers who last tend to build deliberate contact with peers: a weekly call, a shared resource folder, a channel where a difficult learner can be discussed without breaching confidence. The work is solitary by default and collegial only by design.',
  'None of this is automatic. The infrastructure of a sustainable remote practice — the protected blocks, the batched admin, the peer contact, the firm boundary around the working day — has to be built and rebuilt, because the gravitational pull of an always-open calendar is constant. The trainers who flourish are not the ones with the most discipline in the abstract; they are the ones who have designed their week so that less discipline is required.',
  'This closing paragraph exists mainly to give the article enough length that it must flow naturally across at least one page boundary, so the harness can confirm that orphan and widow control keeps the prose readable rather than leaving a single stranded line at the foot or head of a page.',
];

function questionItems(count) {
  const prompts = [
    'According to the text, what has changed most for language trainers since remote work became common?',
    'Which three learner profiles does the opening paragraph describe, and where is each located?',
    'Explain in your own words what the author means by treating a calendar as a contract with yourself.',
    'Find a word in the second paragraph that is a close synonym of exhaustion.',
    'Why, according to the article, do successful trainers batch their administrative work?',
    'What does the text claim about the relationship between fragmented hours and satisfaction?',
    'Identify the occupational hazard the author associates with remote teaching, and the remedy proposed.',
    'Is the author’s overall tone optimistic, critical, or balanced? Justify your answer with evidence.',
    'Rewrite the final sentence of the article in a single, simpler sentence for a lower level.',
    'What would you add to the author’s list of strategies for a sustainable remote practice? Explain why.',
    'Summarise the whole article in exactly two sentences.',
    'Suggest an alternative title for this article and explain the idea it captures.',
  ];
  return Array.from({ length: count }, (_, i) => ({
    prompt: prompts[i % prompts.length],
    answer: `Model answer ${i + 1}: a concise, level-appropriate response the teacher can accept as correct.`,
  }));
}

function matchingPairs(count) {
  const left = ['batch', 'reachable', 'boundary', 'fragment', 'protect', 'isolation', 'collegial', 'sustainable', 'deliberate', 'rhythm', 'gravitational', 'infrastructure'];
  const right = ['group similar tasks together', 'able to be contacted at any time', 'a firm limit around working time', 'a small interrupted piece', 'to defend from encroachment', 'the state of working alone', 'cooperative and peer-supported', 'able to continue without harm', 'done on purpose, not by accident', 'a regular repeating pattern', 'a constant invisible pull', 'the underlying supporting structure'];
  return Array.from({ length: count }, (_, i) => ({ left: left[i % left.length], right: right[i % right.length] }));
}

function referenceItems(count) {
  const terms = ['batch', 'reachable', 'boundary', 'fragmented', 'to protect', 'isolation', 'collegial', 'sustainable', 'deliberate', 'rhythm', 'to leak', 'stranded', 'occupational', 'to flourish', 'discipline', 'infrastructure'];
  return Array.from({ length: count }, (_, i) => ({
    term: terms[i % terms.length],
    detail: `Definition ${i + 1}: a clear learner-facing paraphrase of the expression as it is used in the reading text above.`,
    example: i % 2 === 0 ? `Example ${i + 1}: a full sentence showing the expression in a natural teaching context.` : undefined,
  }));
}

function fillItems(count) {
  const sentences = [
    'Trainers who _____ their admin work save several hours a week.',
    'Being permanently _____ is one of the hidden costs of remote teaching.',
    'A calendar should be a _____ with yourself, not a suggestion.',
    'Fixed preparation _____ protect the quality of every lesson.',
    'The flexibility is real, but so is the _____ it can create.',
    'Successful trainers _____ their calendars as fiercely as their lessons.',
    'Switching between subjects all day causes mental _____.',
    'He blocked two hours for lesson _____ every single morning.',
    'The quiet hazard of remote teaching is professional _____.',
    'The work is solitary by default and _____ only by design.',
    'A lesson built in one focused _____ is sharper than one built in fragments.',
    'The pull of an always-open calendar is effectively _____.',
  ];
  return Array.from({ length: count }, (_, i) => ({
    sentence: sentences[i % sentences.length],
    answer: `answer${i + 1}`,
  }));
}

const ROLE_CARDS = [
  {
    role: 'The overbooked trainer',
    situation: 'You teach thirty-two hours a week across four time zones and your evenings have quietly disappeared into admin and messages.',
    goal: 'Negotiate two protected mornings with your training manager without reducing your monthly income.',
    bullets: [
      'Open by acknowledging that demand is high and that you value the work.',
      'Present two concrete arguments linking protected time to lesson quality.',
      'Propose a specific weekly schedule rather than a vague request for less work.',
    ],
    prompts: [
      'Would it be possible to look at how my mornings are structured?',
      'I have noticed that lesson quality drops when preparation is fragmented.',
      'Could we trial a fixed arrangement for one month and review it together?',
    ],
  },
  {
    role: 'The training manager',
    situation: 'Client demand is at a record high, two trainers resigned last month, and delivery capacity is already stretched thin across the team.',
    goal: 'Keep this valued trainer motivated and retained without losing scheduled delivery or approving a pay rise.',
    bullets: [
      'Listen first and acknowledge the pressure the trainer describes.',
      'Explore schedule changes and non-financial forms of recognition.',
      'Counter-propose an arrangement you can actually sustain this quarter.',
    ],
    prompts: [
      'I completely understand, and I want to keep you happy here.',
      'A pay rise is not possible this quarter, but let us look at your schedule.',
      'What would a realistic protected block look like from your side?',
    ],
  },
];

function fixtureMaterial(id, presetId, materialType, title, skillFocus, interaction, minutes, blocks) {
  return {
    id,
    preset_id: presetId,
    material_type: materialType,
    title,
    skill_focus: skillFocus,
    interaction_pattern: interaction,
    estimated_minutes: minutes,
    blocks,
  };
}

const FIXTURES = [
  {
    name: 'quiz_long_studio',
    material: fixtureMaterial(
      'fx-quiz', 'studio_academic', 'comprehension_quiz',
      'Remote Work and the Modern Language Trainer', 'reading', 'individual', 45,
      [
        { type: 'instructions', heading: 'Before you read', text: 'Read the article once for gist, then a second time answering the questions below in full sentences.', bullets: ['Underline any word you cannot infer from context.', 'Do not use a dictionary on the first reading.'] },
        { type: 'article', heading: 'Reading', title: 'The redrawn map of teaching', paragraphs: LONG_PARAS },
        { type: 'questions', heading: 'Comprehension', items: questionItems(10) },
      ],
    ),
  },
  {
    name: 'matching_reference_modern',
    material: fixtureMaterial(
      'fx-match', 'modern_training', 'matching_exercise',
      'Vocabulary in Context: Remote Teaching', 'vocabulary', 'pairs', 30,
      [
        { type: 'instructions', heading: 'Task', text: 'Match each expression on the left with its closest meaning on the right, then check your answers against the reference list.' },
        { type: 'matching', heading: 'Matching', pairs: matchingPairs(12) },
        { type: 'reference_list', heading: 'Glossary', items: referenceItems(10) },
      ],
    ),
  },
  {
    name: 'roleplay_mixed_warm',
    material: fixtureMaterial(
      'fx-role', 'warm_coaching', 'role_play_cards',
      'Negotiating Protected Time: A Role Play', 'speaking', 'pairs', 40,
      [
        { type: 'instructions', heading: 'Set up', text: 'Work in pairs. Read your card silently, prepare for two minutes, then run the conversation twice, swapping roles.' },
        { type: 'article', heading: 'Context', title: 'Why this matters', paragraphs: LONG_PARAS.slice(0, 4) },
        { type: 'role_cards', heading: 'Your roles', cards: ROLE_CARDS },
        { type: 'questions', heading: 'Debrief', items: questionItems(5) },
      ],
    ),
  },
  {
    name: 'gapfill_bank_studio',
    material: fixtureMaterial(
      'fx-gap', 'studio_academic', 'gap_fill',
      'Gap Fill: Sustainable Remote Practice', 'grammar', 'individual', 25,
      [
        { type: 'instructions', heading: 'Instructions', text: 'Complete each sentence with the best word from the bank. Each word is used exactly once.', word_bank: ['batch', 'reachable', 'contract', 'blocks', 'fatigue', 'protect', 'exhaustion', 'preparation', 'isolation', 'collegial', 'session', 'constant'] },
        { type: 'fill_blanks', heading: 'Sentences', word_bank: ['batch', 'reachable', 'contract', 'blocks', 'fatigue', 'protect'], items: fillItems(12) },
        { type: 'questions', heading: 'Follow up', items: questionItems(6) },
      ],
    ),
  },
  {
    name: 'mixed_blocks_modern',
    material: fixtureMaterial(
      'fx-mixed', 'modern_training', 'vocabulary_in_context',
      'Full Lesson Pack: Remote Teaching', 'mixed', 'group', 60,
      [
        { type: 'article', heading: 'Reading', title: 'The redrawn map', paragraphs: LONG_PARAS.slice(0, 6) },
        { type: 'questions', heading: 'Comprehension', items: questionItems(6) },
        { type: 'matching', heading: 'Vocabulary', pairs: matchingPairs(8) },
        { type: 'fill_blanks', heading: 'Gap fill', items: fillItems(6) },
        { type: 'reference_list', heading: 'Glossary', items: referenceItems(6) },
        { type: 'role_cards', heading: 'Role play', cards: ROLE_CARDS },
      ],
    ),
  },
  {
    name: 'reference_heavy_warm',
    material: fixtureMaterial(
      'fx-ref', 'warm_coaching', 'phrase_bank_extraction',
      'Phrase Bank: The Language of Boundaries', 'vocabulary', 'individual', 35,
      [
        { type: 'instructions', heading: 'How to use this', text: 'Study the phrase bank below, then answer the questions to check that you can use each expression accurately.' },
        { type: 'reference_list', heading: 'Phrase bank', items: referenceItems(16) },
        { type: 'questions', heading: 'Check yourself', items: questionItems(8) },
      ],
    ),
  },
];

// ---------------------------------------------------------------------------
// Rendering + measurement
// ---------------------------------------------------------------------------

function renderPdf(html, dir, name) {
  const htmlPath = join(dir, `${name}.html`);
  const pdfPath = join(dir, `${name}.pdf`);
  writeFileSync(htmlPath, html, 'utf8');
  execFileSync(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-pdf-header-footer',
      '--virtual-time-budget=8000',
      `--print-to-pdf=${pdfPath}`,
      `file://${htmlPath}`,
    ],
    { stdio: 'ignore' },
  );
  return pdfPath;
}

const WORD_RE = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
const PAGE_RE = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parsePages(pdfPath) {
  const xml = execFileSync('pdftotext', ['-bbox', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const pages = [];
  let pageMatch;
  PAGE_RE.lastIndex = 0;
  while ((pageMatch = PAGE_RE.exec(xml))) {
    const [, w, h, inner] = pageMatch;
    const words = [];
    let wordMatch;
    WORD_RE.lastIndex = 0;
    while ((wordMatch = WORD_RE.exec(inner))) {
      words.push({
        xMin: parseFloat(wordMatch[1]),
        yMin: parseFloat(wordMatch[2]),
        xMax: parseFloat(wordMatch[3]),
        yMax: parseFloat(wordMatch[4]),
        text: decodeEntities(wordMatch[5]).trim(),
      });
    }
    pages.push({ width: parseFloat(w), height: parseFloat(h), words });
  }
  return pages;
}

function analyze(fixture, pages) {
  const violations = [];
  const nonEmpty = pages.filter((p) => p.words.length > 0);
  if (nonEmpty.length === 0) {
    return { pageCount: pages.length, rows: [], violations: [{ type: 'empty', detail: 'no extractable text' }] };
  }

  // Empirical usable band across the whole document.
  let contentTop = Infinity;
  let contentBottom = -Infinity;
  for (const p of nonEmpty) {
    for (const wd of p.words) {
      if (wd.yMin < contentTop) contentTop = wd.yMin;
      if (wd.yMax > contentBottom) contentBottom = wd.yMax;
    }
  }
  const band = contentBottom - contentTop || 1;

  const pageText = pages.map((p) => p.words.map((wd) => wd.text).join(' '));
  // Case-insensitive: some presets uppercase headings via CSS text-transform,
  // so the Answer Key heading may extract as "ANSWER KEY".
  const answerKeyPage = pageText.findIndex((t) => t.toLowerCase().includes('answer key'));

  // Known headings (single-line, from the fixture) + document title.
  const headings = new Set();
  headings.add(normalize(fixture.material.title));
  for (const block of fixture.material.blocks) {
    if (block.heading) headings.add(normalize(block.heading));
  }
  headings.add('answer key');

  // Atomic-item geometry from the Bmk<n>…Emk<n> sentinels: which page each
  // end sits on, and the item's top/bottom y so we can measure its height.
  const beginPage = new Map();
  const endPage = new Map();
  const items = new Map(); // n -> { bPage, bTop, ePage, eBot }
  pages.forEach((p, i) => {
    for (const wd of p.words) {
      const b = wd.text.match(/^Bmk(\d+)$/);
      if (b) {
        beginPage.set(b[1], i);
        items.set(b[1], { ...(items.get(b[1]) ?? {}), bPage: i, bTop: wd.yMin });
      }
      const e = wd.text.match(/^Emk(\d+)$/);
      if (e) {
        endPage.set(e[1], i);
        items.set(e[1], { ...(items.get(e[1]) ?? {}), ePage: i, eBot: wd.yMax });
      }
    }
  });

  // Height (pt) of the first atomic unit that begins-and-ends on a given page,
  // i.e. the block that opens that page's flow. Used to tell an avoidable void
  // (small content could have filled it) from an unavoidable one (the next
  // page opens with a single atomic block too tall to have fit in the gap —
  // e.g. a full-height role-play card, kept whole on purpose).
  const HEADING_ALLOWANCE = 55; // a section heading glued to its block (break-after: avoid)
  function firstAtomicHeight(pageIndex) {
    let best = null;
    for (const it of items.values()) {
      if (it.bPage === pageIndex && it.ePage === pageIndex && it.eBot > it.bTop) {
        if (!best || it.bTop < best.bTop) best = it;
      }
    }
    return best ? best.eBot - best.bTop : 0;
  }

  const rows = [];
  pages.forEach((p, i) => {
    const isFinal = i === pages.length - 1;
    const maxY = p.words.length ? Math.max(...p.words.map((wd) => wd.yMax)) : contentTop;
    const voidFrac = (contentBottom - maxY) / band;

    // Bottom line = words whose yMax is within 4pt of the page's deepest text.
    const bottomWords = p.words
      .filter((wd) => maxY - wd.yMax < 4)
      .sort((a, b) => a.xMin - b.xMin);
    const bottomLine = normalize(
      bottomWords.map((wd) => wd.text).filter((t) => !/^[BE]mk\d+$/.test(t)).join(' '),
    );

    let exemptVoid = isFinal || (answerKeyPage > 0 && i === answerKeyPage - 1);
    let exemptReason = isFinal ? 'final' : exemptVoid ? 'pre-answer-key' : '';

    // Unavoidable void: the next page opens with a single atomic block taller
    // than the gap (plus a glued heading) — it could never have been pulled up.
    if (!exemptVoid && voidFrac > VOID_THRESHOLD && i + 1 < pages.length) {
      const voidPx = contentBottom - maxY;
      const nextHeight = firstAtomicHeight(i + 1);
      if (nextHeight > 0 && nextHeight + HEADING_ALLOWANCE > voidPx) {
        exemptVoid = true;
        exemptReason = 'oversized-atomic';
      }
    }

    let flag = '';
    if (!exemptVoid && voidFrac > VOID_THRESHOLD) {
      violations.push({ type: 'void', page: i + 1, detail: `${(voidFrac * 100).toFixed(1)}% empty` });
      flag += 'VOID ';
    }
    if (!isFinal && bottomLine && headings.has(bottomLine)) {
      violations.push({ type: 'orphan-heading', page: i + 1, detail: `"${bottomLine}"` });
      flag += 'ORPHAN ';
    }

    rows.push({
      page: i + 1,
      voidPct: (voidFrac * 100).toFixed(1),
      exempt: exemptReason,
      bottom: bottomLine.slice(0, 40),
      flag: flag.trim(),
    });
  });

  // Split-item check: a marker pair whose begin/end land on different pages.
  for (const [n, bp] of beginPage) {
    const ep = endPage.get(n);
    if (ep !== undefined && ep !== bp) {
      violations.push({ type: 'split-item', detail: `item ${n} spans pages ${bp + 1}→${ep + 1}` });
    }
  }

  return { pageCount: pages.length, rows, violations };
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const dir = mkdtempSync(join(tmpdir(), 'docbreaks-'));
  console.log(`Documents break harness — artifacts in ${dir}\n`);

  let totalViolations = 0;
  for (const fixture of FIXTURES) {
    const html = renderMaterialHtml(fixture.material, { markers: true });
    const pdfPath = renderPdf(html, dir, fixture.name);
    const pages = parsePages(pdfPath);
    const { pageCount, rows, violations } = analyze(fixture, pages);

    console.log(`▸ ${fixture.name}  (${fixture.material.preset_id}, ${pageCount} pages)`);
    for (const r of rows) {
      const exempt = r.exempt ? ` [exempt: ${r.exempt}]` : '';
      const flag = r.flag ? `  ⚠ ${r.flag}` : '';
      console.log(
        `    p${r.page}: void ${r.voidPct.padStart(5)}%${exempt}  · ends: "${r.bottom}"${flag}`,
      );
    }
    if (violations.length) {
      totalViolations += violations.length;
      for (const v of violations) {
        console.log(`    ✗ ${v.type}${v.page ? ` (p${v.page})` : ''}: ${v.detail}`);
      }
    } else {
      console.log('    ✓ no violations');
    }
    console.log('');
  }

  if (totalViolations > 0) {
    console.log(`FAIL — ${totalViolations} violation(s) across ${FIXTURES.length} fixtures.`);
    process.exit(1);
  }
  console.log(`PASS — 0 violations across ${FIXTURES.length} fixtures.`);
}

main();
