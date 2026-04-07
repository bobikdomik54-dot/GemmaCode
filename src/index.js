#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import process from "node:process";
import dotenv from "dotenv";

dotenv.config();

import { state } from "./state.js";
import { ui, ensureAppHome, loadHistory, saveHistory, printBanner, printHelp, handleCommand } from "./ui.js";
import { makeClient, checkConnection, runWithTools } from "./api.js";
import { commitMemoryTurn } from "./vector_store.js";

async function main() {
  ensureAppHome();
  loadHistory();
  printBanner();

  makeClient();
  await checkConnection();

  const rl = readline.createInterface({ input, output, terminal: true });

  rl.on("close", () => {
    saveHistory();
    process.exit(0);
  });

  printHelp();

  while (true) {
    let userInput;
    try {
      userInput = (await rl.question(ui.user("you > "))).trim();
    } catch (err) {
      if (err && (err.code === "ERR_USE_AFTER_CLOSE" || rl.closed)) break;
      continue;
    }

    if (!userInput) continue;

    if (userInput.startsWith("/")) {
      await handleCommand(userInput);
      continue;
    }

    const pendingTurn = { user: userInput, assistant: "", toolTrace: [] };
    state.pendingTurn = pendingTurn;
    rl.pause();
    try {
      const result = await runWithTools(
        userInput,
        (text) => {
          process.stdout.write(text);
        },
        (status) => {
          if (status && status !== "idle") {
            process.stdout.write(`${ui.muted(`[status] ${status}`)}\n`);
          }
        }
      );
      pendingTurn.assistant = result.answer || "";
      pendingTurn.toolTrace = result.toolTrace || [];
    } catch (error) {
      console.error(ui.danger(`\nError: ${error.message}\n`));
    } finally {
      rl.resume();
    }

    if (pendingTurn.assistant) {
      state.messages.push({ role: "user", content: pendingTurn.user });
      state.messages.push({ role: "assistant", content: pendingTurn.assistant });
      if (state.projectDir) {
        await commitMemoryTurn(state.projectDir, {
          user: pendingTurn.user,
          assistant: pendingTurn.assistant,
          notes: pendingTurn.toolTrace.map((step) => `${step.tool}: ${String(step.result || "").slice(0, 120)}`).join(" | "),
        });
      }
    }
    state.pendingTurn = null;
    saveHistory();
  }
}

main();
