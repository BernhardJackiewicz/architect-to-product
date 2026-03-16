import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const completeAdversarialReviewSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  findingsRecorded: z.number().int().min(0).describe("Number of adversarial-review findings recorded via a2p_record_finding (0 if codebase is too small/trivial)"),
  note: z.string().optional().describe("Brief summary of the adversarial review (e.g. 'reviewed auth, payments, API routes — 2 findings recorded')"),
});

export type CompleteAdversarialReviewInput = z.infer<typeof completeAdversarialReviewSchema>;

export function handleCompleteAdversarialReview(input: CompleteAdversarialReviewInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.completeAdversarialReview(input.findingsRecorded, input.note);
    return JSON.stringify({
      success: true,
      completedAt: state.adversarialReviewCompletedAt,
      findingsRecorded: input.findingsRecorded,
      note: input.note ?? null,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
