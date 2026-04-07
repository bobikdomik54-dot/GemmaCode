import chalk from "chalk";
import ora from "ora";
import process from "node:process";
import fs from "node:fs";
import crypto from "node:crypto";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { state, DEFAULT_BASE_URL, AI_REQUEST_LOG_FILE, APP_HOME } from "./state.js";
import { ui } from "./ui.js";
import { buildProjectContext, buildRetrievalContext, buildSystemPrompt } from "./tooling.js";
import { searchProject, searchMemories } from "./vector_store.js";
import { LANGCHAIN_TOOLS } from "./langchain_tools.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseURL() {
  return process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL;
}

function apiKey() {
  return process.env.OPENAI_API_KEY || "";
}

function ensureLogDir() {
  fs.mkdirSync(APP_HOME, { recursive: true });
}

function appendAiLog(entry) {
  try {
    ensureLogDir();
    fs.appendFileSync(AI_REQUEST_LOG_FILE, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Logging must not break execution.
  }
}

function serializeMessage(message) {
  if (!message) return null;
  return {
    type: message._getType?.() || message.constructor?.name || "message",
    content: message.content,
    name: message.name,
    tool_calls: message.tool_calls,
    tool_call_id: message.tool_call_id,
  };
}

function mapStoredMessages(messages) {
  return messages.flatMap((message) => {
    if (!message || typeof message.content !== "string") return [];
    if (message.role === "user") return [new HumanMessage(message.content)];
    if (message.role === "assistant") return [new AIMessage(message.content)];
    return [];
  });
}

function createBaseModel({ temperature = state.temperature, maxTokens = state.maxTokens } = {}) {
  return new ChatOpenAI({
    model: state.model,
    temperature,
    maxTokens,
    configuration: {
      baseURL: baseURL(),
      apiKey: apiKey(),
    },
  });
}

function createToolModel() {
  return createBaseModel({ temperature: 0.1 }).bindTools(LANGCHAIN_TOOLS, {
    tool_choice: "required",
  });
}

function createFinalModel() {
  return createBaseModel({ temperature: 0.15 });
}

export function makeClient() {
  if (!apiKey()) {
    console.error(ui.danger("OPENAI_API_KEY is not set. Create .env or export the variable."));
    process.exit(1);
  }
}

export async function checkConnection() {
  const spinner = ora({ text: "Connecting to AI server...", color: "cyan" }).start();
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const resp = await fetch(`${baseURL()}/models`, {
        headers: { Authorization: `Bearer ${apiKey()}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      spinner.succeed(`Connected  ${ui.muted(baseURL())}  model: ${chalk.bold(state.model)}`);
      return;
    } catch (e) {
      if (attempt < 5) {
        spinner.text = ui.muted(`Retry ${attempt}/5... (${e.message.slice(0, 50)})`);
        await sleep(attempt * 1000);
      } else {
        spinner.fail(ui.danger(`Cannot reach server: ${e.message}`));
        process.exit(1);
      }
    }
  }
}

async function invokeModel(model, messages, phase) {
  const requestId = crypto.randomUUID();
  appendAiLog({
    ts: new Date().toISOString(),
    type: "request",
    request_id: requestId,
    phase,
    model: state.model,
    messages: messages.map(serializeMessage),
  });

  try {
    const response = await model.invoke(messages);
    appendAiLog({
      ts: new Date().toISOString(),
      type: "response",
      request_id: requestId,
      phase,
      response: serializeMessage(response),
    });
    return response;
  } catch (error) {
    appendAiLog({
      ts: new Date().toISOString(),
      type: "error",
      request_id: requestId,
      phase,
      error: error.message,
    });
    throw error;
  }
}

function extractTextContent(content) {
  return Array.isArray(content)
    ? content.map((item) => (typeof item === "string" ? item : item?.text || "")).join("")
    : String(content || "");
}

function renderAssistantText(write, content) {
  const trimmed = extractTextContent(content).trim();
  if (!trimmed) return;
  write(`\n${ui.assistant("*")} ${chalk.bold("assistant")}\n`);
  write(`${trimmed}\n`);
}

function renderToolResult(write, toolName, result) {
  const preview = String(result || "").trim().slice(0, 400);
  if (!preview) return;
  write(ui.muted(`  [${toolName}] ${preview}\n`));
}

async function buildRagContext(userInput) {
  if (!state.projectDir) return "";
  const [codeHits, memoryHits] = await Promise.all([
    searchProject(state.projectDir, userInput, state.ragLimit),
    searchMemories(state.projectDir, userInput, state.memoryLimit),
  ]);
  return buildRetrievalContext(codeHits, memoryHits);
}

function toolStatus(toolName) {
  switch (toolName) {
    case "search_code":
      return "searching code";
    case "read_files":
      return "reading files";
    case "list_dir":
      return "inspecting tree";
    case "apply_patch":
      return "editing";
    case "create_file":
      return "creating file";
    case "web_search":
      return "searching web";
    default:
      return `running ${toolName}`;
  }
}

export async function runWithTools(userInput, write = process.stdout.write.bind(process.stdout), onStatus = () => {}) {
  const projectContext = buildProjectContext();
  const retrievalContext = await buildRagContext(userInput);
  const systemPrompt = buildSystemPrompt({
    deepMode: state.deepMode,
    projectContext,
    retrievalContext,
  });

  const toolModel = createToolModel();
  const messages = [
    new SystemMessage(systemPrompt),
    ...mapStoredMessages(state.messages.slice(-16)),
    new HumanMessage(userInput),
  ];

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
    write(ui.muted("\n[cancelled]\n\n"));
  };
  process.once("SIGINT", abortHandler);

  const toolTrace = [];
  let finalAnswer = "";

  try {
    for (let round = 0; round < state.maxToolRounds; round++) {
      if (aborted) break;

      onStatus(round === 0 ? "analyzing" : "reasoning");
      const aiMessage = await invokeModel(toolModel, messages, round === 0 ? "plan" : "tool_loop");
      messages.push(aiMessage);

      const toolCalls = Array.isArray(aiMessage.tool_calls) ? aiMessage.tool_calls : [];
      if (toolCalls.length === 0) {
        finalAnswer = extractTextContent(aiMessage.content).trim();
        break;
      }

      for (const call of toolCalls) {
        if (aborted) break;
        onStatus(toolStatus(call.name));
        const spinner = ora({ text: `${call.name}`, color: "yellow", spinner: "dots" }).start();
        const tool = LANGCHAIN_TOOLS.find((candidate) => candidate.name === call.name);
        let result = "";

        try {
          if (!tool) throw new Error(`Unknown tool: ${call.name}`);
          result = await tool.invoke(call.args ?? {});
          if (String(result).startsWith("ERROR:")) {
            spinner.fail(`${call.name} failed`);
            write(ui.danger(`  ${result}\n`));
          } else {
            spinner.succeed(`${call.name} done`);
            renderToolResult(write, call.name, result);
          }
        } catch (error) {
          result = `ERROR: ${error.message}`;
          spinner.fail(`${call.name} failed`);
          write(ui.danger(`  ${result}\n`));
        }

        toolTrace.push({
          tool: call.name,
          args: call.args ?? {},
          result,
        });

        messages.push(
          new ToolMessage({
            content: String(result),
            tool_call_id: call.id,
            name: call.name,
          })
        );
      }
    }

    if (!finalAnswer && !aborted) {
      onStatus("finalizing");
      const finalResponse = await invokeModel(
        createFinalModel(),
        [
          ...messages,
          new HumanMessage("Give the final user-facing answer now. Be short and direct."),
        ],
        "final"
      );
      finalAnswer = extractTextContent(finalResponse.content).trim();
    }

    if (finalAnswer) {
      write(`\n${ui.assistant("*")} ${chalk.bold("assistant")}\n`);
      write(finalAnswer);
      write("\n\n");
    }

    return { answer: finalAnswer, toolTrace };
  } finally {
    process.removeListener("SIGINT", abortHandler);
    state.generating = false;
    onStatus("idle");
  }
}
