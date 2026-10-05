import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { execFileSync } from "node:child_process";
import type { Config } from "./config.js";
import { fetchJiraIssue } from "./jira.js";

export interface Ticket {
  /** Short, filesystem-safe id, e.g. "issue-12" or "add-dark-mode". */
  id: string;
  title: string;
  body: string;
  /** Present for GitHub issues; used to link the PR back to the issue. */
  issueNumber?: number;
  /** Present for Jira issues, e.g. "PROJ-123"; used in the branch and PR title so Jira links them. */
  jiraKey?: string;
  url?: string;
}

export type Source =
  | { kind: "file"; path: string }
  | { kind: "issue"; ref: string }
  | { kind: "jira"; key: string; baseUrl?: string };

const ISSUE_URL = /github\.com\/[^/]+\/[^/]+\/issues\/\d+/;
/** Jira keys are a project key, a dash and a number: PROJ-123. Always upper case in Jira. */
const JIRA_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;
/** A Jira issue link: https://acme.atlassian.net/browse/PROJ-123, or a board link with ?selectedIssue=PROJ-123. */
const JIRA_URL = /^(https?:\/\/[^/?#]+(?:\/[^?#]*?)??)\/(?:browse\/|.*[?&]selectedIssue=)([A-Z][A-Z0-9_]+-\d+)\b/;

/** Work out whether the user pointed us at a markdown file, a GitHub issue or a Jira issue. */
export function parseSource(source: string, fileExists = existsSync): Source {
  if (fileExists(source)) return { kind: "file", path: source };
  if (/^#?\d+$/.test(source)) return { kind: "issue", ref: source.replace("#", "") };
  if (ISSUE_URL.test(source)) return { kind: "issue", ref: source };
  if (JIRA_KEY.test(source)) return { kind: "jira", key: source };
  const jiraUrl = JIRA_URL.exec(source);
  if (jiraUrl) return { kind: "jira", key: jiraUrl[2], baseUrl: jiraUrl[1] };
  throw new Error(`"${source}" isn't a file, a GitHub issue number or URL, or a Jira issue key or URL.`);
}

/** Pull the title from the first "# " heading; everything else is the body. */
export function parseMarkdownTicket(text: string, fallbackTitle: string) {
  const lines = text.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^#\s+\S/.test(line));
  if (headingIndex === -1) return { title: fallbackTitle, body: text.trim() };
  const title = lines[headingIndex].replace(/^#\s+/, "").trim();
  const body = [...lines.slice(0, headingIndex), ...lines.slice(headingIndex + 1)]
    .join("\n")
    .trim();
  return { title, body };
}

export function slugify(text: string, maxLength = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/, "");
}

export async function loadTicket(source: Source, config: Pick<Config, "jira">, env = process.env): Promise<Ticket> {
  if (source.kind === "jira") {
    const baseUrl = source.baseUrl ?? config.jira?.baseUrl ?? env.JIRA_BASE_URL;
    if (!baseUrl) {
      throw new Error(
        `Don't know which Jira site ${source.key} is on. Run "ticket2pr init --jira https://yourcompany.atlassian.net", ` +
          `add "jira": { "baseUrl": ... } to ticket2pr.config.json, or set JIRA_BASE_URL.`,
      );
    }
    return fetchJiraIssue(source.key, baseUrl, { env });
  }

  if (source.kind === "file") {
    const fallback = basename(source.path, extname(source.path));
    const { title, body } = parseMarkdownTicket(readFileSync(source.path, "utf8"), fallback);
    return { id: slugify(fallback) || "ticket", title, body };
  }

  const raw = execFileSync(
    "gh",
    ["issue", "view", source.ref, "--json", "number,title,body,url"],
    { encoding: "utf8" },
  );
  const issue = JSON.parse(raw) as { number: number; title: string; body: string; url: string };
  return {
    id: `issue-${issue.number}`,
    title: issue.title,
    body: issue.body ?? "",
    issueNumber: issue.number,
    url: issue.url,
  };
}

/** The ticket as the agent sees it. */
export function formatTicket(ticket: Ticket): string {
  const link = ticket.url ? `\n\nSource: ${ticket.url}` : "";
  return `# ${ticket.title}\n\n${ticket.body}${link}`;
}
