// End-to-end tests for `ticket2pr implement`: the built CLI runs in a throwaway repo with a bare
// local "origin", and fake `claude` and `gh` executables on PATH that record how they were called.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.js", import.meta.url));
const PLAN_DIR = ".ticket2pr/issue-12";
const BRANCH = "ticket2pr/issue-12";

// The agent: FAKE_CLAUDE says whether it writes a file, writes nothing, or crashes partway.
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require("node:fs");
const state = process.env.FAKE_STATE;
fs.appendFileSync(state + "/claude-calls", "call\\n");
const mode = process.env.FAKE_CLAUDE;
if (mode !== "nothing") fs.writeFileSync("feature.ts", "export const feature = true;\\n");
if (mode === "crash") { console.error("agent crashed"); process.exit(1); }
console.log(JSON.stringify({ result: "## What changed\\nAdded feature.ts." }));
`;

// gh: "pr list" reports the open PR if one was created; "pr create" fails while fail-create exists.
const FAKE_GH = `#!/usr/bin/env node
const fs = require("node:fs");
const state = process.env.FAKE_STATE;
const [, , noun, verb, ...args] = process.argv;
const openPr = state + "/open-pr";
if (noun === "pr" && verb === "list") {
  if (fs.existsSync(openPr)) console.log(fs.readFileSync(openPr, "utf8"));
} else if (noun === "pr" && verb === "create") {
  if (fs.existsSync(state + "/fail-create")) { console.error("gh: network down"); process.exit(1); }
  fs.appendFileSync(state + "/gh-create-calls", JSON.stringify(args) + "\\n");
  fs.writeFileSync(openPr, "https://github.com/acme/app/pull/1");
  console.log("https://github.com/acme/app/pull/1");
} else {
  process.exit(2);
}
`;

interface Sandbox {
  repo: string;
  remote: string;
  state: string;
  run(args: string[], env?: Record<string, string>): { status: number | null; output: string };
  git(...args: string[]): string;
  count(file: string): number;
}

function sandbox(testCommand = "echo all tests ok"): Sandbox {
  const root = mkdtempSync(join(tmpdir(), "ticket2pr-implement-"));
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  const state = join(root, "state");
  const bin = join(root, "bin");
  for (const dir of [repo, state, bin]) mkdirSync(dir);

  for (const [name, script] of [["claude", FAKE_CLAUDE], ["gh", FAKE_GH]]) {
    writeFileSync(join(bin, name), script);
    chmodSync(join(bin, name), 0o755);
  }

  const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, FAKE_STATE: state, FAKE_CLAUDE: "write" };
  const git = (...args: string[]): string => {
    const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };

  spawnSync("git", ["init", "-q", "--bare", remote]);
  git("init", "-q", "-b", "main");
  git("config", "user.name", "t");
  git("config", "user.email", "t@t");
  writeFileSync(join(repo, ".gitignore"), ".ticket2pr/\n");
  writeFileSync(join(repo, "ticket2pr.config.json"), JSON.stringify({ testCommand }));
  git("add", "-A");
  git("commit", "-q", "-m", "init");
  git("remote", "add", "origin", remote);

  // What `ticket2pr plan 12` leaves behind.
  mkdirSync(join(repo, PLAN_DIR), { recursive: true });
  writeFileSync(join(repo, PLAN_DIR, "ticket.json"), JSON.stringify({ id: "issue-12", title: "Add a feature", body: "Please.", issueNumber: 12 }));
  writeFileSync(join(repo, PLAN_DIR, "PLAN.md"), "Add feature.ts.\n");

  return {
    repo,
    remote,
    state,
    git,
    run(args, extraEnv = {}) {
      const result = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8" });
      return { status: result.status, output: `${result.stdout}${result.stderr}` };
    },
    count(file) {
      const path = join(state, file);
      return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").length : 0;
    },
  };
}

function remoteHas(box: Sandbox, branch: string): boolean {
  return spawnSync("git", ["--git-dir", box.remote, "rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).status === 0;
}

test("implement commits on a new branch, pushes and opens a draft PR", () => {
  const box = sandbox();
  const { status, output } = box.run(["implement", PLAN_DIR]);

  assert.equal(status, 0, output);
  assert.match(output, /Tests passed/);
  assert.match(output, /Draft PR: https:\/\/github\.com\/acme\/app\/pull\/1/);
  assert.equal(box.git("branch", "--show-current"), BRANCH);
  assert.equal(box.git("log", "-1", "--format=%s"), "Add a feature (#12)");
  assert.deepEqual(box.git("show", "--name-only", "--format=", "HEAD").split("\n"), ["feature.ts"]);
  assert.ok(remoteHas(box, BRANCH));

  const [createArgs] = readFileSync(join(box.state, "gh-create-calls"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(createArgs.includes("--draft"));
  const body = readFileSync(join(box.repo, PLAN_DIR, "PR.md"), "utf8");
  assert.match(body, /Closes #12/);
  assert.match(body, /`echo all tests ok` ✅ passed/);
  assert.match(body, /Added feature\.ts\./);
});

test("implement --dry-run commits locally without pushing or opening a PR", () => {
  const box = sandbox();
  const { status, output } = box.run(["implement", PLAN_DIR, "--dry-run"]);

  assert.equal(status, 0, output);
  assert.match(output, /Dry run: committed on ticket2pr\/issue-12/);
  assert.equal(box.git("rev-list", "--count", "main..HEAD"), "1");
  assert.ok(!remoteHas(box, BRANCH));
  assert.equal(box.count("gh-create-calls"), 0);
});

test("implement refuses to start with uncommitted changes", () => {
  const box = sandbox();
  writeFileSync(join(box.repo, "stray.txt"), "wip\n");
  const { status, output } = box.run(["implement", PLAN_DIR]);

  assert.equal(status, 1);
  assert.match(output, /uncommitted changes/);
  assert.equal(box.count("claude-calls"), 0);
  assert.equal(box.git("branch", "--show-current"), "main");
});

test("implement says so when the agent changes nothing", () => {
  const box = sandbox();
  const { status, output } = box.run(["implement", PLAN_DIR], { FAKE_CLAUDE: "nothing" });

  assert.equal(status, 1);
  assert.match(output, /The agent made no changes/);
});

test("implement runs the agent again if it crashed partway", () => {
  const box = sandbox();
  assert.equal(box.run(["implement", PLAN_DIR], { FAKE_CLAUDE: "crash" }).status, 1);

  const { status, output } = box.run(["implement", PLAN_DIR]);
  assert.equal(status, 0, output);
  assert.match(output, /earlier run didn't finish, so implementing the plan again/);
  assert.equal(box.count("claude-calls"), 2);
  assert.equal(box.count("gh-create-calls"), 1);
});

test("implement reuses the agent's work if the commit failed", () => {
  const box = sandbox();
  const hook = join(box.repo, ".git/hooks/pre-commit");
  writeFileSync(hook, "#!/bin/sh\necho 'lint failed' >&2\nexit 1\n");
  chmodSync(hook, 0o755);
  const first = box.run(["implement", PLAN_DIR]);
  assert.equal(first.status, 1, first.output);
  assert.equal(box.git("rev-list", "--count", "main..HEAD"), "0");

  rmSync(hook);
  const { status, output } = box.run(["implement", PLAN_DIR]);
  assert.equal(status, 0, output);
  assert.match(output, /Reusing the agent's work/);
  assert.equal(box.count("claude-calls"), 1);
  assert.ok(remoteHas(box, BRANCH));
});

test("implement reuses the agent's work if the push failed, even from another branch", () => {
  const box = sandbox();
  box.git("remote", "set-url", "origin", join(box.state, "missing.git"));
  assert.equal(box.run(["implement", PLAN_DIR]).status, 1);

  box.git("remote", "set-url", "origin", box.remote);
  box.git("checkout", "-q", "main");
  const { status, output } = box.run(["implement", PLAN_DIR]);
  assert.equal(status, 0, output);
  assert.match(output, /Reusing the agent's work/);
  assert.equal(box.count("claude-calls"), 1);
  assert.equal(box.git("rev-list", "--count", "main..HEAD"), "1");
  assert.ok(remoteHas(box, BRANCH));
});

test("implement opens the PR on a second run if gh failed, and never opens two", () => {
  const box = sandbox();
  writeFileSync(join(box.state, "fail-create"), "");
  const first = box.run(["implement", PLAN_DIR]);
  assert.equal(first.status, 1);
  assert.match(first.output, /network down/);
  assert.ok(remoteHas(box, BRANCH));

  rmSync(join(box.state, "fail-create"));
  const second = box.run(["implement", PLAN_DIR]);
  assert.equal(second.status, 0, second.output);
  assert.match(second.output, /Draft PR:/);

  const third = box.run(["implement", PLAN_DIR]);
  assert.equal(third.status, 0, third.output);
  assert.match(third.output, /PR already open: https:\/\/github\.com\/acme\/app\/pull\/1/);
  assert.equal(box.count("claude-calls"), 1);
  assert.equal(box.count("gh-create-calls"), 1);
});

test("implement stops before pushing when the tests fail, and finishes once they pass", () => {
  // Fails while .ticket2pr/broken exists. .ticket2pr/ is ignored, so toggling it leaves the tree clean.
  const box = sandbox("test ! -e .ticket2pr/broken || (echo 1 test failed; exit 1)");
  writeFileSync(join(box.repo, ".ticket2pr/broken"), "");
  const first = box.run(["implement", PLAN_DIR]);

  assert.equal(first.status, 1);
  assert.match(first.output, /Tests FAILED/);
  assert.match(first.output, /1 test failed/);
  assert.match(first.output, /nothing was pushed and no PR was opened/);
  assert.equal(box.git("rev-list", "--count", "main..HEAD"), "1");
  assert.ok(!remoteHas(box, BRANCH));
  assert.equal(box.count("gh-create-calls"), 0);

  rmSync(join(box.repo, ".ticket2pr/broken"));
  const second = box.run(["implement", PLAN_DIR]);
  assert.equal(second.status, 0, second.output);
  assert.match(second.output, /Tests passed/);
  assert.match(second.output, /Draft PR:/);
  assert.equal(box.count("claude-calls"), 1);
  assert.match(readFileSync(join(box.repo, PLAN_DIR, "PR.md"), "utf8"), /✅ passed/);
});
