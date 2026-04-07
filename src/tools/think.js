import { z } from "zod";

export const SYMBOL = "🧠";
export const NAME = "think";
export const DESCRIPTION = "Hidden scratchpad for internal reasoning. Use before non-trivial actions. Output is never shown to the user.";
export const SCHEMA = z.object({
  thought: z.string().describe("Brief internal reasoning note"),
});

export async function run() {
  return "Hidden reasoning recorded.";
}
