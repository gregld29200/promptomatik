// Serializes a generated document material to clean plain text so teachers
// can paste it into Word/Docs and own it. No markdown, no markup.

import type { DocumentBlock, DocumentMaterial } from "./api";

function sameText(left: string, right: string): boolean {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "base" }) === 0;
}

function blockToText(block: DocumentBlock, materialTitle: string): string {
  const lines: string[] = [];
  if (block.heading) lines.push(block.heading);

  switch (block.type) {
    case "article":
      // The renderer commonly repeats the material title in the first article
      // block. Avoid carrying that duplication into copied text.
      if (block.title && !sameText(block.title, materialTitle)) lines.push(block.title);
      for (const paragraph of block.paragraphs ?? []) lines.push(paragraph);
      break;
    case "instructions":
    case "notes":
      if (block.text) lines.push(block.text);
      for (const bullet of block.bullets ?? []) lines.push(`- ${bullet}`);
      if (block.word_bank?.length) lines.push(`Word bank: ${block.word_bank.join(", ")}`);
      break;
    case "questions":
      (block.items ?? []).forEach((item, index) => {
        if (item.prompt) lines.push(`${index + 1}. ${item.prompt}`);
        if (item.answer) lines.push(`   Answer: ${item.answer}`);
      });
      break;
    case "reference_list":
      for (const item of block.items ?? []) {
        if (!item.term) continue;
        lines.push(`${item.term}: ${item.detail ?? ""}`.trim());
        if (item.example) lines.push(`   Example: ${item.example}`);
      }
      break;
    case "matching":
      for (const pair of block.pairs ?? []) lines.push(`${pair.left} — ${pair.right}`);
      break;
    case "fill_blanks":
      if (block.word_bank?.length) lines.push(`Word bank: ${block.word_bank.join(", ")}`);
      (block.items ?? []).forEach((item, index) => {
        if (item.sentence) lines.push(`${index + 1}. ${item.sentence}`);
        if (item.answer) lines.push(`   Answer: ${item.answer}`);
      });
      break;
    case "role_cards":
      for (const card of block.cards ?? []) {
        lines.push(card.role);
        lines.push(`Situation: ${card.situation}`);
        lines.push(`Goal: ${card.goal}`);
        for (const bullet of card.bullets ?? []) lines.push(`- ${bullet}`);
        for (const prompt of card.prompts ?? []) lines.push(`- ${prompt}`);
        lines.push("");
      }
      break;
    default:
      if (block.text) lines.push(block.text);
      for (const paragraph of block.paragraphs ?? []) lines.push(paragraph);
      break;
  }

  return lines.join("\n").trim();
}

export function materialToPlainText(material: DocumentMaterial): string {
  const sections = (material.blocks ?? [])
    .map((block) => blockToText(block, material.title))
    .filter(Boolean);
  return [material.title, ...sections].filter(Boolean).join("\n\n").trim();
}
