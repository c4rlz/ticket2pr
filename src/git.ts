import { execFileSync, spawnSync } from "node:child_process";

/** Our working files live in .ticket2pr/, which must never be committed or count as "dirty". */
const EXCLUDE_WORKSPACE = ["--", ".", ":(exclude).ticket2pr"];

export function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

export function hasUncommittedChanges(): boolean {
  return git("status", "--porcelain", ...EXCLUDE_WORKSPACE) !== "";
}

export function createBranch(name: string, base: string): void {
  git("checkout", "-b", name, base);
}

export function commitAll(message: string): void {
  git("add", "-A", ...EXCLUDE_WORKSPACE);
  git("commit", "-m", message);
}

export function pushBranch(name: string): void {
  git("push", "-u", "origin", name);
}

export function openDraftPr(opts: { base: string; head: string; title: string; bodyFile: string }): string {
  return execFileSync(
    "gh",
    ["pr", "create", "--draft", "--base", opts.base, "--head", opts.head,
      "--title", opts.title, "--body-file", opts.bodyFile],
    { encoding: "utf8" },
  ).trim();
}

/** Run the repo's own test command and keep the tail of the output for the PR description. */
export function runTests(command: string): { passed: boolean; tail: string } {
  const result = spawnSync(command, { shell: true, encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().split("\n");
  return { passed: result.status === 0, tail: output.slice(-40).join("\n") };
}
