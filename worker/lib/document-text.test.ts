import { describe, expect, it } from "vitest";
import type { DocumentMaterial } from "../../src/lib/api";
import { materialToPlainText } from "../../src/lib/document-text";
import { materialUrl, parseEmphasisTerms } from "../../src/lib/document-presentation";

const BASE_MATERIAL: DocumentMaterial = {
  id: "material-1",
  preset_id: "studio_academic",
  material_type: "clean_handout",
  title: "Remote Work",
  blocks: [],
};

describe("document plain-text serialization", () => {
  it("copies a simple handout without duplicating its title", () => {
    const text = materialToPlainText({
      ...BASE_MATERIAL,
      blocks: [
        {
          type: "article",
          title: "Remote Work",
          paragraphs: ["Paragraph one.", "Paragraph two."],
        },
        {
          type: "reference_list",
          heading: "Word bank",
          items: [
            { term: "hybrid", detail: "Combining two approaches.", example: "A hybrid schedule." },
          ],
        },
      ],
    });

    expect(text).toBe([
      "Remote Work",
      "Paragraph one.\nParagraph two.",
      "Word bank\nhybrid: Combining two approaches.\n   Example: A hybrid schedule.",
    ].join("\n\n"));
  });

  it("copies the immutable source of a simple handout without formatting markers", () => {
    const text = materialToPlainText({
      ...BASE_MATERIAL,
      source_text: "Remote Work\n\nTrack **lead times** carefully.\n\n- Check quality\n- Review claims",
      bold_phrases: ["lead times"],
      blocks: [],
    });

    expect(text).toBe("Remote Work\n\nTrack lead times carefully.\n\n- Check quality\n- Review claims");
    expect(text).not.toContain("**");
  });

  it("renders activity blocks as readable plain text", () => {
    const text = materialToPlainText({
      ...BASE_MATERIAL,
      material_type: "controlled_practice",
      skill_focus: "reading",
      interaction_pattern: "individual",
      estimated_minutes: 10,
      blocks: [
        {
          type: "instructions",
          text: "Complete the tasks.",
          bullets: ["Work alone first."],
          word_bank: ["remote", "hybrid"],
        },
        {
          type: "questions",
          heading: "Questions",
          items: [{ prompt: "Where does Sam work?", answer: "At home." }],
        },
        {
          type: "fill_blanks",
          items: [{ sentence: "Sam works ____.", answer: "remotely" }],
        },
        {
          type: "matching",
          pairs: [{ left: "remote", right: "away from the office" }],
        },
        {
          type: "role_cards",
          cards: [{ role: "Manager", situation: "A team meeting", goal: "Agree a schedule", prompts: ["Ask about Fridays."] }],
        },
      ],
    });

    expect(text).toContain("Complete the tasks.\n- Work alone first.\nWord bank: remote, hybrid");
    expect(text).toContain("Questions\n1. Where does Sam work?\n   Answer: At home.");
    expect(text).toContain("1. Sam works ____.\n   Answer: remotely");
    expect(text).toContain("remote — away from the office");
    expect(text).toContain("Manager\nSituation: A team meeting\nGoal: Agree a schedule\n- Ask about Fridays.");
  });
});

describe("simple document presentation controls", () => {
  it("parses teacher-selected vocabulary from comma and line separated input", () => {
    expect(parseEmphasisTerms("lead times, SLA\nwarranty claims, sla")).toEqual([
      "lead times",
      "SLA",
      "warranty claims",
    ]);
  });

  it("adds a presentation-only template query to preview and PDF URLs", () => {
    expect(materialUrl("job 1", 0, "html", "classroom_handout")).toBe(
      "/api/documents/jobs/job%201/materials/0.html?template=classroom_handout",
    );
  });
});
