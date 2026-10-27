/** A command line that's been checked: known command, known flags, the right number of arguments. */
export type Command =
  | { name: "help" }
  | { name: "init"; jira?: string }
  | { name: "check"; ticket: string }
  | { name: "plan"; ticket: string }
  | { name: "implement"; dir: string; dryRun: boolean };

/** A mistake in how ticket2pr was called, as opposed to something going wrong while it ran. */
export class UsageError extends Error {}

const COMMANDS = {
  init: { flags: ["--jira"], argument: undefined },
  check: { flags: [], argument: "a ticket" },
  plan: { flags: [], argument: "a ticket" },
  implement: { flags: ["--dry-run"], argument: "a plan folder, e.g. .ticket2pr/issue-12" },
} as const satisfies Record<string, { flags: readonly string[]; argument?: string }>;

/** Flags that take a value, as `--flag value` or `--flag=value`. */
const TAKES_VALUE = new Set(["--jira"]);

/**
 * Parse argv strictly. A mistyped flag like `--dryrun` must be an error, never silently ignored:
 * ignoring it would push and open a real PR when you asked for a dry run.
 */
export function parseArgs(argv: string[]): Command {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") return { name: "help" };
  if (!(name in COMMANDS)) throw new UsageError(`Unknown command "${name}".`);
  const spec = COMMANDS[name as keyof typeof COMMANDS];
  if (rest.includes("--help") || rest.includes("-h")) return { name: "help" };

  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }
    const [flag, inlineValue] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, undefined];
    if (!(spec.flags as readonly string[]).includes(flag)) {
      const known = spec.flags.length ? ` It takes: ${spec.flags.join(", ")}.` : " It takes no options.";
      throw new UsageError(`${name} doesn't know the option ${flag}.${known}`);
    }
    if (TAKES_VALUE.has(flag)) {
      const value = inlineValue ?? rest[++i];
      if (value === undefined || value === "" || value.startsWith("-")) throw new UsageError(`${flag} needs a value.`);
      flags.set(flag, value);
    } else {
      if (inlineValue !== undefined) throw new UsageError(`${flag} doesn't take a value.`);
      flags.set(flag, true);
    }
  }

  if (!spec.argument) {
    if (positionals.length) throw new UsageError(`${name} doesn't take an argument, but got "${positionals[0]}".`);
  } else if (positionals.length !== 1) {
    throw new UsageError(
      positionals.length ? `${name} takes one argument, but got ${positionals.length}.` : `${name} needs ${spec.argument}.`,
    );
  }

  if (name === "init") return { name, jira: flags.get("--jira") as string | undefined };
  if (name === "implement") return { name, dir: positionals[0], dryRun: flags.has("--dry-run") };
  return { name, ticket: positionals[0] } as Command;
}
