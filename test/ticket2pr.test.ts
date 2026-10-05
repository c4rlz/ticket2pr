import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseMarkdownTicket, parseSource, slugify } from "../src/ticket.js";
import { loadPrompt, render } from "../src/prompts.js";
import { branchName, buildPrBody } from "../src/pr.js";
import { detectTestCommand, ignoresWorkspace, init } from "../src/init.js";

const noFiles = () => false;

test("parseSource recognises issue numbers, URLs and files", () => {
  assert.deepEqual(parseSource("12", noFiles), { kind: "issue", ref: "12" });
  assert.deepEqual(parseSource("#12", noFiles), { kind: "issue", ref: "12" });
  const url = "https://github.com/carly/garden-app/issues/7";
  assert.deepEqual(parseSource(url, noFiles), { kind: "issue", ref: url });
  assert.deepEqual(parseSource("ticket.md", () => true), { kind: "file", path: "ticket.md" });
  assert.throws(() => parseSource("not-a-thing", noFiles));
});

test("parseMarkdownTicket takes the first heading as the title", () => {
  const { title, body } = parseMarkdownTicket("# Add dark mode\n\n## Context\nIt's bright.", "x");
  assert.equal(title, "Add dark mode");
  assert.equal(body, "## Context\nIt's bright.");
});

test("parseMarkdownTicket falls back when there is no heading", () => {
  const { title, body } = parseMarkdownTicket("Just some text", "fallback");
  assert.equal(title, "fallback");
  assert.equal(body, "Just some text");
});

test("slugify makes safe, short ids", () => {
  assert.equal(slugify("Add Dark Mode!"), "add-dark-mode");
  assert.equal(slugify("  --weird__name--  "), "weird-name");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("render fills placeholders and rejects unknown ones", () => {
  assert.equal(render("Hi {{name}}", { name: "Carly" }), "Hi Carly");
  assert.throws(() => render("Hi {{nmae}}", { name: "Carly" }), /nmae/);
});

test("every built-in prompt renders with the values the CLI provides", () => {
  const ticket = { ticket: "# A ticket" };
  assert.match(render(loadPrompt("check"), ticket), /# A ticket/);
  assert.match(render(loadPrompt("plan"), ticket), /# A ticket/);
  const implement = render(loadPrompt("implement"), { ...ticket, plan: "the plan", testInstruction: "run tests" });
  assert.match(implement, /the plan/);
});

test("buildPrBody links the issue, reports tests honestly and includes the plan", () => {
  const ticket = { id: "issue-3", title: "Fix bug", body: "", issueNumber: 3 };
  const body = buildPrBody({
    ticket,
    plan: "# Plan: Fix bug",
    agentSummary: "## What changed\nFixed it.",
    tests: { command: "npm test", passed: false, tail: "1 failing" },
  });
  assert.match(body, /Closes #3/);
  assert.match(body, /❌ failed/);
  assert.match(body, /# Plan: Fix bug/);
  assert.equal(branchName("ticket2pr/", ticket), "ticket2pr/issue-3");
});

test("buildPrBody says so when no tests were run", () => {
  const body = buildPrBody({
    ticket: { id: "x", title: "x", body: "" },
    plan: "plan",
    agentSummary: "summary",
    tests: null,
  });
  assert.match(body, /tests were not run/);
  assert.doesNotMatch(body, /Closes/);
});

function tempRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "ticket2pr-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

test("detectTestCommand recognises common setups", () => {
  assert.equal(detectTestCommand(tempRepo({ "package.json": '{"scripts":{"test":"vitest"}}' })), "npm test");
  assert.equal(
    detectTestCommand(tempRepo({ "package.json": '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1"}}' })),
    undefined,
  );
  assert.equal(detectTestCommand(tempRepo({ "pytest.ini": "[pytest]" })), "pytest");
  assert.equal(detectTestCommand(tempRepo({ "pytest.ini": "[pytest]", ".venv/bin/pytest": "" })), ".venv/bin/pytest");
  assert.equal(detectTestCommand(tempRepo({ "pyproject.toml": "[tool.pytest.ini_options]" })), "pytest");
  assert.equal(detectTestCommand(tempRepo({ "Cargo.toml": "" })), "cargo test");
  assert.equal(detectTestCommand(tempRepo({ "go.mod": "" })), "go test ./...");
  assert.equal(detectTestCommand(tempRepo({ Makefile: "build:\n\ttrue\ntest:\n\ttrue\n" })), "make test");
  assert.equal(detectTestCommand(tempRepo({ "README.md": "" })), undefined);
});

test("ignoresWorkspace matches the usual spellings only", () => {
  assert.ok(ignoresWorkspace("node_modules/\n.ticket2pr/\n"));
  assert.ok(ignoresWorkspace("/.ticket2pr"));
  assert.ok(!ignoresWorkspace("node_modules/\n# .ticket2pr/\n"));
});

test("init sets up a repo once and never overwrites", () => {
  const dir = tempRepo({ "pytest.ini": "[pytest]", ".gitignore": "__pycache__/" });
  const previous = process.cwd();
  process.chdir(dir);
  try {
    const first = init("develop");
    assert.equal(first.filter((line) => line.startsWith("✓")).length, 3);
    assert.ok(existsSync(".github/ISSUE_TEMPLATE/ticket.yml"));
    const config = JSON.parse(readFileSync("ticket2pr.config.json", "utf8"));
    assert.deepEqual(config, { baseBranch: "develop", branchPrefix: "ticket2pr/", testCommand: "pytest" });
    assert.equal(readFileSync(".gitignore", "utf8"), "__pycache__/\n.ticket2pr/\n");

    writeFileSync("ticket2pr.config.json", '{"testCommand":"custom"}');
    const second = init("main");
    assert.ok(second.every((line) => !line.startsWith("✓")));
    assert.equal(readFileSync("ticket2pr.config.json", "utf8"), '{"testCommand":"custom"}');
    assert.equal(readFileSync(".gitignore", "utf8"), "__pycache__/\n.ticket2pr/\n");
  } finally {
    process.chdir(previous);
  }
});
