import { chromium } from "playwright";
import { parse as parseHtml } from "node-html-parser";

export async function fetchPageText(url) {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { timeout: 15000, waitUntil: "domcontentloaded" });
    const html = await page.content();
    const root = parseHtml(html);
    root.querySelectorAll("script,style,noscript,nav,footer,header,aside").forEach((el) => el.remove());
    const text = root.innerText
      .replace(/\n{3,}/g, "\n\n")
      .replace(/ {2,}/g, " ")
      .trim()
      .slice(0, 6000);
    return text || "(no readable content)";
  } catch (e) {
    return `(failed to load: ${e.message})`;
  } finally {
    if (browser) await browser.close();
  }
}
