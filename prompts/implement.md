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

When you're done, respond with only a summary for the pull request description, in exactly this structure:

## What changed
A short description of the change, with the main files.

## Deviations from the plan
Anything you did differently from the plan, and why. Write "None" if there were none.

## Things to check
Where a reviewer should look most carefully, and anything you were unsure about.
