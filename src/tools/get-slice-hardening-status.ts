import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const getSliceHardeningStatusSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice to inspect"),
});

export type GetSliceHardeningStatusInput = z.infer<typeof getSliceHardeningStatusSchema>;

export function handleGetSliceHardeningStatus(input: GetSliceHardeningStatusInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  const slice = state.slices.find((s) => s.id === input.sliceId);
  if (!slice) {
    return JSON.stringify({ error: `Slice "${input.sliceId}" not found` });
  }

  const isBootstrap = slice.bootstrap === true;

  if (isBootstrap) {
    return JSON.stringify({
      sliceId: input.sliceId,
      status: slice.status,
      bootstrap: true,
      legacyFlow: true,
      hardeningExempt: true,
      nextStep: legacyNextStep(slice.status),
      completionReviews: (slice.completionReviews ?? []).map((r) => ({
        loop: r.loop,
        verdict: r.verdict,
        createdAt: r.createdAt,
        superseded: Boolean(r.supersededByHardeningAt),
      })),
    });
  }

  const requirementsDone = !!slice.requirementsHardening;
  const requirementsHash = slice.requirementsHardening?.acHash ?? null;

  const testsDone = !!slice.testHardening;
  const testsStale =
    testsDone &&
    slice.testHardening!.requirementsAcHash !== requirementsHash;

  const planDone = !!slice.planHardening;
  const planFinalized = slice.planHardening?.finalized === true;
  const planStale =
    planDone &&
    (slice.planHardening!.requirementsAcHash !== requirementsHash ||
      (slice.testHardening &&
        slice.planHardening!.testsHardenedAt !== slice.testHardening.hardenedAt));

  const guard = slice.testFirstGuard ?? null;
  const guardStale =
    guard &&
    slice.baseline &&
    (slice.baseline.commit ?? null) !== guard.baselineCommit;

  return JSON.stringify({
    sliceId: input.sliceId,
    status: slice.status,
    bootstrap: false,
    requirementsHardening: {
      done: requirementsDone,
      acHash: requirementsHash,
    },
    testHardening: {
      done: testsDone,
      stale: !!testsStale,
      hardenedAt: slice.testHardening?.hardenedAt ?? null,
    },
    planHardening: {
      done: planDone,
      finalized: planFinalized,
      stale: !!planStale,
      rounds: slice.planHardening?.rounds.length ?? 0,
      // Surface the plan-hardening archive (populated by cascade re-hardens
      // or sast → completion_fix transitions) so Observer tooling can audit
      // methodology fidelity across cycles, not just the current one. See
      // observations/bugs-found.md bug #3 in the dogfood sandbox.
      previousCycles: (slice.previousPlanHardenings ?? []).length,
      previousCycleSummaries: (slice.previousPlanHardenings ?? []).map((p) => ({
        rounds: p.rounds.length,
        finalized: p.finalized,
        finalizedAt: p.finalizedAt ?? null,
      })),
    },
    testFirstGuard: guard
      ? {
          verdict: guard.guardVerdict,
          stale: !!guardStale,
          testFilesTouched: guard.testFilesTouched.length,
          nonTestFilesTouched: guard.nonTestFilesTouchedBeforeRedEvidence.length,
          lastReason: guard.evidenceReason,
        }
      : null,
    baseline: slice.baseline
      ? {
          commit: slice.baseline.commit,
          capturedAt: slice.baseline.capturedAt,
          hasFileHashes: Boolean(slice.baseline.fileHashes),
        }
      : null,
    completionReviews: (slice.completionReviews ?? [])
      .filter((r) => !r.supersededByHardeningAt)
      .map((r) => ({
        loop: r.loop,
        verdict: r.verdict,
        createdAt: r.createdAt,
        planCompliance: r.planCompliance.verdict,
      })),
    nextStep: nativeNextStep(slice.status, {
      requirementsDone,
      testsDone: testsDone && !testsStale,
      planFinalized: planFinalized && !planStale,
      guardPass: guard?.guardVerdict === "pass" && !guardStale,
    }),
  });
}

function legacyNextStep(status: string): string {
  switch (status) {
    case "pending":
      return "bootstrap slice: legacy flow — transition to red (no hardening required)";
    case "red":
      return "bootstrap slice: write implementation + tests, then status=green";
    case "green":
      return "bootstrap slice: refactor, then status=refactor";
    case "refactor":
      return "bootstrap slice: a2p_run_sast mode=slice, then status=sast";
    case "sast":
      return "bootstrap slice: a2p_completion_review (bootstrap-exempt plan compliance), then status=done";
    case "done":
      return "bootstrap slice: complete. Bootstrap lock will close after this.";
    default:
      return "bootstrap slice: no next step";
  }
}

function nativeNextStep(
  status: string,
  s: {
    requirementsDone: boolean;
    testsDone: boolean;
    planFinalized: boolean;
    guardPass: boolean;
  },
): string {
  switch (status) {
    case "pending":
      if (!s.requirementsDone) return "call a2p_harden_requirements";
      if (!s.testsDone) return "call a2p_harden_tests";
      if (!s.planFinalized) return "call a2p_harden_plan (rounds 1..3), then finalize";
      return "call a2p_update_slice status=ready_for_red";
    case "ready_for_red":
      return "write failing tests (test files only), then call a2p_verify_test_first";
    case "red":
      return "implement until tests pass, then a2p_update_slice status=green";
    case "green":
      return "refactor, then a2p_update_slice status=refactor";
    case "refactor":
      return "a2p_run_sast mode=slice, then a2p_update_slice status=sast";
    case "sast":
      return "call a2p_completion_review";
    case "completion_fix":
      return "fix gaps (tests first), call a2p_verify_test_first, then resume the cycle";
    case "done":
      return "slice complete";
    default:
      return "";
  }
}
