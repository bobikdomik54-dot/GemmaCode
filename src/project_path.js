import path from "node:path";
import { state } from "./state.js";

export function resolveProjectPath(relPath) {
  if (!state.projectDir) {
    throw new Error("No project directory set. Use /dir <path> first.");
  }

  const projectRoot = path.resolve(state.projectDir);
  const normalized = relPath.startsWith("/") ? relPath.slice(1) : relPath;
  const resolved = path.resolve(projectRoot, normalized);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Path "${relPath}" escapes the project directory.`);
  }
  return resolved;
}
