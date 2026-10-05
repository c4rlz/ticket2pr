import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CONFIG_FILE, DEFAULT_CONFIG, type Config } from "./config.js";

/** The issue form ships with the tool. Compiled code lives in dist/src, so go up two levels. */
const BUILT_IN_ISSUE_FORM = fileURLToPath(new URL("../../.github/ISSUE_TEMPLATE/ticket.yml", import.meta.url));

export const ISSUE_FORM_PATH = join(".github", "ISSUE_TEMPLATE", "ticket.yml");
const WORKSPACE_IGNORE = ".ticket2pr/";

/** What npm puts in a fresh package.json; not a real test command. */
const NPM_PLACEHOLDER_TEST = /no test specified/;

/** Best guess at the command that runs this repo's tests, or undefined if there's no clear answer. */
export function detectTestCommand(dir = "."): string | undefined {
  const has = (path: string) => existsSync(join(dir, path));

  if (has("package.json")) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
    const test = pkg.scripts?.test;
    if (test && !NPM_PLACEHOLDER_TEST.test(test)) return "npm test";
  }

  const usesPytest =
    has("pytest.ini") ||
    has("conftest.py") ||
    (has("pyproject.toml") && readFileSync(join(dir, "pyproject.toml"), "utf8").includes("[tool.pytest")) ||
    (has("setup.cfg") && readFileSync(join(dir, "setup.cfg"), "utf8").includes("[tool:pytest]"));
  if (usesPytest) {
    // Prefer the project's virtualenv, so the agent doesn't need it activated.
    for (const venv of [".venv", "venv"]) {
      if (has(join(venv, "bin", "pytest"))) return `${venv}/bin/pytest`;
    }
    return "pytest";
  }

  if (has("Cargo.toml")) return "cargo test";
  if (has("go.mod")) return "go test ./...";
  if (has("Makefile") && /^test:/m.test(readFileSync(join(dir, "Makefile"), "utf8"))) return "make test";
  return undefined;
}

/** Whether a .gitignore already ignores ticket2pr's workspace folder. */
export function ignoresWorkspace(gitignore: string): boolean {
  return gitignore.split(/\r?\n/).some((line) => /^\/?\.ticket2pr\/?$/.test(line.trim()));
}

/**
 * Set up the current repo for ticket2pr. Never overwrites anything that already exists.
 * Returns one line per step, describing what happened.
 */
export function init(baseBranch: string): string[] {
  const report: string[] = [];

  if (existsSync(ISSUE_FORM_PATH)) {
    report.push(`• ${ISSUE_FORM_PATH} already exists, left alone`);
  } else {
    mkdirSync(dirname(ISSUE_FORM_PATH), { recursive: true });
    copyFileSync(BUILT_IN_ISSUE_FORM, ISSUE_FORM_PATH);
    report.push(`✓ Added the "Ticket" issue form at ${ISSUE_FORM_PATH}`);
  }

  if (existsSync(CONFIG_FILE)) {
    report.push(`• ${CONFIG_FILE} already exists, left alone`);
  } else {
    const testCommand = detectTestCommand();
    const config: Config = { ...DEFAULT_CONFIG, baseBranch, ...(testCommand && { testCommand }) };
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n");
    report.push(`✓ Created ${CONFIG_FILE} (base branch: ${baseBranch})`);
    report.push(
      testCommand
        ? `  Test command: ${testCommand}. Check it's right; the agent may run exactly this and nothing else.`
        : `  Couldn't detect a test command. Add "testCommand" to ${CONFIG_FILE} so the agent can run your tests.`,
    );
  }

  const gitignore = existsSync(".gitignore") ? readFileSync(".gitignore", "utf8") : "";
  if (ignoresWorkspace(gitignore)) {
    report.push(`• .gitignore already ignores ${WORKSPACE_IGNORE}`);
  } else {
    const separator = gitignore === "" || gitignore.endsWith("\n") ? "" : "\n";
    appendFileSync(".gitignore", `${separator}${WORKSPACE_IGNORE}\n`);
    report.push(`✓ Added ${WORKSPACE_IGNORE} to .gitignore`);
  }

  return report;
}
