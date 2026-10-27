#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runAgent } from "./agent.js";
import { parseArgs, UsageError } from "./args.js";
import { loadConfig } from "./config.js";
import { init } from "./init.js";
import * as git from "./git.js";
import { branchName, buildPrBody, prTitle } from "./pr.js";
import { loadPrompt, render } from "./prompts.js";
import { resumePoint } from "./resume.js";
import { formatTicket, loadTicket, parseSource, type Ticket } from "./ticket.js";

const USAGE = `ticket2pr: ticket -> reviewed plan -> draft PR

Usage:
  ticket2pr init [--jira <https://yourcompany.atlassian.net>]
      Set up the current repo: add a "Ticket" GitHub issue form (or, with
      --jira, point at your Jira site instead), create ticket2pr.config.json,
      and ignore .ticket2pr/. Never overwrites anything.

  ticket2pr check <ticket>
      Optional. Review the ticket itself before planning: what's missing,
      whether its pointers exist, and a suggested rewrite. Changes nothing.

  ticket2pr plan <ticket>
      Explore the repo read-only and write a plan to .ticket2pr/<id>/PLAN.md.
      Read it, edit it, answer its open questions. Nothing is changed yet.

  ticket2pr implement <.ticket2pr/<id>> [--dry-run]
      Implement the approved plan on a new branch, run tests, open a draft PR.
      --dry-run stops after committing locally (no push, no PR).
      Safe to run again if it stops partway: it reuses the agent's work and
      skips whatever is already done.

A <ticket> is any of:
  12, #12 or a GitHub issue URL      GitHub issue (needs the gh CLI)
  PROJ-123 or a Jira issue URL       Jira issue (needs Jira credentials, see README)
  path/to/ticket.md                  a markdown file
`;

function setUp(jiraBaseUrl?: string): void {
  if (jiraBaseUrl !== undefined && !/^https?:\/\/\S+$/.test(jiraBaseUrl)) {
    throw new Error("--jira needs your Jira site's address, e.g. --jira https://yourcompany.atlassian.net");
  }
  const root = git.repoRoot();
  if (!root) throw new Error("This isn't a git repository. Run ticket2pr init from the root of the repo you want to set up.");
  if (resolve(root) !== resolve(".")) throw new Error(`Run ticket2pr init from the root of the repo: ${root}`);

  console.log("Setting up ticket2pr in this repo:\n");
  for (const line of init(git.defaultBranch(), { jiraBaseUrl })) console.log(line);
  console.log(
    jiraBaseUrl
      ? "\nNext: commit these files, and set your Jira credentials (see the README)."
      : "\nNext: commit these files, then push so the issue form shows up on GitHub.",
  );
  console.log("Then write a ticket and run: ticket2pr check <ticket>\n");
}

async function check(source: string): Promise<void> {
  const ticket = await loadTicket(parseSource(source), loadConfig());
  const dir = join(".ticket2pr", ticket.id);
  mkdirSync(dir, { recursive: true });

  console.log(`Checking ticket: ${ticket.title}\n(reading the repo; nothing will be changed)\n`);
  const prompt = render(loadPrompt("check"), { ticket: formatTicket(ticket) });
  const review = runAgent(prompt, { allowedTools: ["Read", "Grep", "Glob"] });

  const checkPath = join(dir, "CHECK.md");
  writeFileSync(checkPath, review + "\n");

  console.log(`${review}\n`);
  console.log(`Saved to ${checkPath}. Improve the ticket if needed, then run:`);
  console.log(`  ticket2pr plan ${source}\n`);
}

async function plan(source: string): Promise<void> {
  const ticket = await loadTicket(parseSource(source), loadConfig());
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
  const config = loadConfig();
  const ticket = JSON.parse(readFileSync(ticketPath, "utf8")) as Ticket;
  const planText = readFileSync(planPath, "utf8").trim();
  const branch = branchName(config.branchPrefix, ticket);
  const summaryPath = join(dir, "SUMMARY.md");

  // Safe to run again after a crash: an existing branch is picked up where it stopped.
  const exists = git.branchExists(branch);
  const onBranch = exists && git.currentBranch() === branch;
  if (!onBranch && git.hasUncommittedChanges()) {
    throw new Error("You have uncommitted changes. Commit or stash them first.");
  }
  if (!exists) git.createBranch(branch, config.baseBranch);
  else if (!onBranch) git.checkout(branch);

  const point = resumePoint({
    exists,
    dirty: git.hasUncommittedChanges(),
    ahead: git.commitsAhead(config.baseBranch),
    hasSummary: existsSync(summaryPath),
  });

  let summary: string;
  if (point === "after-agent") {
    summary = readFileSync(summaryPath, "utf8").trim();
    console.log(`On branch ${branch}. Reusing the agent's work from the earlier run.`);
    console.log(`(To start over instead: git checkout ${config.baseBranch} && git branch -D ${branch})\n`);
  } else {
    console.log(
      point === "fresh"
        ? `On branch ${branch}. Implementing the approved plan...\n`
        : `On existing branch ${branch}. The earlier run didn't finish, so implementing the plan again...\n`,
    );

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
    summary = runAgent(prompt, { allowedTools, permissionMode: "acceptEdits" });
    writeFileSync(summaryPath, summary + "\n");
  }

  if (!git.hasUncommittedChanges() && git.commitsAhead(config.baseBranch) === 0) {
    throw new Error(`The agent made no changes. Its summary is in ${summaryPath}.`);
  }

  // Run the tests ourselves, so the PR reports what actually happened, not what the agent says happened.
  const tests = config.testCommand
    ? { command: config.testCommand, ...git.runTests(config.testCommand) }
    : null;
  if (tests) console.log(`Tests ${tests.passed ? "passed" : "FAILED"}.`);

  const ref = ticket.issueNumber ? ` (#${ticket.issueNumber})` : "";
  if (git.hasUncommittedChanges()) git.commitAll(`${prTitle(ticket)}${ref}`);

  const bodyPath = resolve(dir, "PR.md");
  writeFileSync(bodyPath, buildPrBody({ ticket, plan: planText, agentSummary: summary, tests }));

  if (dryRun) {
    console.log(`\nDry run: committed on ${branch}. PR description is in ${bodyPath}.`);
    return;
  }

  git.pushBranch(branch);
  const existing = git.findOpenPr(branch);
  if (existing) {
    console.log(`\nPR already open: ${existing}`);
    return;
  }
  const url = git.openDraftPr({ base: config.baseBranch, head: branch, title: prTitle(ticket), bodyFile: bodyPath });
  console.log(`\nDraft PR: ${url}`);
}

async function main(argv: string[]): Promise<void> {
  const command = parseArgs(argv);
  if (command.name === "help") return void console.log(USAGE);
  if (command.name === "init") return setUp(command.jira);
  if (command.name === "check") return check(command.ticket);
  if (command.name === "plan") return plan(command.ticket);
  return implement(command.dir, command.dryRun);
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof UsageError) console.error('Run "ticket2pr help" to see how to use it.');
  process.exitCode = 1;
}
