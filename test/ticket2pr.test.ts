import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseMarkdownTicket, parseSource, slugify } from "../src/ticket.js";
import { loadPrompt, render } from "../src/prompts.js";
import { branchName, buildPrBody, prTitle } from "../src/pr.js";
import { adfToMarkdown, fetchJiraIssue, jiraAuthFromEnv, type AdfNode } from "../src/jira.js";
import { loadTicket } from "../src/ticket.js";
import { detectTestCommand, ignoresWorkspace, init } from "../src/init.js";
import { branchExists, checkout, commitAll, commitsAhead, createBranch, currentBranch, git } from "../src/git.js";
import { resumePoint } from "../src/resume.js";
import { parseArgs, UsageError } from "../src/args.js";

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

test("buildPrBody keeps passing test output out of the PR", () => {
  const body = buildPrBody({
    ticket: { id: "x", title: "x", body: "" },
    plan: "plan",
    agentSummary: "summary",
    tests: { command: "npm test", passed: true, tail: "22 passed" },
  });
  assert.match(body, /`npm test` ✅ passed/);
  assert.doesNotMatch(body, /22 passed/);
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

test("parseSource recognises Jira keys and links", () => {
  assert.deepEqual(parseSource("PROJ-123", noFiles), { kind: "jira", key: "PROJ-123" });
  assert.deepEqual(parseSource("https://acme.atlassian.net/browse/AB2-7", noFiles), {
    kind: "jira",
    key: "AB2-7",
    baseUrl: "https://acme.atlassian.net",
  });
  assert.deepEqual(parseSource("https://jira.acme.com/jira/browse/OPS-9?focused=1", noFiles), {
    kind: "jira",
    key: "OPS-9",
    baseUrl: "https://jira.acme.com/jira",
  });
  assert.deepEqual(
    parseSource("https://acme.atlassian.net/jira/software/projects/PR/boards/1?selectedIssue=PR-5", noFiles),
    { kind: "jira", key: "PR-5", baseUrl: "https://acme.atlassian.net" },
  );
  // A lower-case "fix-12" is far more likely a mistyped file name than a Jira key.
  assert.throws(() => parseSource("fix-12", noFiles));
});

test("adfToMarkdown keeps the structure of a Jira description", () => {
  const text = (value: string, marks?: AdfNode["marks"]): AdfNode => ({ type: "text", text: value, marks });
  const paragraph = (...content: AdfNode[]): AdfNode => ({ type: "paragraph", content });
  const item = (...content: AdfNode[]): AdfNode => ({ type: "listItem", content });
  const doc: AdfNode = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [text("Acceptance criteria")] },
      {
        type: "bulletList",
        content: [
          item(paragraph(text("Toggle is "), text("off", [{ type: "strong" }]), text(" by default"))),
          item(
            paragraph(text("Persists")),
            { type: "bulletList", content: [item(paragraph(text("across sessions")))] },
          ),
        ],
      },
      { type: "orderedList", attrs: { order: 3 }, content: [item(paragraph(text("third")))] },
      paragraph(text("See "), text("the docs", [{ type: "link", attrs: { href: "https://x.test" } }]), text(" and "), text("theme.ts", [{ type: "code" }])),
      { type: "codeBlock", attrs: { language: "ts" }, content: [text("const a = 1;")] },
      {
        type: "table",
        content: [
          { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph(text("Case"))] }, { type: "tableHeader", content: [paragraph(text("Result"))] }] },
          { type: "tableRow", content: [{ type: "tableCell", content: [paragraph(text("a|b"))] }, { type: "tableCell", content: [paragraph(text("ok"))] }] },
        ],
      },
      { type: "taskList", content: [{ type: "taskItem", attrs: { state: "DONE" }, content: [text("done")] }, { type: "taskItem", attrs: { state: "TODO" }, content: [text("todo")] }] },
      { type: "panel", content: [paragraph(text("Heads up"))] },
      { type: "mediaSingle", content: [{ type: "media" }] },
    ],
  };
  assert.equal(
    adfToMarkdown(doc),
    [
      "## Acceptance criteria",
      "- Toggle is **off** by default\n- Persists\n  - across sessions",
      "3. third",
      "See [the docs](https://x.test) and `theme.ts`",
      "```ts\nconst a = 1;\n```",
      "| Case | Result |\n| --- | --- |\n| a\\|b | ok |",
      "- [x] done\n- [ ] todo",
      "> Heads up",
      "_(attachment not included)_",
    ].join("\n\n"),
  );
  assert.equal(adfToMarkdown(null), "");
});

function fakeFetch(status: number, body: unknown, seen: { url?: string; auth?: string } = {}): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.auth = (init?.headers as Record<string, string>).Authorization;
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
}

test("fetchJiraIssue reads a Jira Cloud issue", async () => {
  const seen: { url?: string; auth?: string } = {};
  const env = { JIRA_EMAIL: "me@acme.test", JIRA_API_TOKEN: "secret" };
  const description = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Make it dark." }] }] };
  const ticket = await fetchJiraIssue("PROJ-7", "https://acme.atlassian.net/", {
    env,
    fetchImpl: fakeFetch(200, { fields: { summary: "Dark mode", description } }, seen),
  });
  assert.equal(seen.url, "https://acme.atlassian.net/rest/api/3/issue/PROJ-7?fields=summary,description");
  assert.equal(seen.auth, `Basic ${Buffer.from("me@acme.test:secret").toString("base64")}`);
  assert.deepEqual(ticket, {
    id: "PROJ-7",
    title: "Dark mode",
    body: "Make it dark.",
    jiraKey: "PROJ-7",
    url: "https://acme.atlassian.net/browse/PROJ-7",
  });
});

test("fetchJiraIssue uses a personal access token for Jira Server/Data Center", async () => {
  const seen: { url?: string; auth?: string } = {};
  const ticket = await fetchJiraIssue("OPS-1", "https://jira.acme.com", {
    env: { JIRA_PAT: "pat" },
    fetchImpl: fakeFetch(200, { fields: { summary: "Fix it", description: "h2. Plain wiki text\n" } }, seen),
  });
  assert.equal(seen.url, "https://jira.acme.com/rest/api/2/issue/OPS-1?fields=summary,description");
  assert.equal(seen.auth, "Bearer pat");
  assert.equal(ticket.body, "h2. Plain wiki text");
});

test("fetchJiraIssue explains missing credentials and HTTP errors", async () => {
  assert.throws(() => jiraAuthFromEnv({}), /JIRA_EMAIL and JIRA_API_TOKEN/);
  const env = { JIRA_PAT: "pat" };
  await assert.rejects(fetchJiraIssue("X-1", "https://j.test", { env, fetchImpl: fakeFetch(404, {}) }), /wasn't found/);
  await assert.rejects(fetchJiraIssue("X-1", "https://j.test", { env, fetchImpl: fakeFetch(401, {}) }), /rejected the credentials/);
  await assert.rejects(fetchJiraIssue("X-1", "https://j.test", { env, fetchImpl: fakeFetch(500, {}) }), /HTTP 500/);
});

test("loadTicket needs to know which Jira site to use", async () => {
  await assert.rejects(loadTicket({ kind: "jira", key: "X-1" }, {}, {}), /init --jira/);
});

test("Jira tickets put the key in the PR title and link back", () => {
  const ticket = { id: "PROJ-7", title: "Dark mode", body: "", jiraKey: "PROJ-7", url: "https://acme.atlassian.net/browse/PROJ-7" };
  assert.equal(prTitle(ticket), "PROJ-7: Dark mode");
  assert.equal(branchName("ticket2pr/", ticket), "ticket2pr/PROJ-7");
  const body = buildPrBody({ ticket, plan: "p", agentSummary: "s", tests: null });
  assert.match(body, /Jira: \[PROJ-7\]\(https:\/\/acme\.atlassian\.net\/browse\/PROJ-7\)/);
  assert.doesNotMatch(body, /Closes/);
  assert.equal(prTitle({ id: "x", title: "Plain", body: "" }), "Plain");
});

test("init --jira points the config at Jira instead of adding the issue form", () => {
  const dir = tempRepo({ "package.json": '{"scripts":{"test":"vitest"}}' });
  const previous = process.cwd();
  process.chdir(dir);
  try {
    init("main", { jiraBaseUrl: "https://acme.atlassian.net/" });
    assert.ok(!existsSync(".github/ISSUE_TEMPLATE/ticket.yml"));
    const config = JSON.parse(readFileSync("ticket2pr.config.json", "utf8"));
    assert.deepEqual(config.jira, { baseUrl: "https://acme.atlassian.net" });
    assert.equal(config.testCommand, "npm test");
  } finally {
    process.chdir(previous);
  }
});

for (const gitignore of [".ticket2pr/\n", ""]) {
  test(`commitAll commits the work but never .ticket2pr/ (${gitignore ? "ignored" : "not ignored"})`, () => {
    const dir = tempRepo({ ".gitignore": gitignore, "README.md": "hi\n" });
    const previous = process.cwd();
    process.chdir(dir);
    try {
      git("init", "-q");
      git("config", "user.name", "t");
      git("config", "user.email", "t@t");
      git("commit", "-q", "--allow-empty", "-m", "init");
      mkdirSync(".ticket2pr/12", { recursive: true });
      writeFileSync(".ticket2pr/12/PLAN.md", "plan");
      writeFileSync("feature.ts", "export {};\n");
      commitAll("Add feature");
      const committed = git("show", "--name-only", "--format=", "HEAD").split("\n");
      assert.ok(committed.includes("feature.ts"));
      assert.ok(committed.every((path) => !path.startsWith(".ticket2pr")));
    } finally {
      process.chdir(previous);
    }
  });
}

test("resumePoint reuses the agent's work only when it finished and left changes", () => {
  const base = { exists: true, dirty: false, ahead: 0, hasSummary: false };
  assert.equal(resumePoint({ ...base, exists: false, hasSummary: true, dirty: true }), "fresh");
  // Crashed in tests or commit: changes uncommitted, summary written.
  assert.equal(resumePoint({ ...base, dirty: true, hasSummary: true }), "after-agent");
  // Crashed in push or PR: already committed.
  assert.equal(resumePoint({ ...base, ahead: 1, hasSummary: true }), "after-agent");
  // Crashed while the agent was working: no summary yet.
  assert.equal(resumePoint({ ...base, dirty: true }), "run-agent");
  // The agent finished but changed nothing.
  assert.equal(resumePoint({ ...base, hasSummary: true }), "run-agent");
});

test("branch helpers report what an earlier run left behind", () => {
  const dir = tempRepo({ "README.md": "hi\n" });
  const previous = process.cwd();
  process.chdir(dir);
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "t");
    git("config", "user.email", "t@t");
    git("add", "-A");
    git("commit", "-q", "-m", "init");

    assert.equal(branchExists("ticket2pr/12"), false);
    createBranch("ticket2pr/12", "main");
    assert.equal(branchExists("ticket2pr/12"), true);
    assert.equal(currentBranch(), "ticket2pr/12");
    assert.equal(commitsAhead("main"), 0);

    writeFileSync("feature.ts", "export {};\n");
    commitAll("Add feature");
    assert.equal(commitsAhead("main"), 1);

    checkout("main");
    assert.equal(currentBranch(), "main");
  } finally {
    process.chdir(previous);
  }
});

test("parseArgs accepts each command's own flags, in any position", () => {
  assert.deepEqual(parseArgs([]), { name: "help" });
  assert.deepEqual(parseArgs(["implement", "--help"]), { name: "help" });
  assert.deepEqual(parseArgs(["plan", "#12"]), { name: "plan", ticket: "#12" });
  assert.deepEqual(parseArgs(["check", "PROJ-7"]), { name: "check", ticket: "PROJ-7" });
  assert.deepEqual(parseArgs(["implement", ".ticket2pr/issue-12"]), { name: "implement", dir: ".ticket2pr/issue-12", dryRun: false });
  assert.deepEqual(parseArgs(["implement", "--dry-run", "d"]), { name: "implement", dir: "d", dryRun: true });
  assert.deepEqual(parseArgs(["init"]), { name: "init", jira: undefined });
  assert.deepEqual(parseArgs(["init", "--jira", "https://a.atlassian.net"]), { name: "init", jira: "https://a.atlassian.net" });
  assert.deepEqual(parseArgs(["init", "--jira=https://a.atlassian.net"]), { name: "init", jira: "https://a.atlassian.net" });
});

test("parseArgs rejects typos and stray arguments instead of ignoring them", () => {
  const rejects = (argv: string[], message: RegExp) =>
    assert.throws(() => parseArgs(argv), (error) => error instanceof UsageError && message.test(error.message));
  rejects(["implement", "d", "--dryrun"], /doesn't know the option --dryrun\. It takes: --dry-run/);
  rejects(["implement", "d", "--dry-run=yes"], /doesn't take a value/);
  rejects(["plan", "12", "--dry-run"], /It takes no options/);
  rejects(["implement"], /needs a plan folder/);
  rejects(["plan"], /needs a ticket/);
  rejects(["plan", "12", "13"], /takes one argument, but got 2/);
  rejects(["init", "main"], /doesn't take an argument/);
  rejects(["init", "--jira"], /--jira needs a value/);
  rejects(["init", "--jira", "--dry-run"], /--jira needs a value/);
  rejects(["implemnt", "d"], /Unknown command "implemnt"/);
});
