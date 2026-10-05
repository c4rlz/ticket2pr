import { execFileSync } from "node:child_process";

export interface AgentOptions {
  /** Claude Code tool permissions, e.g. ["Read", "Grep", "Bash(npm test)"]. */
  allowedTools: string[];
  /** "acceptEdits" lets the agent edit files without asking. Omit for read-only runs. */
  permissionMode?: "acceptEdits";
}

/**
 * Run Claude Code headlessly in the current directory and return its final message.
 * The prompt goes in on stdin so long tickets and plans aren't limited by argv size.
 */
export function runAgent(prompt: string, options: AgentOptions): string {
  const args = ["-p", "--output-format", "json", "--allowedTools", options.allowedTools.join(",")];
  if (options.permissionMode) args.push("--permission-mode", options.permissionMode);

  const output = execFileSync("claude", args, {
    input: prompt,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    stdio: ["pipe", "pipe", "inherit"],
  });

  const parsed = JSON.parse(output) as { result?: string; is_error?: boolean };
  if (parsed.is_error || typeof parsed.result !== "string") {
    throw new Error(`Claude Code didn't finish cleanly:\n${output.slice(0, 2000)}`);
  }
  return parsed.result.trim();
}
