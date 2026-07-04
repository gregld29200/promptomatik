import puppeteer from "@cloudflare/puppeteer";
import type { Env } from "../../env";

export async function renderMaterialPdf(env: Env, html: string): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    return await page.pdf({
      format: "A4",
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}
