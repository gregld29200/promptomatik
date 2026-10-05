import { describe, expect, it } from "vitest";
import { htmlToMarkdown, isRichPaste, type PasteNode } from "./paste-to-markdown";

// A tiny element builder: enough DOM for the converter, no browser needed.
function el(name: string, attrs: Record<string, string> = {}, kids: Array<PasteNode | string> = []): PasteNode {
  const childNodes = kids.map((kid) => (typeof kid === "string" ? text(kid) : kid));
  return {
    nodeType: 1,
    nodeName: name.toUpperCase(),
    textContent: childNodes.map((child) => child.textContent ?? "").join(""),
    childNodes,
    getAttribute: (key) => attrs[key] ?? null,
  };
}

function text(value: string): PasteNode {
  return { nodeType: 3, nodeName: "#text", textContent: value, childNodes: [] };
}

const bold = (value: string) => el("span", { style: "font-weight:700" }, [value]);

describe("rich paste to Markdown", () => {
  it("converts a Google Docs copy: wrapper, headings, bold labels, aria-level nesting, table", () => {
    const docs = el("body", {}, [
      el("b", { id: "docs-internal-guid-1", style: "font-weight:normal;" }, [
        el("h1", {}, [bold("FICHE CADRE DE SÉANCE")]),
        el("p", {}, [bold("Apprenante :"), el("span", {}, [" Katrin Vogel"])]),
        el("ul", {}, [
          el("li", { "aria-level": "1" }, [el("p", {}, [bold("Objectifs langagiers :")])]),
          el("li", { "aria-level": "2" }, [el("p", {}, ["Saluer au téléphone."])]),
        ]),
        el("table", {}, [
          el("tbody", {}, [
            el("tr", {}, [el("td", {}, [el("p", {}, [bold("Phase")])]), el("td", {}, [el("p", {}, [bold("Activité")])])]),
            el("tr", {}, [el("td", {}, [el("p", {}, ["Écoute"])]), el("td", {}, [el("p", {}, ["Repérage | indices"])])]),
          ]),
        ]),
      ]),
    ]);
    expect(htmlToMarkdown(docs)).toBe([
      "# FICHE CADRE DE SÉANCE",
      "**Apprenante :** Katrin Vogel",
      "- **Objectifs langagiers :**\n  - Saluer au téléphone.",
      "| **Phase** | **Activité** |\n| --- | --- |\n| Écoute | Repérage / indices |",
    ].join("\n\n"));
  });

  it("numbers ordered lists, nests real sublists, keeps italics and quotes", () => {
    const gemini = el("div", {}, [
      el("h2", {}, ["Activité 2 — Vrai ou faux ?"]),
      el("ol", {}, [
        el("li", {}, ["Qui appelle ?", el("ul", {}, [el("li", {}, ["a) le chauffeur"])])]),
        el("li", {}, [el("em", {}, ["Katrin"]), " demande une date."]),
      ]),
      el("blockquote", {}, [el("p", {}, [el("strong", {}, ["Rappel :"]), " reformulez l'heure."])]),
      el("hr"),
    ]);
    expect(htmlToMarkdown(gemini)).toBe([
      "## Activité 2 — Vrai ou faux ?",
      "1. Qui appelle ?\n  - a) le chauffeur\n2. *Katrin* demande une date.",
      "> **Rappel :** reformulez l'heure.",
      "---",
    ].join("\n\n"));
  });

  it("only takes over pastes that carry structure", () => {
    expect(isRichPaste("<p>Un simple paragraphe.</p>")).toBe(false);
    expect(isRichPaste('<b style="font-weight:normal"><table><tr><td>a</td></tr></table></b>')).toBe(true);
    expect(isRichPaste('<span style="font-weight: 700">Titre</span>')).toBe(true);
  });
});
