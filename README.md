# ticket2pr

Turn a ticket into an implementation plan you can review, then into a draft pull request.

Most "AI writes your PR" tools go straight from ticket to code. ticket2pr stops in the middle. The agent explores your repo read-only and writes a plan, with the files it'll touch, the tests it'll add, the risks it sees, and the questions it couldn't answer on its own. You read and edit that plan. Only then does it write code, on a fresh branch, and open a **draft** PR with the approved plan and honest test results attached.

The checkpoint is the point: reviewing a plan takes two minutes, and catching a wrong approach there is much cheaper than catching it in a 400-line diff.

## Requirements

- Node 20+
- [Claude Code](https://docs.claude.com/en/docs/claude-code/overview), installed and logged in (`claude` on your PATH)
- [GitHub CLI](https://cli.github.com/), authenticated (`gh auth login`), for issues and PRs

## Install

```sh
git clone <this repo> && cd ticket2pr
npm install && npm run build && npm link
```

## Usage

From the root of the repo you want to change:

```sh
# 1. Plan. Reads the repo, changes nothing.
ticket2pr plan 12                 # a GitHub issue number
ticket2pr plan https://github.com/you/repo/issues/12
ticket2pr plan tickets/dark-mode.md   # or a markdown file

# 2. Review. Edit .ticket2pr/issue-12/PLAN.md and answer its open questions.

# 3. Implement. New branch, tests, draft PR.
ticket2pr implement .ticket2pr/issue-12
ticket2pr implement .ticket2pr/issue-12 --dry-run   # commit locally, no push or PR
```

Add `.ticket2pr/` to your `.gitignore`. ticket2pr never commits it either way.

## Configuration

Optional `ticket2pr.config.json` in the target repo:

```json
{
  "baseBranch": "main",
  "branchPrefix": "ticket2pr/",
  "testCommand": "npm test"
}
```

Set `testCommand` if you can. The agent is allowed to run exactly that command and nothing else, and ticket2pr runs it again itself afterwards, so the PR reports what actually happened rather than what the agent says happened.

## Customizing the prompts

The prompts are plain markdown in [`prompts/`](prompts/). To tune them for one repo, copy either file into that repo's `.ticket2pr/prompts/` and edit it there. Placeholders like `{{ticket}}` are filled in at run time; a typo in a placeholder is an error, not silent garbage.

## What the agent can do

| Step | Tools | Edits files? |
| --- | --- | --- |
| `plan` | Read, Grep, Glob | No |
| `implement` | Read, Grep, Glob, Edit, Write, and your `testCommand` | Yes, on a new branch |

No git, no network, no arbitrary shell. ticket2pr does branching, committing and pushing itself.

## Possible extensions

Not planned, just noted: a GitHub Action triggered by a label, Notion/Linear/Jira ticket sources, other agent runtimes.

## License

MIT
