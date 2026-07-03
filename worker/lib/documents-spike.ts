// D0 spike (Documents module): prove that native Chromium print CSS gives
// perfect page breaks on a representative teaching document, via the
// Browser Rendering binding. Admin-only endpoint, removed once D3 ships
// the real renderer. The fixture stresses every break scenario: a long
// article (must break INSIDE, with orphan control), atomic items
// (question+answer, matching rows, fill-blank items, role cards) that
// must NEVER split, and headings that must never end a page.
//
// Marker scheme for mechanical verification: every atomic unit starts
// with «Bn» and ends with «En» (rendered in tiny light grey). pdftotext
// per page must find both markers of a unit on the same page.

import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../env";

// v1 of the house print stylesheet - the deliverable under test.
const PRINT_CSS = `
  @page {
    size: A4;
    margin: 16mm 18mm 18mm;
  }

  * { box-sizing: border-box; }

  body {
    font-family: "DM Sans", "Helvetica Neue", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1c2b3a;
    margin: 0;
  }

  h1, h2, h3 {
    font-family: Georgia, "Times New Roman", serif;
    color: #132038;
    break-after: avoid;
  }

  h1 { font-size: 20pt; margin: 0 0 4pt; }
  h2 { font-size: 14pt; margin: 14pt 0 6pt; }

  p {
    margin: 0 0 8pt;
    orphans: 3;
    widows: 3;
  }

  .doc-meta {
    font-size: 9pt;
    color: #5a6b7a;
    margin-bottom: 12pt;
  }

  /* Atomic units: never split across pages. */
  .atomic { break-inside: avoid; }

  .qa-item {
    padding: 6pt 0;
    border-bottom: 0.5pt solid #d8dee5;
  }
  .qa-item .answer-line {
    margin-top: 6pt;
    border-bottom: 1pt dotted #8fa1b0;
    height: 14pt;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
  }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  th, td {
    border: 0.5pt solid #b9c4cd;
    padding: 5pt 7pt;
    text-align: left;
    font-size: 10.5pt;
  }
  th { background: #eef1f4; }

  .role-card {
    border: 1pt solid #b9c4cd;
    border-radius: 6pt;
    padding: 10pt 12pt;
    margin: 8pt 0;
  }

  .word-bank {
    display: flex;
    flex-wrap: wrap;
    gap: 6pt;
    padding: 8pt;
    background: #eef1f4;
    border-radius: 4pt;
    margin-bottom: 8pt;
  }
  .word-bank span {
    border: 0.5pt solid #8fa1b0;
    border-radius: 3pt;
    padding: 1pt 6pt;
    font-size: 10pt;
  }

  .marker {
    font-size: 6pt;
    color: #c3ccd4;
  }
`;

function q(index: number, prompt: string): string {
  return `
    <div class="qa-item atomic">
      <span class="marker">«B${index}»</span>
      <p><strong>${index}.</strong> ${prompt}</p>
      <div class="answer-line"></div>
      <span class="marker">«E${index}»</span>
    </div>`;
}

function fixtureHtml(): string {
  const paragraphs = Array.from({ length: 7 }, (_, i) => `
    <p>Paragraph ${i + 1}. Remote work has transformed how language trainers organise their weeks.
    Some now teach learners across three time zones before lunch, switching between business English,
    exam preparation, and conversational French. The flexibility is real, but so is the fatigue that
    comes from being permanently reachable. Trainers who thrive tend to protect fixed preparation
    blocks, batch their admin work, and treat their calendar as a contract with themselves rather
    than a suggestion. This paragraph exists to be long enough that the article must flow across
    page boundaries naturally, proving that orphan and widow control works as designed.</p>`).join("");

  const questions = [
    "According to the article, what has changed most for language trainers since remote work became common?",
    "Which three types of lessons does the text mention?",
    "What does the author mean by treating a calendar as a contract?",
    "Find a synonym of 'exhaustion' in paragraph two.",
    "Why do successful trainers batch their administrative work?",
    "What time management strategy is described as protecting preparation?",
    "Is the author's overall tone positive, negative, or balanced? Justify.",
    "Rewrite the last sentence of paragraph three in your own words.",
    "What would you add to the author's list of strategies? Explain.",
    "Summarise the article in exactly two sentences.",
    "Which sentence best expresses the main idea of the text?",
    "Invent a title for this article that is not the original one.",
  ].map((prompt, i) => q(i + 1, prompt)).join("");

  const matching = Array.from({ length: 8 }, (_, i) => `
    <tr>
      <td><span class="marker">«B${20 + i}»</span>Term ${i + 1} — expression from the text</td>
      <td>Definition ${i + 1} — a plausible paraphrase a learner must match<span class="marker">«E${20 + i}»</span></td>
    </tr>`).join("");

  const fills = [
    "Trainers who ____ their admin work save several hours a week.",
    "Being permanently ____ is one of the hidden costs of remote work.",
    "She teaches learners ____ three time zones before lunch.",
    "A calendar should be a ____ with yourself.",
    "Fixed preparation ____ protect the quality of lessons.",
    "The flexibility is real, but ____ is the fatigue.",
    "Exam ____ requires a different rhythm from conversation classes.",
    "Successful trainers ____ their calendars fiercely.",
    "Switching between subjects causes mental ____.",
    "He blocked two hours for lesson ____ every morning.",
  ].map((sentence, i) => `
    <div class="qa-item atomic">
      <span class="marker">«B${40 + i}»</span>
      <p><strong>${i + 1}.</strong> ${sentence}</p>
      <span class="marker">«E${40 + i}»</span>
    </div>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>${PRINT_CSS}</style>
</head>
<body>
  <h1>Remote Work and the Modern Language Trainer</h1>
  <p class="doc-meta">B2 · Reading comprehension · 45 min · TeachInspire Documents — D0 spike fixture</p>

  <h2>Reading text</h2>
  ${paragraphs}

  <h2>Comprehension questions</h2>
  ${questions}

  <h2>Vocabulary matching</h2>
  <table>
    <thead><tr><th>Expression</th><th>Definition</th></tr></thead>
    <tbody>${matching}</tbody>
  </table>

  <h2>Gap fill</h2>
  <div class="word-bank atomic"><span class="marker">«B60»</span>
    <span>batch</span><span>reachable</span><span>across</span><span>contract</span><span>blocks</span>
    <span>so</span><span>preparation</span><span>protect</span><span>fatigue</span><span>planning</span>
  <span class="marker">«E60»</span></div>
  ${fills}

  <h2>Role play</h2>
  <div class="role-card atomic">
    <span class="marker">«B70»</span>
    <p><strong>Card A — The overbooked trainer.</strong> You teach 32 hours a week across time zones.
    Your goal: negotiate two protected mornings with your training manager without reducing income.
    Open the conversation, present two arguments, and propose a concrete schedule.</p>
    <span class="marker">«E70»</span>
  </div>
  <div class="role-card atomic">
    <span class="marker">«B71»</span>
    <p><strong>Card B — The training manager.</strong> Client demand is at a record high and two
    trainers just resigned. Your goal: keep this trainer motivated without losing delivery capacity.
    Listen, acknowledge, and counter-propose. You may offer schedule changes but not a pay rise.</p>
    <span class="marker">«E71»</span>
  </div>
</body>
</html>`;
}

export async function renderSpikePdf(env: Env): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(fixtureHtml(), { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "a4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `
        <div style="width:100%; font-size:8pt; color:#8fa1b0; text-align:center; font-family: Arial, sans-serif;">
          TeachInspire — page <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>`,
      margin: { top: "16mm", right: "18mm", bottom: "18mm", left: "18mm" },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser.close();
  }
}
