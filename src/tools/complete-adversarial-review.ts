import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const completeAdversarialReviewSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  findingsRecorded: z.number().int().min(0).describe("Number of adversarial-review findings recorded via a2p_record_finding (0 if codebase is too small/trivial)"),
  note: z.string().optional().describe("Brief summary of the adversarial review (e.g. 'reviewed auth, payments, API routes — 2 findings recorded')"),
});

export type CompleteAdversarialReviewInput = z.infer<typeof completeAdversarialReviewSchema>;

const MAX_ROUND_HISTORY_IN_OUTPUT = 5;

export function handleCompleteAdversarialReview(input: CompleteAdversarialReviewInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.completeAdversarialReview(input.findingsRecorded, input.note);
    const reviewState = state.adversarialReviewState!;

    // Aggregate all adversarial-review findings from all slices + project-level for deduplication
    const previousFindings = [
      ...state.slices.flatMap(s => s.sastFindings),
      ...state.projectFindings,
    ].filter(f => f.tool === "adversarial-review")
      .map(f => ({
        title: f.title,
        file: f.file,
        severity: f.severity,
        round: findRoundForFinding(f.id, reviewState),
      }));

    // Round history for output: last N rounds fully, older as summary
    const fullHistory = reviewState.roundHistory;
    let roundHistory: unknown[];
    let olderSummary: string | undefined;
    if (fullHistory.length > MAX_ROUND_HISTORY_IN_OUTPUT) {
      const older = fullHistory.slice(0, fullHistory.length - MAX_ROUND_HISTORY_IN_OUTPUT);
      const olderFindings = older.reduce((sum, r) => sum + r.findingsRecorded, 0);
      olderSummary = `... and ${older.length} earlier round(s) with ${olderFindings} finding(s)`;
      roundHistory = fullHistory.slice(-MAX_ROUND_HISTORY_IN_OUTPUT);
    } else {
      roundHistory = fullHistory;
    }

    const hint = `Adversarial review Runde ${reviewState.round} abgeschlossen. ` +
      `${input.findingsRecorded} neue Finding(s) in dieser Runde, ` +
      `${reviewState.totalFindingsRecorded} Findings insgesamt ueber ${reviewState.round} Runde(n). ` +
      `Jede weitere Runde kann zusaetzliche Schwachstellen aufdecken — besonders bei Business Logic und Chained Vulnerabilities. Noch eine Runde?`;

    return JSON.stringify({
      success: true,
      currentRound: reviewState.round,
      thisRoundFindings: input.findingsRecorded,
      totalFindingsRecorded: reviewState.totalFindingsRecorded,
      completedAt: reviewState.completedAt,
      previousFindings,
      roundHistory,
      ...(olderSummary ? { olderRoundsSummary: olderSummary } : {}),
      note: input.note ?? null,
      hint,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** Match a finding to its round by comparing finding ID patterns or falling back to current round */
function findRoundForFinding(findingId: string, reviewState: { round: number; roundHistory: Array<{ round: number; completedAt: string }> }): number {
  // Findings don't have timestamps, so we use a simple heuristic:
  // If there's only one round so far, all findings belong to it.
  // Otherwise, return the current round as default (findings just recorded belong to current round).
  // This is a best-effort — the primary dedup is by title+file, not by round.
  return reviewState.round;
}
