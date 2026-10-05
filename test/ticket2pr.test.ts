import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMarkdownTicket, parseSource, slugify } from "../src/ticket.js";
import { render } from "../src/prompts.js";
import { branchName, buildPrBody } from "../src/pr.js";

const noFiles = () => false;

test("parseSource recognises issue numbers, URLs and files", () => {
  assert.deepEqual(parseSource("12", noFiles), { kind: "issue", ref: "12" });
  assert.deepEqual(parseSource("#12", noFiles), { kind: "issue", ref: "12" });
  const url = "https://github.com/carly/garden-app/issues/7";
  assert.deepEqual(parseSource(url, noFiles), { kind: "issue", ref: url });
  assert.deepEqual(parseSource("ticket.md", () => true), { kind: "file", path: "ticket.md" });
  assert.throws(() => parseSource("not-a-thing", noFiles));
});

test("parseMarkdownTicket takes the first heading as the title", () => {
  const { title, body } = parseMarkdownTicket("# Add dark mode\n\n## Context\nIt's bright.", "x");
  assert.equal(title, "Add dark mode");
  assert.equal(body, "## Context\nIt's bright.");
});

test("parseMarkdownTicket falls back when there is no heading", () => {
  const { title, body } = parseMarkdownTicket("Just some text", "fallback");
  assert.equal(title, "fallback");
  assert.equal(body, "Just some text");
});

test("slugify makes safe, short ids", () => {
  assert.equal(slugify("Add Dark Mode!"), "add-dark-mode");
  assert.equal(slugify("  --weird__name--  "), "weird-name");
  assert.ok(slugify("a".repeat(100)).length <= 40);
});

test("render fills placeholders and rejects unknown ones", () => {
  assert.equal(render("Hi {{name}}", { name: "Carly" }), "Hi Carly");
  assert.throws(() => render("Hi {{nmae}}", { name: "Carly" }), /nmae/);
});

test("buildPrBody links the issue, reports tests honestly and includes the plan", () => {
  const ticket = { id: "issue-3", title: "Fix bug", body: "", issueNumber: 3 };
  const body = buildPrBody({
    ticket,
    plan: "# Plan: Fix bug",
    agentSummary: "## What changed\nFixed it.",
    tests: { command: "npm test", passed: false, tail: "1 failing" },
  });
  assert.match(body, /Closes #3/);
  assert.match(body, /❌ failed/);
  assert.match(body, /# Plan: Fix bug/);
  assert.equal(branchName("ticket2pr/", ticket), "ticket2pr/issue-3");
});

test("buildPrBody says so when no tests were run", () => {
  const body = buildPrBody({
    ticket: { id: "x", title: "x", body: "" },
    plan: "plan",
    agentSummary: "summary",
    tests: null,
  });
  assert.match(body, /tests were not run/);
  assert.doesNotMatch(body, /Closes/);
});
