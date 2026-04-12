import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTmpDir,
  cleanTmpDir,
  parse,
  addPassingTests,
  addSastEvidence,
  seedSliceHardening,
  seedPassingGuard,
} from "../helpers/setup.js";
import { StateManager } from "../../src/state/state-manager.js";
import { handleCompletionReview } from "../../src/tools/completion-review.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";

function initSingleSlice(dir: string): StateManager {
  const sm = new StateManager(dir);
  sm.init("t", dir);
  sm.setArchitecture({
    name: "T",
    description: "t",
    techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
    features: ["f"],
    dataModel: "n",
    apiDesign: "REST",
    raw: "",
  });
  sm.setSlices([
    {
      id: "s1",
      name: "s",
      description: "d",
      acceptanceCriteria: ["AC1", "AC2"],
      testStrategy: "unit",
      dependencies: [],
      status: "pending",
      files: [],
      testResults: [],
      sastFindings: [],
    },
  ]);
  return sm;
}

function walkToSast(sm: StateManager, sliceId: string, dir: string): void {
  seedSliceHardening(sm, sliceId);
  sm.setSliceStatus(sliceId, "ready_for_red");
  seedPassingGuard(sm, sliceId);
  sm.setSliceStatus(sliceId, "red");
  addPassingTests(sm, sliceId);
  sm.setSliceStatus(sliceId, "green");
  sm.setSliceStatus(sliceId, "refactor");
  addSastEvidence(sm, sliceId);
  sm.setSliceStatus(sliceId, "sast");
  addPassingTests(sm, sliceId);
}

function fullReviewInput(overrides: Partial<any> = {}): any {
  return {
    acCoverage: [
      { ac: "AC1", status: "met", evidence: "e" },
      { ac: "AC2", status: "met", evidence: "e" },
    ],
    testCoverageQuality: "deep",
    missingFunctionality: [],
    missingTests: [],
    missingEdgeCases: [],
    missingIntegrationWork: [],
    missingCleanupRefactor: [],
    missingPlanFixes: [],
    shortcutsOrStubs: [],
    stubJustifications: [],
    verdict: "COMPLETE",
    nextActions: [],
    ...overrides,
  };
}

describe("slice completion review", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-review");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("sast → done is rejected without a completion review", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /without a COMPLETE completion review/,
    );
  });

  it("rejects verdict COMPLETE when an AC is partial", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({
          acCoverage: [
            { ac: "AC1", status: "met", evidence: "e" },
            { ac: "AC2", status: "partial", evidence: "e" },
          ],
        }),
      }),
    );
    expect(res.error).toMatch(/not met/);
  });

  it("rejects verdict COMPLETE when missingTests is non-empty", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({ missingTests: ["need more tests"] }),
      }),
    );
    expect(res.error).toMatch(/missingTests not empty/);
  });

  it("rejects verdict COMPLETE when shortcutsOrStubs is non-empty", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({ shortcutsOrStubs: ["hardcoded"] }),
      }),
    );
    expect(res.error).toMatch(/shortcutsOrStubs not empty/);
  });

  it("rejects verdict COMPLETE when testCoverageQuality is not deep", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({ testCoverageQuality: "shallow" }),
      }),
    );
    expect(res.error).toMatch(/testCoverageQuality/);
  });

  it("rejects acCoverage that omits an AC", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({
          acCoverage: [{ ac: "AC1", status: "met", evidence: "e" }],
        }),
      }),
    );
    expect(res.error).toMatch(/acCoverage/);
  });

  it("rejects NOT_COMPLETE with empty nextActions", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({
          verdict: "NOT_COMPLETE",
          missingTests: ["more tests"],
          nextActions: [],
        }),
      }),
    );
    expect(res.error).toMatch(/nextActions/);
  });

  it("accepts a valid COMPLETE review and allows sast → done", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.verdict).toBe("COMPLETE");
    const state = sm.setSliceStatus("s1", "done");
    expect(state.slices[0].status).toBe("done");
  });

  it("fresh test run after COMPLETE forces a new review before done", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    handleCompletionReview({
      projectPath: dir,
      sliceId: "s1",
      ...fullReviewInput(),
    });
    // Simulate a post-review change: add another passing test
    addPassingTests(sm, "s1");
    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /stale/,
    );
  });

  it("B-4: fresh SAST run after COMPLETE forces a new review before done", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);
    handleCompletionReview({
      projectPath: dir,
      sliceId: "s1",
      ...fullReviewInput(),
    });
    // Simulate a post-review SAST re-run (forces freshness gate to refire)
    addSastEvidence(sm, "s1");
    addPassingTests(sm, "s1");
    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /stale/,
    );
  });

  it("B-7: NOT_COMPLETE → completion_fix refreshes baseline, clears guard, and the old guard no longer satisfies red", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);

    // Submit a NOT_COMPLETE review
    const nc = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput({
          verdict: "NOT_COMPLETE",
          missingTests: ["add edge case coverage"],
          nextActions: ["write additional tests"],
        }),
      }),
    );
    expect(nc.verdict).toBe("NOT_COMPLETE");

    // Transition to completion_fix — baseline refresh + guard cleared
    const afterFix = sm.setSliceStatus("s1", "completion_fix");
    expect(afterFix.slices[0].status).toBe("completion_fix");
    expect(afterFix.slices[0].testFirstGuard).toBeUndefined();
    expect(afterFix.slices[0].baseline).toBeDefined();

    // Attempting to transition completion_fix → red without a fresh guard is rejected
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /test-first guard not verified|guard/i,
    );
  });

  // Bug #1 regression: after drift-triggered NOT_COMPLETE → completion_fix,
  // the current plan-hardening must be archived so the user can start a
  // fresh plan cycle with a2p_harden_plan round=1. Previously this deadlocked
  // because state expected round 4 while the schema only allowed 1-3.
  it("sast → completion_fix archives planHardening and unblocks a fresh round=1 cycle", () => {
    const sm = initSingleSlice(dir);
    walkToSast(sm, "s1", dir);

    // Confirm the seeded hardening left one finalized round in place
    const beforeFix = sm.read().slices[0];
    expect(beforeFix.planHardening).toBeDefined();
    expect(beforeFix.planHardening!.finalized).toBe(true);
    expect(beforeFix.planHardening!.rounds.length).toBe(1);
    const originalRoundCritique = beforeFix.planHardening!.rounds[0].critique;
    expect(beforeFix.previousPlanHardenings).toBeUndefined();

    // Drift-style NOT_COMPLETE (missingPlanFixes forces verdict NOT_COMPLETE;
    // the exact trigger doesn't matter — any NOT_COMPLETE drives the transition).
    handleCompletionReview({
      projectPath: dir,
      sliceId: "s1",
      ...fullReviewInput({
        verdict: "NOT_COMPLETE",
        missingPlanFixes: ["unplanned interface change in finalPlan"],
        nextActions: ["re-plan with correct interfacesToChange"],
      }),
    });

    sm.setSliceStatus("s1", "completion_fix");

    const afterFix = sm.read().slices[0];
    // Plan was archived, not wiped (Bug #3 preservation)
    expect(afterFix.planHardening).toBeUndefined();
    expect(afterFix.previousPlanHardenings).toBeDefined();
    expect(afterFix.previousPlanHardenings!.length).toBe(1);
    expect(afterFix.previousPlanHardenings![0].rounds[0].critique).toBe(
      originalRoundCritique,
    );

    // The unblock: round=1 must now be valid (no "expected round 4" error)
    // AND the new cycle must be finalizable, so the slice can proceed through
    // verify_test_first → red → green → ... → done again.
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "revised plan after drift",
        critique: "new critique round 1",
        revisedPlan: "new revised plan",
        improvementsFound: false,
        finalize: true,
        finalPlan: {
          touchedAreas: ["area1"],
          expectedFiles: ["src/foo.ts"],
          interfacesToChange: ["doFoo"],
          invariantsToPreserve: [],
          risks: [],
          narrative: "post-drift revised plan",
        },
      }),
    );
    expect(res.error).toBeUndefined();

    const afterNewRound = sm.read().slices[0];
    expect(afterNewRound.planHardening!.rounds.length).toBe(1);
    expect(afterNewRound.planHardening!.rounds[0].round).toBe(1);
    expect(afterNewRound.planHardening!.rounds[0].critique).toBe(
      "new critique round 1",
    );
    // The full new cycle completes: finalized=true with a structured finalPlan.
    expect(afterNewRound.planHardening!.finalized).toBe(true);
    expect(afterNewRound.planHardening!.finalPlan.interfacesToChange).toEqual([
      "doFoo",
    ]);
    // And it is internally consistent with the surviving testHardening,
    // so requireHardeningTriad would accept it on a future transition.
    expect(afterNewRound.planHardening!.testsHardenedAt).toBe(
      afterNewRound.testHardening!.hardenedAt,
    );
    // Archive still intact
    expect(afterNewRound.previousPlanHardenings!.length).toBe(1);
  });
});
