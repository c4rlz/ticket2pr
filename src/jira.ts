import type { Ticket } from "./ticket.js";

/** A node in Atlassian Document Format, the JSON Jira Cloud uses for rich text. */
export interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, any>;
  marks?: { type: string; attrs?: Record<string, any> }[];
  content?: AdfNode[];
}

interface JiraAuth {
  /** REST API version: 3 on Cloud (descriptions are ADF), 2 on Server/Data Center (descriptions are text). */
  apiVersion: "2" | "3";
  authorization: string;
}

/**
 * Credentials come from the environment so they never end up in a repo.
 * Jira Cloud: JIRA_EMAIL + JIRA_API_TOKEN. Jira Server/Data Center: JIRA_PAT.
 */
export function jiraAuthFromEnv(env: NodeJS.ProcessEnv = process.env): JiraAuth {
  if (env.JIRA_PAT) return { apiVersion: "2", authorization: `Bearer ${env.JIRA_PAT}` };
  if (env.JIRA_EMAIL && env.JIRA_API_TOKEN) {
    const basic = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString("base64");
    return { apiVersion: "3", authorization: `Basic ${basic}` };
  }
  throw new Error(
    "No Jira credentials found. For Jira Cloud, set JIRA_EMAIL and JIRA_API_TOKEN " +
      "(create a token at https://id.atlassian.com/manage-profile/security/api-tokens). " +
      "For Jira Server or Data Center, set JIRA_PAT to a personal access token.",
  );
}

export async function fetchJiraIssue(
  key: string,
  baseUrl: string,
  { env = process.env, fetchImpl = fetch }: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch } = {},
): Promise<Ticket> {
  const base = baseUrl.replace(/\/+$/, "");
  const auth = jiraAuthFromEnv(env);
  const url = `${base}/rest/api/${auth.apiVersion}/issue/${encodeURIComponent(key)}?fields=summary,description`;

  const response = await fetchImpl(url, {
    headers: { Authorization: auth.authorization, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error(`Jira rejected the credentials for ${base} (HTTP ${response.status}). Check your Jira environment variables.`);
  }
  if (response.status === 404) {
    throw new Error(`Jira issue ${key} wasn't found at ${base}, or you don't have access to it.`);
  }
  if (!response.ok) {
    throw new Error(`Jira returned HTTP ${response.status} for ${key}.`);
  }

  const issue = (await response.json()) as { fields: { summary: string; description: AdfNode | string | null } };
  const description = issue.fields.description;
  return {
    id: key,
    title: issue.fields.summary,
    body: typeof description === "string" ? description.trim() : adfToMarkdown(description),
    jiraKey: key,
    url: `${base}/browse/${key}`,
  };
}

/** Convert a Jira Cloud description to markdown, keeping the structure an agent needs. */
export function adfToMarkdown(doc: AdfNode | null | undefined): string {
  return doc ? blocks(doc.content).trim() : "";
}

function blocks(nodes: AdfNode[] = [], separator = "\n\n"): string {
  return nodes.map(block).filter((text) => text !== "").join(separator);
}

function block(node: AdfNode): string {
  switch (node.type) {
    case "paragraph":
      return inline(node.content);
    case "heading":
      return `${"#".repeat(node.attrs?.level ?? 2)} ${inline(node.content)}`;
    case "bulletList":
      return list(node, () => "- ");
    case "orderedList": {
      const start = node.attrs?.order ?? 1;
      return list(node, (i) => `${start + i}. `);
    }
    case "taskList":
      return (node.content ?? [])
        .map((item) => `- [${item.attrs?.state === "DONE" ? "x" : " "}] ${inline(item.content)}`)
        .join("\n");
    case "codeBlock":
      return "```" + (node.attrs?.language ?? "") + "\n" + (node.content ?? []).map((n) => n.text ?? "").join("") + "\n```";
    case "blockquote":
    case "panel":
      return blocks(node.content)
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    case "rule":
      return "---";
    case "table":
      return table(node);
    case "expand":
    case "nestedExpand":
      return [node.attrs?.title ? `**${node.attrs.title}**` : "", blocks(node.content)].filter(Boolean).join("\n\n");
    case "mediaSingle":
    case "mediaGroup":
      return "_(attachment not included)_";
    default:
      return node.content ? blocks(node.content) : inline([node]);
  }
}

function list(node: AdfNode, marker: (index: number) => string): string {
  return (node.content ?? [])
    .map((item, i) => {
      const prefix = marker(i);
      const indent = " ".repeat(prefix.length);
      return blocks(item.content, "\n")
        .split("\n")
        .map((line, j) => (j === 0 ? prefix + line : line ? indent + line : line))
        .join("\n");
    })
    .join("\n");
}

function table(node: AdfNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => blocks(cell.content, " ").replace(/\n/g, " ").replace(/\|/g, "\\|")),
  );
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function inline(nodes: AdfNode[] = []): string {
  return nodes.map(inlineNode).join("");
}

function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case "text":
      return (node.marks ?? []).reduce(applyMark, node.text ?? "");
    case "hardBreak":
      return "\n";
    case "mention":
      return node.attrs?.text ?? "@someone";
    case "emoji":
      return node.attrs?.text ?? node.attrs?.shortName ?? "";
    case "inlineCard":
    case "blockCard":
      return node.attrs?.url ?? "";
    case "status":
      return `[${node.attrs?.text ?? ""}]`;
    case "date":
      return new Date(Number(node.attrs?.timestamp)).toISOString().slice(0, 10);
    default:
      return node.text ?? inline(node.content);
  }
}

function applyMark(text: string, mark: { type: string; attrs?: Record<string, any> }): string {
  switch (mark.type) {
    case "code":
      return `\`${text}\``;
    case "strong":
      return `**${text}**`;
    case "em":
      return `_${text}_`;
    case "strike":
      return `~~${text}~~`;
    case "link":
      return `[${text}](${mark.attrs?.href ?? ""})`;
    default:
      return text;
  }
}
