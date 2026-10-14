---
name: brief-to-tickets
description: Read a project brief and suggest how to break it into ticket2pr-ready tickets, one pull request each, in the order they should be built, plus the setup work that has to happen by hand before ticket2pr can take over. Once the user approves the breakdown, write each ticket as tickets/NN-slug.md in the target repo. Use this whenever the user has a brief, spec, PRD, project plan or feature list (a Claude Doc link, a markdown file, a Notion page or pasted text) and wants to turn it into tickets, issues, tasks or PR-sized chunks, wants to work through it with ticket2pr, or asks how to split it up, even if they don't name ticket2pr.
---

# Brief to tickets

ticket2pr turns one ticket into a reviewed plan and then a draft PR. It works best on small, well-specified tickets in a repo that already runs. A brief is usually neither of those: it describes a whole project or a big feature. This skill closes that gap. It reads the brief, works out what has to be set up by hand first, and suggests a sequence of tickets that ticket2pr can take on one at a time.

Suggest first, write later. The user approves or edits the breakdown in chat before any file is written.

## 1. Read the brief

- **Claude Doc link** (`claude.ai/.../artifact/...`): read it with the Claude Docs tools, loading the docs skill or guide first if the client asks for that. Don't web-fetch it.
- **Notion page**: fetch it with the Notion tools.
- **File path or pasted text**: read it directly.

Read the whole brief before you start slicing. Briefs often put the real constraints (the stack, what's out of scope, which phase comes first) near the end.

If the brief has phases, such as "Now / Next / Later" or "v1 / v2", ticket only the first phase unless the user asks for more. List the later phases at the end as not ticketed yet. Tickets for far-off work go stale before anyone builds them.

## 2. Look at the target repo

Work out which repo the tickets are for: the current directory, a path the brief names, or ask. Then look at it, read-only:

- Does the repo exist, and does the app actually run, or is it empty?
- Is ticket2pr set up? Check for `ticket2pr.config.json`, its `baseBranch` and `testCommand`, and whether the test command works.
- Is the base branch on GitHub and up to date? ticket2pr branches from it and opens draft PRs against it, so local commits that were never pushed (check `git ls-remote origin` and `git status -sb`) are a setup step. A remote with no commits at all is easy to miss: the repo exists on GitHub but `implement` has nothing to open a PR against.
- What's already built, so you don't ticket work that's already done, and so pointers name real files.

## 3. Separate the setup work from the tickets

ticket2pr's implement agent is deliberately boxed in. It can read and edit files and run the repo's one configured test command. It can't run other shell commands, install packages, use the network or touch git, and its prompt tells it not to change dependencies. So anything that needs one of those has to be done by hand, by the user or by you in a normal session, before the tickets that depend on it:

- Creating the repo, pushing the base branch (with any unpushed commits) and running `ticket2pr init`.
- Scaffolding the app (for example `create-next-app`) so there's something to build on.
- Installing dependencies. If a later ticket needs a new package, say so and list it under that ticket's setup, or group all of them into one setup step at the start.
- A test runner and a passing `testCommand`. Without one, ticket2pr can't report honest test results, which is half its value.
- Databases, extensions, migrations, accounts, API keys and environment variables. Name what's needed, but never ask for secret values or put them in a ticket.

Keep this list short and concrete. It's a checklist the user works through, not a ticket.

## 4. Slice the rest into tickets

Each ticket is one PR that a reviewer could read in one sitting. Aim for each PR to leave the app working and the tests passing.

- **Prefer thin vertical slices.** "Answer a lookup question end to end, with a basic UI" beats "build the database layer". A slice can be tested and demoed on its own, and the next ticket's planner has real code to read.
- **Order by dependency, then by the brief's priorities.** If the brief says what comes first, follow it unless a dependency forces otherwise, and say why if it does.
- **Size check.** If the acceptance criteria run past about six bullets, or the ticket touches several unrelated areas, split it. If two tickets each make no sense without the other, merge them.
- **Make each ticket stand alone.** ticket2pr's agents see the ticket and the repo, never the brief. So copy in, word for word, whatever part of the brief the ticket relies on: the exact questions or user stories it serves, field names, allowed values, the definition of done. Don't write "the brief's seven questions". List them. Repeating a table across several tickets is fine; a planner that has to guess is not.
- **Look for code the ticket could break.** Before you write a ticket that adds, loads or deletes data, read the code it would go through. Watch for writes that replace or delete everything, and anything that touches real user data or an outside service. If the safe design is a choice only the user can make (for example, a separate database for test data), ask before writing the ticket, then state the choice in the ticket as a constraint.
- **Don't invent scope.** Every acceptance criterion should trace back to something in the brief. Where the brief leaves a decision open that the ticket needs settled, write `[TODO: ...]` and list it as an open question. Don't guess.

Write each ticket in ticket2pr's template. Its `check` and `plan` steps treat these sections as binding, so the more specific they are, the less the agent guesses:

```markdown
# <One concrete change, named specifically>

## Context
Why this change, who it's for, and where it fits: what earlier tickets
built that this one builds on.

## Acceptance criteria
- Observable outcomes that a test or a reviewer could confirm.

## Out of scope
- What neighbouring tickets cover ("Embeddings come in ticket 03"). This is
  the best guard against one ticket swallowing the next.

## Pointers
- Files that exist now, or that an earlier ticket creates. Mark those
  ("created in ticket 02") so `ticket2pr check` doesn't flag them as missing
  once they exist.

## Constraints
- Binding rules from the brief: the stack, no new dependencies, patterns to follow.
```

## 5. Present the breakdown

Show it in chat in this order, so the user can judge the shape before reading the details:

1. **Setup first**: the checklist from step 3, or "None, the repo is ready".
2. **Tickets**: a table with number, title, depends on, and one line on what it delivers.
3. **Open questions**: decisions only the user can make, each tied to a ticket.
4. **Not ticketed yet**: later phases, in one line each.
5. **Full ticket drafts.**

Then ask whether to change anything, and whether to write the tickets.

## 6. Write the tickets (after the user says yes)

Write each ticket to `tickets/NN-slug.md` in the target repo, for example `tickets/01-lookup-questions.md`. ticket2pr uses the file name as the ticket's id, so it becomes the branch name (`ticket2pr/01-lookup-questions`) and the working folder (`.ticket2pr/01-lookup-questions/`). Keep slugs short and lowercase. Don't overwrite a file that already exists. If one does, ask.

If the repo doesn't exist yet, write the tickets once the setup has created it, or ask the user where to put them.

Then tell the user how to work through them, one ticket at a time:

```sh
ticket2pr check tickets/01-<slug>.md      # optional: is the ticket ready?
ticket2pr plan tickets/01-<slug>.md       # writes .ticket2pr/01-<slug>/PLAN.md
# review and edit PLAN.md, answer its open questions
ticket2pr implement .ticket2pr/01-<slug>  # branch, tests, draft PR
```

Tell them to merge each PR before planning the next ticket. ticket2pr branches from the base branch and plans against the repo as it is, so ticket 02's plan only sees ticket 01's code once 01 is merged.
