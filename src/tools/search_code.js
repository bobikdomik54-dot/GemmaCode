import { z } from "zod";
import { state } from "../state.js";
import { searchProject, searchMemories } from "../vector_store.js";

export const SYMBOL = "🔎";
export const NAME = "search_code";
export const DESCRIPTION = "Search project code and recent memory with RAG. Use this before reading files.";
export const SCHEMA = z.object({
  query: z.string().min(1).describe("Search query"),
  limit: z.number().int().min(1).max(20).default(8).describe("Maximum number of hits"),
  scope: z.enum(["code", "memory", "both"]).default("both").describe("What to search"),
});

function formatHit(hit, index) {
  const lineRange = hit.startLine && hit.endLine ? `${hit.startLine}-${hit.endLine}` : "";
  const score = Number.isFinite(hit.score) ? hit.score.toFixed(3) : "0.000";
  return [
    `#${index + 1} score=${score} ${hit.path || "memory"}${lineRange ? `:${lineRange}` : ""}`,
    hit.excerpt || hit.text || "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function run(args) {
  const query = String(args.query || "").trim();
  if (!query) return "ERROR: query is required.";

  const limit = Number.isInteger(args.limit) ? args.limit : 8;
  const scope = args.scope || "both";

  const projectDir = state.projectDir;
  if (!projectDir) {
    return "ERROR: No project directory set. Use /dir <path> first.";
  }

  const sections = [];
  if (scope === "code" || scope === "both") {
    const codeHits = await searchProject(projectDir, query, limit);
    sections.push(`=== code hits (${codeHits.length}) ===`);
    for (const [index, hit] of codeHits.entries()) {
      sections.push(formatHit(hit, index));
    }
  }

  if (scope === "memory" || scope === "both") {
    const memoryHits = await searchMemories(projectDir, query, Math.max(1, Math.min(4, limit)));
    sections.push(`=== memory hits (${memoryHits.length}) ===`);
    for (const [index, hit] of memoryHits.entries()) {
      sections.push(
        [
          `#${index + 1} score=${Number.isFinite(hit.score) ? hit.score.toFixed(3) : "0.000"}`,
          hit.text,
        ].join("\n")
      );
    }
  }

  return sections.join("\n\n") || "No hits found.";
}
