import { existsSync, readFileSync } from "node:fs";

export interface Config {
  /** Branch the draft PR targets. */
  baseBranch: string;
  /** Prefix for branches this tool creates. */
  branchPrefix: string;
  /** Command that runs the repo's tests, e.g. "npm test". Optional but strongly recommended. */
  testCommand?: string;
}

export const DEFAULT_CONFIG: Config = {
  baseBranch: "main",
  branchPrefix: "ticket2pr/",
};

export const CONFIG_FILE = "ticket2pr.config.json";

export function loadConfig(path = CONFIG_FILE): Config {
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  const userConfig = JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  return { ...DEFAULT_CONFIG, ...userConfig };
}
