import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { execFileSync } from "node:child_process";

export interface Ticket {
  /** Short, filesystem-safe id, e.g. "issue-12" or "add-dark-mode". */
  id: string;
  title: string;
  body: string;
  /** Present for GitHub issues; used to link the PR back to the issue. */
  issueNumber?: number;
  url?: string;
}

export type Source =
  | { kind: "file"; path: string }
  | { kind: "issue"; ref: string };

const ISSUE_URL = /github\.com\/[^/]+\/[^/]+\/issues\/\d+/;

/** Work out whether the user pointed us at a markdown file or a GitHub issue. */
export function parseSource(source: string, fileExists = existsSync): Source {
  if (fileExists(source)) return { kind: "file", path: source };
  if (/^#?\d+$/.test(source)) return { kind: "issue", ref: source.replace("#", "") };
  if (ISSUE_URL.test(source)) return { kind: "issue", ref: source };
  throw new Error(`"${source}" isn't a file, an issue number, or a GitHub issue URL.`);
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

export function loadTicket(source: Source): Ticket {
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
