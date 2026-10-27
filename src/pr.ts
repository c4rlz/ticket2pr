import type { Ticket } from "./ticket.js";

export interface PrBodyInput {
  ticket: Ticket;
  plan: string;
  agentSummary: string;
  tests: { command: string; passed: boolean; tail: string } | null;
}

/** Build the draft PR description: honest about test results, with the approved plan attached. */
export function buildPrBody({ ticket, plan, agentSummary, tests }: PrBodyInput): string {
  const sections: string[] = [];

  if (ticket.issueNumber) sections.push(`Closes #${ticket.issueNumber}`);
  if (ticket.jiraKey) sections.push(`Jira: [${ticket.jiraKey}](${ticket.url})`);

  sections.push(
    "> Draft by ticket2pr. A human approved the plan; the code hasn't been reviewed yet.",
  );

  sections.push(agentSummary);

  if (tests) {
    // A passing run needs no output. A failing run never opens a PR, but PR.md keeps its output.
    sections.push(
      tests.passed
        ? `## Tests\n\`${tests.command}\` ✅ passed`
        : `## Tests\n\`${tests.command}\` ❌ failed\n\n` +
            `<details><summary>Output (last lines)</summary>\n\n\`\`\`\n${tests.tail}\n\`\`\`\n</details>`,
    );
  } else {
    sections.push("## Tests\nNo test command configured, so tests were not run.");
  }

  sections.push(`<details><summary>Approved plan</summary>\n\n${plan}\n</details>`);

  return sections.join("\n\n") + "\n";
}

/** Jira links a PR to its issue when the key is in the title, so lead with it. */
export function prTitle(ticket: Ticket): string {
  return ticket.jiraKey ? `${ticket.jiraKey}: ${ticket.title}` : ticket.title;
}

export function branchName(prefix: string, ticket: Ticket): string {
  return `${prefix}${ticket.id}`;
}
