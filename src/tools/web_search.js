import { fetchPageText } from "../brave.js";
import ora from "ora";
import { z } from "zod";

export const SYMBOL = "🔎";
export const NAME = "web_search";
export const DESCRIPTION = "Search the web with Brave. Default mode returns snippets only; page fetch is optional.";
export const SCHEMA = z.object({
  query: z.string().describe("Search query string"),
  fetch_pages: z.boolean().optional().default(false).describe("Fetch page content after search results"),
});

export async function run(args) {
  const query = args.query || "";
  const fetchPages = Boolean(args.fetch_pages);
  const braveKey = process.env.BRAVE_API_KEY;

  if (!braveKey) {
    return "BRAVE_API_KEY is not set in .env - cannot perform web search.";
  }

  const spinner = ora({ text: `${SYMBOL} Searching: ${query}`, color: "yellow" }).start();

  let results = [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const resp = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": braveKey,
      },
    });
    const data = await resp.json();
    results = (data.web?.results || []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description || "",
    }));
  } catch (e) {
    spinner.fail("Search API failed.");
    return `Search failed: ${e.message}`;
  }

  if (!fetchPages) {
    spinner.succeed(`Web search complete (${results.length} results)`);
    return (
      results
        .map((r, index) => `#${index + 1}\n${r.title}\n${r.url}\n${r.snippet}`)
        .join("\n\n---\n\n") || "No results found."
    );
  }

  spinner.text = `Fetching ${results.length} pages...`;

  const pageTexts = await Promise.allSettled(
    results.map(async (r) => {
      const content = await fetchPageText(r.url);
      return `### ${r.title}\nURL: ${r.url}\n\n${content}`;
    })
  );

  spinner.succeed(`Web search complete (${results.length} pages)`);

  const combined = pageTexts
    .map((p) => (p.status === "fulfilled" ? p.value : "(fetch error)"))
    .join("\n\n---\n\n");

  return combined || "No results found.";
}
