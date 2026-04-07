import fs from "node:fs";
import { z } from "zod";
import { resolveProjectPath } from "../project_path.js";

export const SYMBOL = "📂";
export const NAME = "read_files";
export const DESCRIPTION = "Read one or more project files by relative path. Prefer narrow ranges instead of full files.";
export const SCHEMA = z.object({
  path: z.string().optional().describe("Single relative file path to read (alternative to paths)"),
  paths: z.array(z.string()).optional().describe("Relative file paths to read (relative to project dir)"),
  range: z.string().optional().describe("Line range like 20-80"),
  start_line: z.number().int().min(1).optional().describe("First line to include, 1-based"),
  end_line: z.number().int().min(1).optional().describe("Last line to include, 1-based"),
  context_lines: z.number().int().min(0).max(50).optional().describe("Extra lines around the requested range"),
});

export async function run(args) {
  const paths = Array.isArray(args.paths)
    ? args.paths
    : [args.path || args.paths].filter(Boolean);
  if (paths.length === 0) return "No paths specified.";

  let startLine = Number.isInteger(args.start_line) ? args.start_line : null;
  let endLine = Number.isInteger(args.end_line) ? args.end_line : null;
  if ((!startLine || !endLine) && typeof args.range === "string") {
    const match = args.range.match(/(\d+)\s*-\s*(\d+)/);
    if (match) {
      startLine = parseInt(match[1], 10);
      endLine = parseInt(match[2], 10);
    }
  }
  const contextLines = Number.isInteger(args.context_lines) ? args.context_lines : 0;

  const results = [];
  for (const relPath of paths) {
    try {
      const normalizedPath = relPath.startsWith("/") ? relPath.slice(1) : relPath;
      const abs = resolveProjectPath(normalizedPath);
      const content = fs.readFileSync(abs, "utf8");
      const lines = content.split("\n");

      const from = startLine ? Math.max(1, startLine - contextLines) : 1;
      const to = endLine ? Math.min(lines.length, endLine + contextLines) : Math.min(lines.length, 220);
      const slice = lines.slice(from - 1, to);
      const numbered = slice.map((l, i) => `${from + i}: ${l}`).join("\n");

      let result = `=== ${normalizedPath} (${lines.length} lines) ===\n${numbered}`;
      if (to < lines.length) {
        result += `\n\n... (${lines.length - to} more lines not shown)`;
      }
      results.push(result);
    } catch (e) {
      results.push(`=== ${relPath} ===\nERROR: ${e.message}`);
    }
  }
  return results.join("\n\n");
}
