import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveProjectPath } from "../project_path.js";

export const SYMBOL = "📃";
export const NAME = "list_dir";
export const DESCRIPTION = "List files and subdirectories in a project folder. Tree only, no file previews.";
export const SCHEMA = z.object({
  path: z.string().default(".").describe("Relative path of the directory to list (default: project root)"),
  depth: z.number().int().min(0).max(6).default(2).describe("How many levels deep to recurse (default: 2)"),
  max_entries: z.number().int().min(1).max(500).default(200).describe("Maximum number of entries to return"),
});

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function scanDir(dirAbs, depth = 0, maxDepth = 2, limit = { count: 0, max: 200 }) {
  const lines = [];
  if (limit.count >= limit.max) return lines;

  let entries;
  try {
    entries = fs.readdirSync(dirAbs, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    return [`${"  ".repeat(depth + 1)}ERROR: ${error.message}`];
  }

  for (const entry of entries) {
    if (limit.count >= limit.max) break;
    const indent = "  ".repeat(depth + 1);
    const entryAbs = path.join(dirAbs, entry.name);

    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      limit.count += 1;
      if (depth < maxDepth) {
        lines.push(...scanDir(entryAbs, depth + 1, maxDepth, limit));
      }
      continue;
    }

    let size = 0;
    try {
      size = fs.statSync(entryAbs).size;
    } catch {
      size = 0;
    }

    lines.push(`${indent}${entry.name} (${formatSize(size)})`);
    limit.count += 1;
  }

  return lines;
}

export async function run(args) {
  const relPath = args.path || ".";
  const depth = Number.isInteger(args.depth) ? args.depth : 2;
  const maxEntries = Number.isInteger(args.max_entries) ? args.max_entries : 200;

  let dirAbs;
  try {
    dirAbs = resolveProjectPath(relPath);
  } catch (error) {
    return `ERROR: ${error.message}`;
  }

  if (!fs.existsSync(dirAbs) || !fs.statSync(dirAbs).isDirectory()) {
    return `ERROR: Not a directory: ${relPath}`;
  }

  const lines = [`Directory: ${relPath}`, ...scanDir(dirAbs, 0, depth, { count: 0, max: maxEntries })];
  if (lines.length - 1 >= maxEntries) {
    lines.push(`... output truncated at ${maxEntries} entries`);
  }

  return lines.join("\n");
}
