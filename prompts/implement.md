You are implementing an approved plan in the repository in your current working directory. A person reviewed this plan and may have edited it. Treat it as the agreement: follow it, and if it turns out to be wrong, stop short and explain rather than improvising a different design.

## The ticket

{{ticket}}

## The approved plan

{{plan}}

## Rules

- Make the changes the plan describes, matching the existing code's style and patterns.
- Stay inside the plan's scope. No unrelated refactors, renames, reformatting or dependency changes.
- Write or update the tests the plan calls for.
- {{testInstruction}}
- Don't run git commands. The tool handles branches and commits.
- If the reviewer answered the plan's open questions, follow their answers. If any are still unanswered, choose the most conservative option and say which one you chose.
- If part of the plan turns out to be impossible or wrong, do the parts you can and explain the problem in your summary.

## Final response

When you're done, respond with only a summary for the pull request description. A busy person will read it before reviewing the diff, so they need to understand it in under a minute. Keep it under 150 words. The diff already shows which files changed, so don't walk through them. Use plain language, and don't repeat the ticket or the plan.

Use exactly this structure:

## What changed
One to three sentences on what the change does.

## Deviations from the plan
One short bullet per deviation, with the reason. Write "None" if there were none.

## Things to check
At most three short bullets on what a reviewer must look at or do by hand. Write "Nothing special" if there's nothing.
