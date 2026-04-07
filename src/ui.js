import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { stdout as output } from "node:process";
import boxen from "boxen";
import chalk from "chalk";
import gradient from "gradient-string";
import wrapAnsi from "wrap-ansi";
import { state, APP_HOME, HISTORY_FILE, DEFAULT_BASE_URL, AI_REQUEST_LOG_FILE } from "./state.js";
import { VECTOR_STORE_FILE } from "./vector_store.js";

export const ui = {
  brand: gradient(["#58c4dd", "#4f7cff", "#ff7a18"]),
  assistant: chalk.hex("#58c4dd"),
  user: chalk.hex("#ffb454"),
  muted: chalk.hex("#7d8590"),
  danger: chalk.hex("#ff6b6b"),
  ok: chalk.hex("#7ee787"),
  accent: chalk.hex("#8b5cf6"),
  tool: chalk.hex("#f7c948"),
};

export function ensureAppHome() {
  fs.mkdirSync(APP_HOME, { recursive: true });
}

export function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function saveHistory() {
  ensureAppHome();
  fs.writeFileSync(
    HISTORY_FILE,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        model: state.model,
        deepMode: state.deepMode,
        projectDir: state.projectDir,
        messages: state.messages,
      },
      null,
      2
    )
  );
}

export function loadHistory() {
  const previous = safeReadJson(HISTORY_FILE, null);
  if (!previous || !Array.isArray(previous.messages)) return;
  state.model = previous.model || state.model;
  state.deepMode = previous.deepMode ?? state.deepMode;
  state.projectDir = previous.projectDir || state.projectDir;
  state.messages = previous.messages;
}

export function printBanner() {
  const title = ui.brand.multiline(`
  ▄▄ • ▄▄▄ .• ▌ ▄ ·. • ▌ ▄ ·.  ▄▄▄·  ▄▄·       ·▄▄▄▄  ▄▄▄ .
 ▐█ ▀ ▪▀▄.▀··██ ▐███▪·██ ▐███▪▐█ ▀█ ▐█ ▌▪▪     ██▪ ██ ▀▄.▀·
 ▄█ ▀█▄▐▀▀▪▄▐█ ▌▐▌▐█·▐█ ▌▐▌▐█·▄█▀▀█ ██ ▄▄ ▄█▀▄ ▐█· ▐█▌▐▀▀▪▄
 ▐█▄▪▐█▐█▄▄▌██ ██▌▐█▌██ ██▌▐█▌▐█ ▪▐▌▐███▌▐█▌.▐▌██. ██ ▐█▄▄▌
 ·▀▀▀▀  ▀▀▀ ▀▀  █▪▀▀▀▀▀  █▪▀▀▀ ▀  ▀ ·▀▀▀  ▀█▄▀▪▀▀▀▀▀•  ▀▀▀
  `);

  const modeLabel = state.deepMode ? ui.accent("DEEP (thorough)") : ui.ok("FAST (quick)");
  const body = [
    `${chalk.bold("OpenAI-compatible")} terminal client for your own AI server`,
    `${ui.muted("Runtime:")} LangChain JS tool calling`,
    `${ui.muted("Endpoint:")} ${process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL}`,
    `${ui.muted("Model:")} ${state.model}`,
    `${ui.muted("Mode:")} ${modeLabel}`,
    `${ui.muted("Project dir:")} ${state.projectDir || chalk.italic("not set — use /dir <path>")}`,
    `${ui.muted("Commands:")} /help  /dir  /switch  /model  /clear  /status  /exit`,
  ].join("\n");

  console.log(
    boxen(`${title}\n${body}`, {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "cyan",
    })
  );
}

export function printHelp() {
  const modeLabel = state.deepMode ? ui.accent("DEEP") : ui.ok("FAST");
  const lines = [
    `${chalk.bold("/help")}              Show this help`,
    `${chalk.bold("/dir <path>")}       Set project directory (AI tools work here)`,
    `${chalk.bold("/switch")}           Toggle mode: currently ${modeLabel}`,
    `${chalk.bold("/model <name>")}     Switch model`,
    `${chalk.bold("/system")}           Show current system prompt`,
    `${chalk.bold("/clear")}            Clear chat history`,
    `${chalk.bold("/save")}             Save history`,
    `${chalk.bold("/status")}           Show config`,
    `${chalk.bold("/exit")}             Quit`,
  ];
  console.log(boxen(lines.join("\n"), { padding: 1, borderStyle: "single", borderColor: "gray" }));
}

export function printStatus() {
  const modeLabel = state.deepMode ? ui.accent("DEEP (thorough)") : ui.ok("FAST (quick)");
  const content = [
    `${ui.muted("Base URL:")} ${process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL}`,
    `${ui.muted("Runtime:")} LangChain JS`,
    `${ui.muted("Model:")} ${state.model}`,
    `${ui.muted("Temperature:")} ${state.temperature}`,
    `${ui.muted("Max tokens:")} ${state.maxTokens}`,
    `${ui.muted("Mode:")} ${modeLabel}`,
    `${ui.muted("Project dir:")} ${state.projectDir || chalk.italic("not set")}`,
    `${ui.muted("Messages:")} ${state.messages.length}`,
    `${ui.muted("Vector store:")} ${VECTOR_STORE_FILE}`,
    `${ui.muted("AI request log:")} ${AI_REQUEST_LOG_FILE}`,
    `${ui.muted("History file:")} ${HISTORY_FILE}`,
  ].join("\n");
  console.log(boxen(content, { padding: 1, borderStyle: "single", borderColor: "blue" }));
}

export async function handleCommand(rawInput) {
  const [command, ...rest] = rawInput.slice(1).split(" ");
  const value = rest.join(" ").trim();

  switch (command) {
    case "help":
      printHelp();
      return true;

    case "dir":
      if (!value) {
        console.log(ui.muted(`Current project dir: ${state.projectDir || "not set"}`));
        return true;
      }
      if (!fs.existsSync(value)) {
        console.log(ui.danger(`Directory not found: ${value}`));
        return true;
      }
      state.projectDir = path.resolve(value);
      console.log(ui.ok(`Project dir set to: ${state.projectDir}`));
      saveHistory();
      return true;

    case "switch": {
      state.deepMode = !state.deepMode;
      const label = state.deepMode ? ui.accent("DEEP (thorough)") : ui.ok("FAST (quick)");
      console.log(ui.ok(`Mode switched to: ${label}`));
      saveHistory();
      return true;
    }

    case "model":
      if (!value) {
        console.log(ui.muted(`Current model: ${state.model}`));
        return true;
      }
      state.model = value;
      console.log(ui.ok(`Model switched to ${state.model}`));
      return true;

    case "system": {
      const { buildSystemPrompt, buildProjectContext } = await import("./tooling.js");
      const ctx = buildProjectContext();
      console.log(wrapAnsi(buildSystemPrompt({ deepMode: state.deepMode, projectContext: ctx }), output.columns || 100));
      return true;
    }

    case "clear":
      state.messages = [];
      console.log(ui.ok("Chat history cleared."));
      return true;

    case "save":
      saveHistory();
      console.log(ui.ok(`Saved to ${HISTORY_FILE}`));
      return true;

    case "status":
      printStatus();
      return true;

    case "exit":
    case "quit":
      saveHistory();
      process.exit(0);
      break;

    default:
      console.log(ui.danger(`Unknown command: /${command}`));
      return true;
  }
}
