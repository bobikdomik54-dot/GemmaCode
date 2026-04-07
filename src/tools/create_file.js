import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { resolveProjectPath } from "../project_path.js";

export const SYMBOL = "✏️";
export const NAME = "create_file";
export const DESCRIPTION = "Create a new file with code or content. Use this when user asks for code files, scripts, or any content that should be saved. Supports paths like '/script.py' or '/backend/script.py'. Use overwrite: true to replace existing files.";
export const SCHEMA = z.object({
  path: z.string().describe("Relative path for the new file"),
  content: z.string().describe("Full content to write into the file"),
  overwrite: z.boolean().optional().describe("Set to true to overwrite existing files (default: false)"),
});

export async function run(args) {
  const { path: relPath, content, overwrite = false } = args;
  if (!relPath) return "ERROR: no path specified.";

  try {
    const normalizedPath = relPath.startsWith("/") ? relPath.slice(1) : relPath;
    const abs = resolveProjectPath(normalizedPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });

    const existed = fs.existsSync(abs);
    if (existed && !overwrite) {
      return `ERROR: File already exists: ${normalizedPath}. Use overwrite: true to replace it or apply_patch to modify it.`;
    }

    fs.writeFileSync(abs, content || "", "utf8");
    const action = existed ? "overwritten" : "created";
    return `File ${action}: ${normalizedPath}`;
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}
