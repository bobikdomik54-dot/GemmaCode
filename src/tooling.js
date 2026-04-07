import path from "node:path";
import fs from "node:fs";
import { state } from "./state.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".gemma4code",
  "dist",
  "build",
  ".next",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
]);

function scanTree(dir, depth = 0, maxDepth = 2, limit = { count: 0, max: 120 }) {
  if (depth > maxDepth || limit.count >= limit.max) return [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }

  const lines = [];
  for (const entry of entries) {
    if (limit.count >= limit.max) break;
    if (SKIP_DIRS.has(entry.name)) continue;
    const indent = "  ".repeat(depth);
    if (entry.isDirectory()) {
      lines.push(`${indent}${entry.name}/`);
      limit.count += 1;
      lines.push(...scanTree(path.join(dir, entry.name), depth + 1, maxDepth, limit));
    } else {
      lines.push(`${indent}${entry.name}`);
      limit.count += 1;
    }
  }
  return lines;
}

export function buildProjectContext() {
  if (!state.projectDir) return null;
  const root = path.resolve(state.projectDir);
  const tree = scanTree(root).join("\n");

  let scripts = "";
  let deps = "";
  let packageName = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    packageName = pkg.name || "";
    if (pkg.scripts) {
      scripts = Object.entries(pkg.scripts)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
    }
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    deps = Object.keys(all).slice(0, 40).join(", ");
  } catch {
    // no package.json
  }

  return { root, packageName, tree, scripts, deps };
}

function formatRetrievalSection(title, items, formatItem) {
  if (!items || items.length === 0) return "";
  return [
    `${title}:`,
    ...items.map((item, index) => formatItem(item, index)),
  ].join("\n");
}

export function buildRetrievalContext(codeHits = [], memoryHits = []) {
  const codeSection = formatRetrievalSection("Relevant code", codeHits, (hit, index) => {
    const score = Number.isFinite(hit.score) ? hit.score.toFixed(3) : "0.000";
    return [
      `${index + 1}. ${hit.path}:${hit.startLine || 1}-${hit.endLine || hit.startLine || 1} score=${score}`,
      (hit.excerpt || hit.text || "").replace(/\n/g, "\n   "),
    ].join("\n   ");
  });

  const memorySection = formatRetrievalSection("Relevant memory", memoryHits, (hit, index) => {
    const score = Number.isFinite(hit.score) ? hit.score.toFixed(3) : "0.000";
    return [
      `${index + 1}. ${hit.createdAt || "memory"} score=${score}`,
      (hit.text || "").replace(/\n/g, "\n   "),
    ].join("\n   ");
  });

  return [codeSection, memorySection].filter(Boolean).join("\n\n");
}

export function buildSystemPrompt({ deepMode = false, projectContext = null, retrievalContext = "" } = {}) {
  const lines = [
    "You are Gemma4Code, a local coding agent.",
    "Use LangChain tool calling only.",
    "Do not invent XML, JSON wrappers, pseudo-code, or phrases like 'Calling tool now'.",
    "TOOL-FIRST POLICY: if the answer depends on code inspection or code changes, call a tool first.",
    "Do not write analysis before a tool call.",
    "Before tool use, output no text. If the provider requires content, use at most 6 words.",
    "After tool results, either call another tool or give the final answer.",
    "Be concise, practical, and exact.",
    "Do not explain chain-of-thought.",
    "Tool selection rules:",
    "- search_code: first choice for locating relevant files, symbols, duplicate logic, or likely bug locations.",
    "- read_files: use only after search_code or when the exact file is already known. Read the smallest useful range.",
    "- list_dir: use only if you do not know the file path or need structure discovery.",
    "- apply_patch: use only for editing existing files. Prefer start_line/end_line/replacement for block replacement or replacements/find/replace for exact text replacement.",
    "- create_file: use only to create a new file or fully overwrite a file when explicitly needed.",
    "- web_search: use only for external documentation or current information, never for local code diagnosis.",
    "Tool input rules:",
    "- search_code args: query is required; optional limit and scope.",
    "- read_files args: use path for one file or paths for many; optional range like '20-80' or start_line/end_line.",
    "- apply_patch args: always include path or file. For line-block replacement use start_line, end_line, replacement. For exact text replacement use replacements.",
    "Tool output rules:",
    "- Treat tool output as ground truth for the next step.",
    "- If a tool returns ERROR, do not repeat the same broken call. Adjust arguments.",
    "Forbidden behavior:",
    "- Do not describe what you plan to inspect before calling a tool.",
    "- Do not produce long explanatory prose during tool loops.",
    "- Do not ask for the full file if a narrow search or range read is enough.",
    deepMode
      ? "Mode: DEEP. Prioritize correctness, verification, and edge cases."
      : "Mode: FAST. Minimize tokens and inspect only what is necessary.",
  ];

  if (projectContext) {
    lines.push("");
    lines.push(`Project root: ${projectContext.root}`);
    if (projectContext.packageName) lines.push(`Package: ${projectContext.packageName}`);
    if (projectContext.scripts) {
      lines.push("Scripts:");
      lines.push(projectContext.scripts);
    }
    if (projectContext.deps) lines.push(`Dependencies: ${projectContext.deps}`);
    if (projectContext.tree) {
      lines.push("Tree:");
      lines.push(projectContext.tree);
    }
  }

  if (retrievalContext) {
    lines.push("");
    lines.push(retrievalContext);
  }

  return lines.join("\n");
}
