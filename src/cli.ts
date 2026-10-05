#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runAgent } from "./agent.js";
import { loadConfig } from "./config.js";
import * as git from "./git.js";
import { branchName, buildPrBody } from "./pr.js";
import { loadPrompt, render } from "./prompts.js";
import { formatTicket, loadTicket, parseSource, type Ticket } from "./ticket.js";

const USAGE = `ticket2pr: ticket -> reviewed plan -> draft PR

Usage:
  ticket2pr plan <issue-number | issue-url | ticket.md>
      Explore the repo read-only and write a plan to .ticket2pr/<id>/PLAN.md.
      Read it, edit it, answer its open questions. Nothing is changed yet.

  ticket2pr implement <.ticket2pr/<id>> [--dry-run]
      Implement the approved plan on a new branch, run tests, open a draft PR.
      --dry-run stops after committing locally (no push, no PR).
`;

function plan(source: string): void {
  const ticket = loadTicket(parseSource(source));
  const dir = join(".ticket2pr", ticket.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ticket.json"), JSON.stringify(ticket, null, 2));

  console.log(`Planning: ${ticket.title}\n(reading the repo; nothing will be changed)\n`);
  const prompt = render(loadPrompt("plan"), { ticket: formatTicket(ticket) });
  const planText = runAgent(prompt, { allowedTools: ["Read", "Grep", "Glob"] });

  const planPath = join(dir, "PLAN.md");
  writeFileSync(planPath, planText + "\n");

  console.log(`Plan written to ${planPath}\n`);
  console.log("Next: read it, edit anything that's wrong, answer the open questions, then run:");
  console.log(`  ticket2pr implement ${dir}\n`);
}

function implement(dir: string, dryRun: boolean): void {
  const ticketPath = join(dir, "ticket.json");
  const planPath = join(dir, "PLAN.md");
  if (!existsSync(ticketPath) || !existsSync(planPath)) {
    throw new Error(`${dir} doesn't look like a plan folder. Run "ticket2pr plan" first.`);
  }
  if (git.hasUncommittedChanges()) {
    throw new Error("You have uncommitted changes. Commit or stash them first.");
  }

  const config = loadConfig();
  const ticket = JSON.parse(readFileSync(ticketPath, "utf8")) as Ticket;
  const planText = readFileSync(planPath, "utf8").trim();
  const branch = branchName(config.branchPrefix, ticket);

  git.createBranch(branch, config.baseBranch);
  console.log(`On branch ${branch}. Implementing the approved plan...\n`);

  const testInstruction = config.testCommand
    ? `Run the tests with \`${config.testCommand}\` and fix any failures your change causes.`
    : "No test command is configured, so you can't run tests. Say so in your summary.";

  const allowedTools = ["Read", "Grep", "Glob", "Edit", "Write"];
  if (config.testCommand) allowedTools.push(`Bash(${config.testCommand})`);

  const prompt = render(loadPrompt("implement"), {
    ticket: formatTicket(ticket),
    plan: planText,
    testInstruction,
  });
  const summary = runAgent(prompt, { allowedTools, permissionMode: "acceptEdits" });
  writeFileSync(join(dir, "SUMMARY.md"), summary + "\n");

  if (!git.hasUncommittedChanges()) {
    throw new Error(`The agent made no changes. Its summary is in ${dir}/SUMMARY.md.`);
  }

  // Run the tests ourselves, so the PR reports what actually happened, not what the agent says happened.
  const tests = config.testCommand
    ? { command: config.testCommand, ...git.runTests(config.testCommand) }
    : null;
  if (tests) console.log(`Tests ${tests.passed ? "passed" : "FAILED"}.`);

  const ref = ticket.issueNumber ? ` (#${ticket.issueNumber})` : "";
  git.commitAll(`${ticket.title}${ref}`);

  const bodyPath = resolve(dir, "PR.md");
  writeFileSync(bodyPath, buildPrBody({ ticket, plan: planText, agentSummary: summary, tests }));

  if (dryRun) {
    console.log(`\nDry run: committed on ${branch}. PR description is in ${bodyPath}.`);
    return;
  }

  git.pushBranch(branch);
  const url = git.openDraftPr({ base: config.baseBranch, head: branch, title: ticket.title, bodyFile: bodyPath });
  console.log(`\nDraft PR: ${url}`);
}

function main(argv: string[]): void {
  const [command, target, ...flags] = argv;
  if (command === "plan" && target) return plan(target);
  if (command === "implement" && target) return implement(target, flags.includes("--dry-run"));
  console.log(USAGE);
  if (command && command !== "help" && command !== "--help") process.exitCode = 1;
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
