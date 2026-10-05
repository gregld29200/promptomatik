// Rich paste → the Markdown subset Documents understands.
//
// When a teacher copies from Google Docs, Word or Gemini, the clipboard holds
// HTML: headings, bold runs, nested lists and tables. Pasted as plain text
// that structure is lost (tables become loose lines, bullets vanish). This
// converts the HTML into Markdown before it lands in the textarea, so the
// teacher sees exactly what Documents will lay out — and can still edit it.
//
// Works on a minimal DOM-like interface so it can be unit-tested without a
// browser; in the app it receives a real DOMParser document.

export interface PasteNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<PasteNode>;
  getAttribute?: (name: string) => string | null;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

function attr(node: PasteNode, name: string): string {
  return node.getAttribute?.(name) ?? "";
}

function children(node: PasteNode): PasteNode[] {
  return Array.from(node.childNodes);
}

function tag(node: PasteNode): string {
  return node.nodeName.toLowerCase();
}

function style(node: PasteNode): string {
  return attr(node, "style").toLowerCase().replace(/\s+/g, "");
}

function isBold(node: PasteNode): boolean {
  const css = style(node);
  if (/font-weight:(normal|400|300|lighter)/.test(css)) return false;
  if (tag(node) === "b" || tag(node) === "strong") return true;
  return /font-weight:(bold|bolder|[6-9]00)/.test(css);
}

function isItalic(node: PasteNode): boolean {
  if (tag(node) === "i" || tag(node) === "em") return !/font-style:normal/.test(style(node));
  return /font-style:italic/.test(style(node));
}

/** Wraps a run in markers, keeping its outer spaces outside them. */
function wrap(text: string, marker: string): string {
  const match = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match || !match[2]) return text;
  return `${match[1]}${marker}${match[2]}${marker}${match[3]}`;
}

function inline(node: PasteNode): string {
  if (node.nodeType === TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (node.nodeType !== ELEMENT_NODE) return "";
  const name = tag(node);
  if (name === "br") return "\n";
  if (name === "img" || name === "style" || name === "script") return "";
  const content = children(node).map(inline).join("");
  const bold = isBold(node);
  const italic = isItalic(node);
  if (bold && italic) return wrap(content, "***");
  if (bold) return wrap(content, "**");
  if (italic) return wrap(content, "*");
  return content;
}

function cleanInline(text: string): string {
  return text
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function tableRow(cells: string[]): string {
  return `| ${cells.map((cell) => cell.replace(/\|/g, "/").replace(/\n+/g, "<br>")).join(" | ")} |`;
}

function table(node: PasteNode): string {
  const rows: string[][] = [];
  const visit = (current: PasteNode) => {
    for (const child of children(current)) {
      if (child.nodeType !== ELEMENT_NODE) continue;
      if (tag(child) === "tr") {
        rows.push(children(child)
          .filter((cell) => cell.nodeType === ELEMENT_NODE && (tag(cell) === "td" || tag(cell) === "th"))
          .map((cell) => cleanInline(blockText(cell).join("\n"))));
      } else {
        visit(child);
      }
    }
  };
  visit(node);
  const filled = rows.filter((row) => row.some(Boolean));
  if (filled.length === 0) return "";
  const width = Math.max(...filled.map((row) => row.length));
  const padded = filled.map((row) => [...row, ...Array(width - row.length).fill("")]);
  return [tableRow(padded[0]), tableRow(Array(width).fill("---")), ...padded.slice(1).map(tableRow)].join("\n");
}

function list(node: PasteNode, depth: number): string[] {
  const ordered = tag(node) === "ol";
  const lines: string[] = [];
  let number = 0;
  for (const child of children(node)) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const name = tag(child);
    if (name === "ul" || name === "ol") {
      lines.push(...list(child, depth + 1));
      continue;
    }
    if (name !== "li") continue;
    number += 1;
    // Google Docs flattens nesting into aria-level on each <li>.
    const level = Number(attr(child, "aria-level")) || 0;
    const itemDepth = level > 0 ? level - 1 + depth : depth;
    const nested = children(child).filter((item) => item.nodeType === ELEMENT_NODE && (tag(item) === "ul" || tag(item) === "ol"));
    const own = children(child).filter((item) => !nested.includes(item));
    const text = cleanInline(own.map(inline).join(" "));
    if (text) lines.push(`${"  ".repeat(itemDepth)}${ordered ? `${number}.` : "-"} ${text.replace(/\n+/g, " ")}`);
    for (const sub of nested) lines.push(...list(sub, itemDepth + 1));
  }
  return lines;
}

const BLOCK_TAGS = new Set(["p", "div", "section", "article", "blockquote", "li", "td", "th", "body", "html", "main", "header", "footer"]);

/** Block-level Markdown for a node, as an array of blocks. */
function blockText(node: PasteNode): string[] {
  const blocks: string[] = [];
  let pending = "";
  const flush = () => {
    const text = cleanInline(pending);
    if (text) blocks.push(text);
    pending = "";
  };

  for (const child of children(node)) {
    if (child.nodeType === TEXT_NODE) {
      pending += inline(child);
      continue;
    }
    if (child.nodeType !== ELEMENT_NODE) continue;
    const name = tag(child);
    const heading = name.match(/^h([1-6])$/);
    if (heading) {
      flush();
      const text = cleanInline(inline(child)).replace(/^\*\*(.*)\*\*$/, "$1");
      if (text) blocks.push(`${"#".repeat(Number(heading[1]))} ${text}`);
    } else if (name === "ul" || name === "ol") {
      flush();
      const lines = list(child, 0);
      if (lines.length) blocks.push(lines.join("\n"));
    } else if (name === "table") {
      flush();
      const markdown = table(child);
      if (markdown) blocks.push(markdown);
    } else if (name === "hr") {
      flush();
      blocks.push("---");
    } else if (name === "blockquote") {
      flush();
      const inner = blockText(child).join("\n");
      if (inner) blocks.push(inner.split("\n").map((line) => `> ${line}`).join("\n"));
    } else if (BLOCK_TAGS.has(name) || containsBlock(child)) {
      flush();
      blocks.push(...blockText(child));
    } else {
      pending += inline(child);
    }
  }
  flush();
  return blocks;
}

function containsBlock(node: PasteNode): boolean {
  return children(node).some((child) => (
    child.nodeType === ELEMENT_NODE
    && (BLOCK_TAGS.has(tag(child)) || /^(h[1-6]|ul|ol|table|hr)$/.test(tag(child)) || containsBlock(child))
  ));
}

/** True when the clipboard HTML carries structure worth keeping. */
export function isRichPaste(html: string): boolean {
  return /<(table|ul|ol|h[1-6]|strong|b|em)\b|font-weight\s*:\s*(bold|[6-9]00)/i.test(html);
}

export function htmlToMarkdown(root: PasteNode): string {
  return blockText(root).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
