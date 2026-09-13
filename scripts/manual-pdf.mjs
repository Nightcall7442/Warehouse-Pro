/**
 * docs/manual/manual.<lang>.html → docs/manual/Warehouse-Pro-Manual.<lang>.pdf
 * Печатает Chromium (Playwright): A4, фон, колонтитул с номером страницы.
 *
 * node scripts/manual-pdf.mjs            — оба языка
 * node scripts/manual-pdf.mjs ru         — один
 */
import { chromium } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const langs = process.argv[2] ? [process.argv[2]] : ["ru", "uz"];
const dir = resolve("docs/manual");
const browser = await chromium.launch();
try {
  for (const lang of langs) {
    const src = resolve(dir, `manual.${lang}.html`);
    if (!existsSync(src)) { console.log(`нет ${src}`); continue; }
    const page = await browser.newPage();
    await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const out = resolve(dir, `Warehouse-Pro-Manual.${lang}.pdf`);
    const title = lang === "uz" ? "Warehouse Pro — distribyutor qo'llanmasi" : "Warehouse Pro — руководство дистрибьютора";
    await page.pdf({
      path: out, format: "A4", printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%;font-family:'Segoe UI',sans-serif;font-size:8px;color:#6b665c;padding:0 16mm;display:flex;justify-content:space-between"><span>${title}</span><span class="pageNumber"></span></div>`,
      margin: { top: "18mm", right: "16mm", bottom: "20mm", left: "16mm" },
    });
    console.log(out);
    await page.close();
  }
} finally {
  await browser.close();
}
