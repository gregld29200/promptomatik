import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../../env";

interface PdfRenderOptions {
  title: string;
  pageNumbers?: boolean;
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
    return await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: options.pageNumbers ?? false,
      headerTemplate: "<div></div>",
      footerTemplate: options.pageNumbers
        ? `<div style="width:100%;padding:0 19mm;font:8px Arial,sans-serif;color:#6c7483;text-align:right;">
            <span class="pageNumber"></span> / <span class="totalPages"></span>
          </div>`
        : "<div></div>",
    });
  } finally {
    await browser.close();
  }
}
