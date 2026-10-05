import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Prompts that ship with the tool. Compiled code lives in dist/src, so go up two levels. */
const BUILT_IN_DIR = fileURLToPath(new URL("../../prompts/", import.meta.url));

/** Drop a file with the same name here to override a built-in prompt for one repo. */
export const OVERRIDE_DIR = join(".ticket2pr", "prompts");

export function loadPrompt(name: "plan" | "implement"): string {
  const override = join(OVERRIDE_DIR, `${name}.md`);
  const path = existsSync(override) ? override : join(BUILT_IN_DIR, `${name}.md`);
  return readFileSync(path, "utf8");
}

/** Replace {{key}} placeholders. Unknown placeholders are an error, so typos never reach the agent. */
export function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`Prompt uses {{${key}}} but no value was provided.`);
    return vars[key];
  });
}
