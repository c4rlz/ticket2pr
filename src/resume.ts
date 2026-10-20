/** What an earlier `implement` run left behind on the ticket's branch. */
export interface BranchState {
  /** The branch existed before this run. */
  exists: boolean;
  /** The branch has uncommitted changes. */
  dirty: boolean;
  /** Commits on the branch that the base branch doesn't have. */
  ahead: number;
  /** The agent finished and wrote SUMMARY.md. */
  hasSummary: boolean;
}

/**
 * Where `implement` picks up. The agent is the slow, expensive step, so a run that
 * crashed after it (in the tests, commit, push or PR) reuses its work rather than
 * asking for new code.
 */
export function resumePoint(state: BranchState): "fresh" | "run-agent" | "after-agent" {
  if (!state.exists) return "fresh";
  if (state.hasSummary && (state.dirty || state.ahead > 0)) return "after-agent";
  // The agent crashed partway, or finished without changing anything: run it again.
  return "run-agent";
}
