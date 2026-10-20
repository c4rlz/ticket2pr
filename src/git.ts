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

export function checkout(name: string): void {
  git("checkout", "-q", name);
}

export function currentBranch(): string {
  return git("branch", "--show-current");
}

export function branchExists(name: string): boolean {
  return tryGit("rev-parse", "--verify", "--quiet", `refs/heads/${name}`) !== undefined;
}

/** How many commits the current branch has that `base` doesn't. */
export function commitsAhead(base: string): number {
  return Number(git("rev-list", "--count", `${base}..HEAD`));
}

export function commitAll(message: string): void {
  // Stage everything, then unstage our workspace. An exclude pathspec can't do this in one step:
  // git add rejects it when .ticket2pr/ is gitignored, which `ticket2pr init` makes the norm.
  git("add", "-A");
  git("reset", "-q", "--", ".ticket2pr");
  git("commit", "-m", message);
}

export function pushBranch(name: string): void {
  git("push", "-u", "origin", name);
}

/** The URL of an open PR for this branch, if there is one. */
export function findOpenPr(head: string): string | undefined {
  try {
    const url = execFileSync(
      "gh",
      ["pr", "list", "--head", head, "--state", "open", "--json", "url", "--jq", ".[0].url // empty"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return url || undefined;
  } catch {
    // If gh can't answer, opening the PR will fail with gh's own error message.
    return undefined;
  }
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

/** Like git(), but returns undefined instead of throwing, and keeps git's stderr quiet. */
function tryGit(...args: string[]): string | undefined {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return undefined;
  }
}

/** The top-level folder of the repo containing the current directory, if any. */
export function repoRoot(): string | undefined {
  return tryGit("rev-parse", "--show-toplevel");
}

/** The remote's default branch if git knows it, otherwise the current branch, otherwise "main". */
export function defaultBranch(): string {
  const remoteHead = tryGit("symbolic-ref", "--short", "refs/remotes/origin/HEAD");
  if (remoteHead) return remoteHead.replace(/^origin\//, "");
  return tryGit("branch", "--show-current") || "main";
}
