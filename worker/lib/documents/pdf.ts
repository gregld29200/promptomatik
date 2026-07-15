import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../../env";

interface PdfRenderOptions {
  title: string;
  pageNumbers?: boolean | "multiple-only";
}

function withDocumentTitle(html: string, title: string): string {
  if (/<title>[\s\S]*<\/title>/i.test(html)) return html;
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return html.replace(/<head>/i, `<head><title>${safeTitle}</title>`);
}

export async function renderMaterialPdf(
  env: Env,
  html: string,
  options: PdfRenderOptions,
): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(withDocumentTitle(html, options.title), { waitUntil: "networkidle0" });
    let showPageNumbers = options.pageNumbers === true;
    if (options.pageNumbers === "multiple-only") {
      await page.emulateMediaType("print");
      const contentHeight = await page.evaluate(() => {
        const doc = (globalThis as unknown as {
          document: {
            querySelector(selector: string): { scrollHeight: number } | null;
            body: { scrollHeight: number };
          };
        }).document;
        const main = doc.querySelector("main");
        return Math.max(main?.scrollHeight ?? 0, doc.body.scrollHeight);
      });
      // A4 has roughly 990 CSS pixels of printable height after the handout
      // templates' vertical margins. Keep one-page sheets completely quiet.
      showPageNumbers = contentHeight > 990;
    }
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: showPageNumbers,
      headerTemplate: "<div></div>",
      footerTemplate: showPageNumbers
        ? `<div style="width:100%;padding:0 19mm;font:8px Arial,sans-serif;color:#6c7483;text-align:right;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`
        : "<div></div>",
    });
  } finally {
    await browser.close();
  }
}
