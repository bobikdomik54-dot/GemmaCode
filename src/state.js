import dotenv from "dotenv";
import path from "node:path";
import process from "node:process";

dotenv.config();

export const APP_HOME = path.join(process.cwd(), ".gemma4code");
export const HISTORY_FILE = path.join(APP_HOME, "history.json");
export const AI_REQUEST_LOG_FILE = path.join(APP_HOME, "ai-requests.jsonl");
export const DEFAULT_BASE_URL = "http://79.76.35.116:8000/v1";
export const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gemma-4";

export const state = {
  model: DEFAULT_MODEL,
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || process.env.OPENAI_MODEL || "text-embedding-3-small",
  temperature: parseFloat(process.env.OPENAI_TEMPERATURE || "0.7"),
  maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || "3072", 10),
  deepMode: false,
  projectDir: null,
  messages: [],
  generating: false,
  pendingTurn: null,
  ragLimit: parseInt(process.env.OPENAI_RAG_LIMIT || "8", 10),
  memoryLimit: parseInt(process.env.OPENAI_MEMORY_LIMIT || "4", 10),
  maxToolRounds: parseInt(process.env.OPENAI_MAX_TOOL_ROUNDS || "6", 10),
  scannedProjectDir: null,
};
