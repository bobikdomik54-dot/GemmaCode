import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { APP_HOME, DEFAULT_BASE_URL } from "./state.js";

export const VECTOR_STORE_FILE = path.join(APP_HOME, "rag-index.json");
const INDEX_VERSION = 1;
const VECTOR_DIM = 256;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".gemma4code",
  "dist",
  "build",
  ".next",
  ".turbo",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
]);

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".py",
  ".toml",
  ".env",
]);

function ensureStoreDir() {
  fs.mkdirSync(APP_HOME, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

function createEmptyStore() {
  return {
    version: INDEX_VERSION,
    updatedAt: null,
    projectRoot: null,
    files: {},
    memories: [],
  };
}

export function loadVectorStore() {
  ensureStoreDir();
  const store = safeReadJson(VECTOR_STORE_FILE, null);
  if (!store || store.version !== INDEX_VERSION) {
    return createEmptyStore();
  }
  if (!store.files || typeof store.files !== "object") store.files = {};
  if (!Array.isArray(store.memories)) store.memories = [];
  return store;
}

export function saveVectorStore(store) {
  ensureStoreDir();
  store.updatedAt = new Date().toISOString();
  atomicWriteJson(VECTOR_STORE_FILE, store);
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  if (path.basename(filePath) === "Dockerfile") return true;
  if (path.basename(filePath).startsWith(".")) return false;
  return false;
}

function hashText(text) {
  return crypto.createHash("sha1").update(text).digest("hex");
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9а-яіїє_./:-]+/giu, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((token) => token.length > 1);
}

function normalizeVector(vector) {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum) || 1;
  return vector.map((value) => value / norm);
}

function dot(a, b) {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}

function hashToken(token) {
  const digest = crypto.createHash("md5").update(token).digest();
  return digest.readUInt32BE(0) % VECTOR_DIM;
}

function localEmbedding(text) {
  const vector = new Array(VECTOR_DIM).fill(0);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vector;
  for (const token of tokens) {
    vector[hashToken(token)] += 1;
  }
  return normalizeVector(vector);
}

async function remoteEmbedding(text) {
  const model = process.env.OPENAI_EMBEDDING_MODEL || process.env.OPENAI_MODEL || "text-embedding-3-small";
  const baseURL = process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
  const apiKey = process.env.OPENAI_API_KEY || "";
  if (!apiKey) return null;

  try {
    const resp = await fetch(`${baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    const embedding = json.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch {
    return null;
  }
}

async function getEmbedding(text) {
  const remote = await remoteEmbedding(text);
  return remote ? normalizeVector(remote) : localEmbedding(text);
}

function chunkLines(lines, targetLines = 120, overlap = 20) {
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + targetLines);
    const text = lines.slice(start, end).join("\n");
    chunks.push({
      startLine: start + 1,
      endLine: end,
      text,
    });
    if (end >= lines.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function walkFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      if (entry.isFile() && isTextFile(abs)) files.push(abs);
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function stripProjectRoot(absPath, root) {
  return path.relative(root, absPath).split(path.sep).join("/");
}

function scoreHit(queryEmbedding, queryTokens, chunk) {
  const vectorScore = dot(queryEmbedding, chunk.embedding || []);
  const haystack = `${chunk.path}\n${chunk.text}`.toLowerCase();
  let lexicalScore = 0;
  for (const token of queryTokens) {
    if (haystack.includes(token)) lexicalScore += 0.05;
  }
  return vectorScore + lexicalScore;
}

export async function ensureProjectIndexed(root) {
  const projectRoot = path.resolve(root);
  const store = loadVectorStore();
  if (store.projectRoot !== projectRoot) {
    store.projectRoot = projectRoot;
    store.files = {};
  }

  const files = walkFiles(projectRoot);
  const seen = new Set();
  let changed = false;

  for (const absPath of files) {
    const relPath = stripProjectRoot(absPath, projectRoot);
    seen.add(relPath);
    let content;
    try {
      content = fs.readFileSync(absPath, "utf8");
    } catch {
      continue;
    }
    if (content.length > 300000) continue;

    const fileHash = hashText(content);
    const existing = store.files[relPath];
    if (existing && existing.hash === fileHash && Array.isArray(existing.chunks)) {
      continue;
    }

    const lines = content.split("\n");
    const chunks = [];
    for (const chunk of chunkLines(lines)) {
      const chunkText = chunk.text.trim();
      if (!chunkText) continue;
      const embedding = await getEmbedding(`${relPath}\n${chunkText}`);
      chunks.push({
        path: relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunkText,
        embedding,
        hash: hashText(chunkText),
      });
    }

    store.files[relPath] = {
      hash: fileHash,
      updatedAt: new Date().toISOString(),
      chunks,
    };
    changed = true;
  }

  for (const relPath of Object.keys(store.files)) {
    if (!seen.has(relPath)) {
      delete store.files[relPath];
      changed = true;
    }
  }

  if (changed) saveVectorStore(store);
  return store;
}

export async function searchProject(root, query, limit = 8) {
  const store = await ensureProjectIndexed(root);
  const queryEmbedding = await getEmbedding(query);
  const queryTokens = tokenize(query);
  const hits = [];

  for (const file of Object.values(store.files)) {
    for (const chunk of file.chunks || []) {
      hits.push({
        path: chunk.path,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        text: chunk.text,
        score: scoreHit(queryEmbedding, queryTokens, chunk),
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => ({
      ...hit,
      excerpt: hit.text.length > 500 ? `${hit.text.slice(0, 500)}...` : hit.text,
    }));
}

export async function commitMemoryTurn(root, turn) {
  const store = await ensureProjectIndexed(root);
  const text = [
    `User: ${turn.user}`.trim(),
    `Assistant: ${turn.assistant}`.trim(),
    turn.notes ? `Notes: ${turn.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const embedding = await getEmbedding(text);
  store.memories.push({
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    text,
    embedding,
    tags: turn.tags || [],
  });

  if (store.memories.length > 300) {
    store.memories = store.memories.slice(-300);
  }

  saveVectorStore(store);
}

export async function searchMemories(root, query, limit = 4) {
  const store = await ensureProjectIndexed(root);
  const queryEmbedding = await getEmbedding(query);
  const queryTokens = tokenize(query);

  const hits = (store.memories || [])
    .map((memory) => {
      const lexical = queryTokens.reduce((sum, token) => {
        return sum + (memory.text.toLowerCase().includes(token) ? 0.04 : 0);
      }, 0);
      return {
        text: memory.text,
        score: dot(queryEmbedding, memory.embedding || []) + lexical,
        createdAt: memory.createdAt,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return hits;
}
