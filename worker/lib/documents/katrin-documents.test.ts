// The documents the TeachInspire course really produces (Katrin Vogel case),
// as teachers export or copy them from Google Docs and Gemini. Every one of
// them must come out of Documents with its structure intact: tables as
// tables, nested lists nested, Docs artifacts gone, words untouched.

import { describe, expect, it } from "vitest";
import ficheCadre from "./fixtures/katrin/fiche-cadre-seance-3.md?raw";
import ficheCadreDrive from "./fixtures/katrin/fiche-cadre-seance-3-copie-drive.md?raw";
import brief from "./fixtures/katrin/brief-objectifs.md?raw";
import recap from "./fixtures/katrin/fiche-recapitulative.md?raw";
import worksheet from "./fixtures/katrin/fiche-apprenant-appel.md?raw";
import lessonPlan from "./fixtures/katrin/plan-de-cours-seance-3.md?raw";
import transcript from "./fixtures/katrin/transcription-chauffeur.md?raw";
import dialogue from "./fixtures/katrin/dialogue-appel.md?raw";
import { buildSimpleMaterial, parseSimpleStructure } from "./simple-structure";
import { normalizeTeacherSource } from "./markdown-lines";
import { referencedImageIds, renderSimpleMaterialHtml } from "./simple-material-renderer";
import type { DocumentType } from "./types";

function types(content: string, documentType?: DocumentType) {
  return parseSimpleStructure(normalizeTeacherSource(content), { documentType }).structure.map((block) => block.type);
}

function render(content: string, documentType: DocumentType, extra: Record<string, unknown> = {}) {
  const material = buildSimpleMaterial(content, { documentType, locale: "fr", ...extra });
  return { material, html: renderSimpleMaterialHtml(material) };
}

function count(html: string, needle: RegExp) {
  return html.match(needle)?.length ?? 0;
}

describe("Google Docs artifacts", () => {
  it("drops empty list items and stray bold markers, unescapes Markdown", () => {
    const cleaned = normalizeTeacherSource(ficheCadreDrive);
    expect(cleaned).not.toMatch(/^\s*-\s*$/m);
    expect(cleaned).not.toMatch(/^\s*\*\*\s*$/m);
    expect(cleaned).not.toContain("\\*");
    expect(cleaned).toContain("| **Phase** | **Support & Ressource** | **Activité pédagogique** |");
    expect(cleaned).toContain("(*Ce que Katrin sera capable de faire*)");
  });

  it("returns clean text byte-identical", () => {
    const clean = "Titre\n\nUn paragraphe propre.\n- un point\n- un autre";
    expect(normalizeTeacherSource(clean)).toBe(clean);
  });

  it("parses the downloaded and the copied version of the same doc the same way", () => {
    expect(types(ficheCadreDrive)).toEqual(types(ficheCadre));
  });
});

describe("fiche cadre de séance", () => {
  it("finds the title, the fields, nested objectives, criteria and the activity table", () => {
    expect(types(ficheCadre)).toEqual([
      "heading", "fields", "heading", "bullet_list", "heading", "paragraph", "numbered_list", "heading", "table",
    ]);
    const { material, html } = render(ficheCadre, "session_plan");
    expect(material.title).toBe("FICHE CADRE DE SÉANCE – SÉANCE 3");
    expect(html).toContain("Cadre de séance");
    expect(count(html, /<dt>/g)).toBe(3);
    expect(html).toMatch(/<li><strong>Objectifs langagiers &amp; pragmatiques :<\/strong><ul><li>Saluer/);
    expect(count(html, /<th>/g)).toBe(3);
    expect(count(html, /<tr>/g)).toBe(4);
    expect(html).not.toContain("📋");
    expect(html).not.toContain("|");
  });

  it("renumbers criteria once the empty Docs items are gone", () => {
    const { html } = render(ficheCadre, "session_plan");
    const criteria = html.slice(html.indexOf("<ol>"), html.indexOf("</ol>"));
    expect(count(criteria, /<li>/g)).toBe(3);
  });
});

describe("brief and learner profile", () => {
  it("puts the strapline under the title and the learner details in a field grid", () => {
    const { html } = render(brief, "course_brief");
    expect(html).toContain('<p class="subtitle">Document de travail – Base de discussion et d&#39;ajustement</p>');
    expect(html).toContain("<dt>Volume global</dt>");
    expect(html).toContain("Brief de formation");
  });

  it("keeps every word of the learner profile, in order", () => {
    const { material, html } = render(recap, "learner_profile");
    expect(material.title).toBe("FICHE RÉCAPITULATIVE APPRENANTE : KATRIN VOGEL");
    expect(types(recap).filter((type) => type === "heading")).toHaveLength(6);
    for (const phrase of ["Coordinatrice logistique", "Germanophone native", "Rédaction de courriels", "Nouveaux enjeux du 2e site"]) {
      expect(html).toContain(phrase);
    }
    expect(html.indexOf("Germanophone")).toBeLessThan(html.indexOf("Rédaction de courriels"));
  });
});

describe("student worksheet", () => {
  const { html } = render(worksheet, "worksheet");

  it("renders lettered options, a word bank, a callout, a rule, writing space and a checklist", () => {
    expect(html).toContain('<ol type="a" class="lettered">');
    expect(html).toContain('class="word-bank"');
    expect(count(html, /<li>ajuster<\/li>|<li>priorité<\/li>|<li>retard<\/li>/g)).toBe(3);
    expect(html).toContain('<aside class="callout">');
    expect(html).toContain("<hr />");
    expect(html).toContain('style="height:42mm"');
    expect(count(html, /class="box"/g)).toBeGreaterThanOrEqual(3);
  });

  it("gives true/false boxes, not writing lines, under true/false items", () => {
    expect(count(html, /class="true-false"/g)).toBe(3);
  });

  it("leaves no writing lines under gap-fill sentences, but adds them under open questions", () => {
    const gaps = html.slice(html.indexOf("Complétez"), html.indexOf("Questions de compréhension"));
    expect(gaps).not.toContain('class="answer-lines"');
    const questions = html.slice(html.indexOf("Questions de compréhension"), html.indexOf("<aside class=\"callout\">"));
    expect(count(questions, /class="answer-lines"/g)).toBe(2);
  });
});

describe("lesson plan, transcript, dialogue", () => {
  it("renders the stage table, a page break, and a boxed answer key", () => {
    const { html } = render(lessonPlan, "lesson_plan", { orientation: "landscape" });
    expect(count(html, /<th>/g)).toBe(5);
    expect(html).toContain('class="page-break"');
    expect(html).toContain('<div class="answer-key"><h2>Corrigé</h2>');
    expect(html).toContain("size: A4 landscape");
  });

  it("defaults a course calendar to landscape", () => {
    const { material } = render(lessonPlan, "course_calendar");
    expect(material.orientation).toBe("landscape");
  });

  it("reads a Studio transcript as timestamped turns", () => {
    expect(types(transcript)).toEqual(["heading", "subtitle", "transcript"]);
    const { html } = render(transcript, "dialogue_script");
    expect(count(html, /class="time"/g)).toBe(3);
    expect(html).toContain("Vidéo Chauffeur Routier #1");
  });

  it("reads repeated speakers as a dialogue with stage directions", () => {
    expect(types(dialogue)).toEqual(["heading", "dialogue"]);
    const { html } = render(dialogue, "dialogue_script");
    expect(count(html, /class="speaker"/g)).toBe(6);
    expect(html).toContain('<em class="stage">[essoufflé]</em>');
  });
});

describe("images and design", () => {
  const content = "Article du chauffeur\n\n![Le camion à Mâcon](studio:abc123XYZ)\n\nUn texte court sur le temps de conduite des chauffeurs routiers.";

  it("embeds an uploaded image and lists the ids the route must load", () => {
    const material = buildSimpleMaterial(content, { documentType: "reading" });
    expect(referencedImageIds(material)).toEqual(["abc123XYZ"]);
    const html = renderSimpleMaterialHtml(material, undefined, { images: { abc123XYZ: "data:image/png;base64,AAAA" } });
    expect(html).toContain('<img src="data:image/png;base64,AAAA" alt="Le camion à Mâcon" />');
    expect(html).toContain("<figcaption>Le camion à Mâcon</figcaption>");
  });

  it("shows a placeholder for a missing or external image instead of failing", () => {
    const material = buildSimpleMaterial(`${content}\n\n![Graphique](https://exemple.fr/kpi.png)`, { documentType: "reading", locale: "fr" });
    const html = renderSimpleMaterialHtml(material);
    expect(html).toContain("Image introuvable : Le camion à Mâcon");
    expect(html).toContain("Image non intégrée : Graphique");
  });

  it("applies the teacher's accent, fonts, header band, logo and footer without touching the text", () => {
    const material = buildSimpleMaterial(dialogue, { documentType: "dialogue_script" });
    const plain = renderSimpleMaterialHtml(material);
    material.design = {
      accent: "#2C5F7C",
      headingFont: "playfair",
      bodyFont: "inter",
      density: "airy",
      header: "band",
      logoImageId: "logo123456",
      footerText: "Kintail · Formation IA",
    };
    expect(referencedImageIds(material)).toContain("logo123456");
    const styled = renderSimpleMaterialHtml(material, undefined, { images: { logo123456: "data:image/png;base64,BBBB" } });
    expect(styled).toContain("#2C5F7C");
    expect(styled).toContain("'Playfair Display'");
    expect(styled).toContain("font-family: 'Playfair Display'");
    expect(styled).toContain('data-header="band"');
    expect(styled).toContain('class="header-logo"');
    expect(styled).toContain('<footer class="doc-footer">Kintail · Formation IA</footer>');
    const body = (html: string) => html.slice(html.indexOf("<main>")).replace(/<header[\s\S]*?<\/header>/, "").replace(/<footer[\s\S]*?<\/footer>/, "");
    expect(body(styled)).toBe(body(plain));
  });
});
