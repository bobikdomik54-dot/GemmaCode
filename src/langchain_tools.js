import { tool } from "langchain";

import * as readFiles from "./tools/read_files.js";
import * as createFile from "./tools/create_file.js";
import * as applyPatch from "./tools/apply_patch.js";
import * as listDir from "./tools/list_dir.js";
import * as webSearch from "./tools/web_search.js";
import * as searchCode from "./tools/search_code.js";

const TOOL_MODULES = [readFiles, createFile, applyPatch, listDir, webSearch, searchCode];
const TOOL_MAP = Object.fromEntries(TOOL_MODULES.map((module) => [module.NAME, module]));

function buildLangChainDescription(module) {
  switch (module.NAME) {
    case "search_code":
      return `${module.DESCRIPTION} Use this first for local code diagnosis. Input: query required, optional limit and scope. Do not read files before this unless the exact file is already known.`;
    case "read_files":
      return `${module.DESCRIPTION} Input: path for one file or paths for multiple files. Optional range '20-80' or start_line/end_line. Read the smallest useful range only.`;
    case "apply_patch":
      return `${module.DESCRIPTION} Input: path or file required. For block edits prefer start_line + end_line + replacement. For exact text replacement use replacements[{find,replace,all?}]. Do not call without a target file.`;
    case "create_file":
      return `${module.DESCRIPTION} Input: path required, content required, optional overwrite. Use only for new files or full overwrite.`;
    case "list_dir":
      return `${module.DESCRIPTION} Use only when file locations are unknown. Input: path optional, depth optional, max_entries optional.`;
    case "web_search":
      return `${module.DESCRIPTION} Use only for external docs or current information. Never use for local code diagnosis.`;
    default:
      return module.DESCRIPTION;
  }
}

function normalizeArgs(name, args) {
  if (!args || typeof args !== "object") return {};

  if (name === "read_files" && !args.paths && args.path) {
    return { ...args, paths: [args.path] };
  }

  if (name === "apply_patch") {
    const normalizedPath = args.path || args.file || args.target;
    const replacements = Array.isArray(args.replacements)
      ? args.replacements
      : Array.isArray(args.replacement)
        ? args.replacement
        : undefined;
    const edits = Array.isArray(args.edits)
      ? args.edits.map((edit) => ({
          line: edit.line ?? edit.start_line ?? edit.start ?? edit.from,
          end: edit.end ?? edit.end_line ?? edit.to,
          content: edit.content ?? edit.text ?? edit.replace ?? "",
        }))
      : undefined;

    return {
      ...args,
      path: normalizedPath,
      replacements,
      edits,
      start_line: args.start_line,
      end_line: args.end_line,
      replacement: typeof args.replacement === "string" ? args.replacement : undefined,
      append: args.append ?? args.content_to_append,
    };
  }

  return args;
}

async function executeToolModule(name, input) {
  const module = TOOL_MAP[name];
  if (!module) return `ERROR: Unknown tool "${name}"`;

  const normalizedInput = normalizeArgs(name, input);
  if (module.SCHEMA?.safeParse) {
    const parsed = module.SCHEMA.safeParse(normalizedInput);
    if (!parsed.success) {
      return `ERROR: Invalid args for ${name}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`;
    }
    return String(await module.run(parsed.data));
  }

  return String(await module.run(normalizedInput));
}

export const LANGCHAIN_TOOLS = TOOL_MODULES.map((module) =>
  tool(
    async (input) => executeToolModule(module.NAME, input),
    {
      name: module.NAME,
      description: buildLangChainDescription(module),
      schema: module.SCHEMA,
    }
  )
);

export const TOOL_NAME_SET = new Set(TOOL_MODULES.map((module) => module.NAME));
