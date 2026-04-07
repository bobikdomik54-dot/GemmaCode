import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { execSync } from "node:child_process";
import { resolveProjectPath } from "../project_path.js";

export const SYMBOL = "🔧";
export const NAME = "apply_patch";
export const DESCRIPTION =
  "Edit an existing file precisely. Prefer replacements or minimal line edits after reading the file.";

export const SCHEMA = z.object({
  path: z.string().optional().describe("Relative path of the file to patch"),
  file: z.string().optional().describe("Alias for path"),
  target: z.string().optional().describe("Alias for path"),
  start_line: z.number().int().min(1).optional(),
  end_line: z.number().int().min(1).optional(),
  replacement: z.string().optional(),
  edits: z
    .array(
      z.object({
        line: z.number().int().min(1),
        end: z.number().int().min(1).optional(),
        content: z.string(),
      })
    )
    .optional(),
  replacements: z
    .array(
      z.object({
        find: z.string(),
        replace: z.string(),
        all: z.boolean().optional(),
      })
    )
    .optional(),
  append: z.string().optional(),
});

function checkPythonSyntax(absPath) {
  try {
    execSync(`python -c "import ast; ast.parse(open(r'${absPath}').read())"`, {
      timeout: 5000,
      stdio: "pipe",
    });
    return null;
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    const match = stderr.match(/line (\d+)/);
    return { error: stderr.trim().slice(0, 300), line: match ? parseInt(match[1]) : null };
  }
}

function checkJsSyntax(absPath) {
  try {
    execSync(`node --check "${absPath}"`, { timeout: 5000, stdio: "pipe" });
    return null;
  } catch (e) {
    const stderr = e.stderr?.toString() || e.message;
    const match = stderr.match(/:(\d+)/);
    return { error: stderr.trim().slice(0, 300), line: match ? parseInt(match[1]) : null };
  }
}

function syntaxCheck(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  if (ext === ".py") return checkPythonSyntax(absPath);
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx"].includes(ext)) return checkJsSyntax(absPath);
  return null;
}

function parseRange(range) {
  if (!range) return null;
  const m = String(range).match(/(\d+)\s*-\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2])];
  const single = parseInt(range);
  if (!Number.isNaN(single)) return [single, single];
  return null;
}

function summarizeRanges(nums) {
  if (nums.length === 0) return "";
  const sorted = [...new Set(nums)].sort((a, b) => a - b);
  const parts = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      parts.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  parts.push(start === end ? `${start}` : `${start}-${end}`);
  return parts.join(", ");
}

function buildResult(normalizedPath, finalLines, editInfo, syntaxResult) {
  const out = [
    `OK ${normalizedPath} (${editInfo})`,
    `Lines: ${finalLines.length}`,
  ];

  if (syntaxResult) {
    out.push(`SYNTAX_ERROR: ${syntaxResult.error}`);
    if (syntaxResult.line) {
      const errLine = syntaxResult.line;
      const ctxStart = Math.max(1, errLine - 3);
      const ctxEnd = Math.min(finalLines.length, errLine + 3);
      const ctx = finalLines
        .slice(ctxStart - 1, ctxEnd)
        .map((line, idx) => `${ctxStart + idx}: ${line}`)
        .join("\n");
      out.push(`ERROR_CONTEXT ${errLine}:\n${ctx}`);
    }
  } else {
    out.push("SYNTAX_OK");
  }

  return out.join("\n");
}

export async function run(args) {
  const relPath = args.path || args.file || args.target;
  if (!relPath) return "ERROR: no path specified.";

  try {
    const normalizedPath = relPath.startsWith("/") ? relPath.slice(1) : relPath;
    const abs = resolveProjectPath(normalizedPath);
    if (!fs.existsSync(abs)) return `ERROR: File not found: ${normalizedPath}`;

    const original = fs.readFileSync(abs, "utf8");
    let content = original;
    const editLineNumbers = [];
    let replacementCount = 0;

    if (
      typeof args.replacement === "string" &&
      Number.isInteger(args.start_line) &&
      Number.isInteger(args.end_line)
    ) {
      const lines = content.split("\n");
      const start = args.start_line;
      const end = args.end_line;
      if (start < 1 || start > lines.length + 1) {
        return `ERROR: Line ${start} out of range (file has ${lines.length} lines).`;
      }
      if (end < start) {
        return `ERROR: end_line must be >= start_line.`;
      }
      const startIdx = start - 1;
      const deleteCount = Math.max(0, Math.min(lines.length, end) - startIdx);
      const next = args.replacement === "" ? [] : args.replacement.split("\n");
      lines.splice(startIdx, deleteCount, ...next);
      content = lines.join("\n");
      editLineNumbers.push(start, end);
    }

    if (Array.isArray(args.replacements) && args.replacements.length > 0) {
      for (const item of args.replacements) {
        if (!item?.find) continue;
        const before = content;
        if (item.all) {
          content = content.split(item.find).join(item.replace ?? "");
        } else {
          content = content.replace(item.find, item.replace ?? "");
        }
        if (content !== before) replacementCount += 1;
      }
    }

    if (Array.isArray(args.edits) && args.edits.length > 0) {
      const lines = content.split("\n");
      const sorted = [...args.edits].sort((a, b) => b.line - a.line);
      for (const edit of sorted) {
        const start = edit.line;
        const end = edit.end ?? edit.line;
        if (start < 1 || start > lines.length + 1) {
          return `ERROR: Line ${start} out of range (file has ${lines.length} lines).`;
        }
        const startIdx = start - 1;
        const endIdx = Math.min(lines.length, end) - 1;
        const next = edit.content === "" ? [] : edit.content.split("\n");
        lines.splice(startIdx, Math.max(0, endIdx - startIdx + 1), ...next);
        editLineNumbers.push(start, end);
      }
      content = lines.join("\n");
    }

    if (typeof args.append === "string" && args.append.length > 0) {
      content = content.endsWith("\n") ? `${content}${args.append}` : `${content}\n${args.append}`;
      editLineNumbers.push(content.split("\n").length);
    }

    if (content === original) {
      return "ERROR: No edits applied.";
    }

    fs.writeFileSync(abs, content, "utf8");
    const finalLines = fs.readFileSync(abs, "utf8").split("\n");
    const syntaxResult = syntaxCheck(abs);
    const editInfo = replacementCount > 0 && editLineNumbers.length === 0
      ? `${replacementCount} replacements`
      : summarizeRanges(editLineNumbers) || `${replacementCount} replacements`;
    return buildResult(normalizedPath, finalLines, editInfo, syntaxResult);
  } catch (e) {
    return `ERROR: ${e.message}`;
  }
}
