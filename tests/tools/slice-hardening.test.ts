import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTmpDir,
  cleanTmpDir,
  initWithStateManager,
  parse,
} from "../helpers/setup.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { StateManager } from "../../src/state/state-manager.js";

// These tests exercise the NATIVE flow, so temporarily disable legacy mode.
describe("native slice hardening", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  function setupProject(): StateManager {
    const sm = initWithStateManager(dir, 1);
    return sm;
  }

  function hardenReq(sliceId: string): void {
    handleHardenRequirements({
      projectPath: dir,
      sliceId,
      goal: "test goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1", "AC2"],
    });
  }

  function hardenTestsStep(sliceId: string): void {
    handleHardenTests({
      projectPath: dir,
      sliceId,
      acToTestMap: [
        { ac: "AC1", tests: ["t1"], rationale: "r" },
        { ac: "AC2", tests: ["t2"], rationale: "r" },
      ],
      positiveCases: ["p"],
      negativeCases: ["n"],
      edgeCases: [],
      regressions: [],
      additionalConcerns: [],
      doneMetric: "tests green",
    });
  }

  function hardenPlanFull(sliceId: string): void {
    const finalPlan = {
      touchedAreas: ["area1"],
      expectedFiles: ["src/foo.ts"],
      interfacesToChange: [],
      invariantsToPreserve: [],
      risks: [],
      narrative: "narr",
    };
    handleHardenPlan({
      projectPath: dir,
      sliceId,
      round: 1,
      initialPlan: "p1",
      critique: "c1",
      revisedPlan: "r1",
      improvementsFound: false,
      finalize: true,
      finalPlan,
    });
  }

  it("rejects pending → ready_for_red without any hardening", () => {
    const sm = setupProject();
    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /requirements not hardened/,
    );
  });

  it("rejects pending → ready_for_red with only requirements hardened", () => {
    const sm = setupProject();
    hardenReq("s1");
    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /tests not hardened/,
    );
  });

  it("rejects pending → ready_for_red with requirements + tests but plan not finalized", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    // Only round 1 recorded, no finalize
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "p",
      critique: "c",
      revisedPlan: "r",
      improvementsFound: true,
      finalize: false,
    });
    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /not finalized/,
    );
  });

  it("allows pending → ready_for_red with the full triad", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    hardenPlanFull("s1");
    const state = sm.setSliceStatus("s1", "ready_for_red");
    expect(state.slices[0].status).toBe("ready_for_red");
    expect(state.slices[0].baseline).toBeDefined();
  });

  it("a2p_harden_tests rejects input that doesn't cover every AC", () => {
    setupProject();
    hardenReq("s1");
    const res = parse(
      handleHardenTests({
        projectPath: dir,
        sliceId: "s1",
        acToTestMap: [{ ac: "AC1", tests: ["t"], rationale: "r" }],
        positiveCases: ["p"],
        negativeCases: ["n"],
        edgeCases: [],
        regressions: [],
        additionalConcerns: [],
        doneMetric: "dm",
      }),
    );
    expect(res.error).toMatch(/does not cover acceptance criterion/);
  });

  it("a2p_harden_plan rejects round 2 without round 1", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 2,
        critique: "c",
        revisedPlan: "r",
        improvementsFound: true,
        finalize: false,
      }),
    );
    expect(res.error).toMatch(/out of order/);
  });

  it("a2p_harden_plan rejects finalize=true on round 1 when improvementsFound=true", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p",
        critique: "c",
        revisedPlan: "r",
        improvementsFound: true,
        finalize: true,
        finalPlan: {
          touchedAreas: ["a"],
          expectedFiles: ["f.ts"],
          interfacesToChange: [],
          invariantsToPreserve: [],
          risks: [],
          narrative: "n",
        },
      }),
    );
    expect(res.error).toMatch(/finalize not allowed/);
  });

  it("a2p_harden_plan accepts finalize=true on round 1 when improvementsFound=false", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p",
        critique: "c",
        revisedPlan: "r",
        improvementsFound: false,
        finalize: true,
        finalPlan: {
          touchedAreas: ["a"],
          expectedFiles: ["f.ts"],
          interfacesToChange: [],
          invariantsToPreserve: [],
          risks: [],
          narrative: "n",
        },
      }),
    );
    expect(res.success).toBe(true);
    expect(res.finalized).toBe(true);
  });

  it("a2p_harden_requirements second call clears downstream hardening", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    hardenPlanFull("s1");
    // Second requirements call (different AC)
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "new goal",
      nonGoals: [],
      affectedComponents: ["src/bar.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC-new"],
    });
    const state = sm.read();
    const slice = state.slices[0];
    expect(slice.requirementsHardening).toBeDefined();
    expect(slice.testHardening).toBeUndefined();
    expect(slice.planHardening).toBeUndefined();
  });

  it("a2p_harden_tests rejects integration slice without real-service keyword in additionalConcerns", () => {
    // Setup with an integration slice
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
        id: "int1",
        name: "integration slice",
        description: "integrates X",
        acceptanceCriteria: ["AC1"],
        testStrategy: "integration",
        dependencies: [],
        status: "pending",
        files: [],
        testResults: [],
        sastFindings: [],
        type: "integration",
      },
    ]);
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "int1",
      goal: "test goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
    });
    const res = parse(
      handleHardenTests({
        projectPath: dir,
        sliceId: "int1",
        acToTestMap: [{ ac: "AC1", tests: ["t"], rationale: "r" }],
        positiveCases: ["p"],
        negativeCases: ["n"],
        edgeCases: [],
        regressions: [],
        additionalConcerns: ["mock database"],
        doneMetric: "dm",
      }),
    );
    expect(res.error).toMatch(/real-service/);
  });

  it("B-8: a2p_harden_plan rejects round === 4 explicitly", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    // Round 1
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "p1",
      critique: "c1",
      revisedPlan: "r1",
      improvementsFound: true,
      finalize: false,
    });
    // Round 2
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 2,
      critique: "c2",
      revisedPlan: "r2",
      improvementsFound: true,
      finalize: false,
    });
    // Round 3
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 3,
      critique: "c3",
      revisedPlan: "r3",
      improvementsFound: true,
      finalize: false,
    });
    // Attempt round 4 — rejected by schema (not in union 1|2|3) AND by ordering check.
    // We cast through `any` because the Zod tool input rejects the value at parse time.
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 4 as unknown as 1 | 2 | 3,
        critique: "c4",
        revisedPlan: "r4",
        improvementsFound: false,
        finalize: true,
        finalPlan: {
          touchedAreas: ["a"],
          expectedFiles: ["f.ts"],
          interfacesToChange: [],
          invariantsToPreserve: [],
          risks: [],
          narrative: "n",
        },
      }),
    );
    expect(res.error ?? "").toMatch(/out of order|capped at round 3|round/i);
  });

  it("B-9: a2p_harden_plan finalize=true rejects when finalPlan is missing", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    const res = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p1",
        critique: "c1",
        revisedPlan: "r1",
        improvementsFound: false,
        finalize: true,
        // finalPlan intentionally omitted
      }),
    );
    expect(res.error).toMatch(/requires a structured finalPlan/);
  });

  it("recomputes baseline on ready_for_red → pending → ready_for_red", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    hardenPlanFull("s1");
    sm.setSliceStatus("s1", "ready_for_red");
    const state1 = sm.read();
    const ts1 = state1.slices[0].baseline!.capturedAt;

    sm.setSliceStatus("s1", "pending");
    const state2 = sm.read();
    expect(state2.slices[0].baseline).toBeUndefined();

    // Re-harden and transition again — new baseline timestamp
    sm.setSliceStatus("s1", "ready_for_red");
    const state3 = sm.read();
    expect(state3.slices[0].baseline).toBeDefined();
    expect(state3.slices[0].baseline!.capturedAt >= ts1).toBe(true);
  });

  // Bug #3 regression: cascade re-harden via a2p_harden_requirements must
  // preserve the original plan-hardening rounds in previousPlanHardenings[]
  // so the Observer methodology-fidelity audit can still rate the original
  // critique substance after drift recovery.
  it("archives planHardening to previousPlanHardenings[] on hardenSliceRequirements cascade", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    hardenPlanFull("s1"); // records 1 round and finalizes

    const before = sm.read().slices[0];
    expect(before.planHardening).toBeDefined();
    expect(before.planHardening!.rounds.length).toBe(1);
    const originalCritique = before.planHardening!.rounds[0].critique;
    expect(before.previousPlanHardenings).toBeUndefined();

    // Cascade re-harden with a different AC set
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "revised goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1", "AC2", "AC3"],
    });

    const after = sm.read().slices[0];
    // Working plan-hardening slot is cleared so a fresh round=1 is valid
    expect(after.planHardening).toBeUndefined();
    // But the original plan survives in the archive (newest-first)
    expect(after.previousPlanHardenings).toBeDefined();
    expect(after.previousPlanHardenings!.length).toBe(1);
    expect(after.previousPlanHardenings![0].rounds.length).toBe(1);
    expect(after.previousPlanHardenings![0].rounds[0].critique).toBe(
      originalCritique,
    );
    // Round counter restarts at 1 for the new cycle
    handleHardenTests({
      projectPath: dir,
      sliceId: "s1",
      acToTestMap: [
        { ac: "AC1", tests: ["t1"], rationale: "r" },
        { ac: "AC2", tests: ["t2"], rationale: "r" },
        { ac: "AC3", tests: ["t3"], rationale: "r" },
      ],
      positiveCases: ["p"],
      negativeCases: ["n"],
      edgeCases: [],
      regressions: [],
      additionalConcerns: [],
      doneMetric: "tests green",
    });
    const newRound1 = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p1",
        critique: "c1-new",
        revisedPlan: "r1-new",
        improvementsFound: false,
        finalize: false,
      }),
    );
    expect(newRound1.error).toBeUndefined();
    const withNewRound = sm.read().slices[0];
    expect(withNewRound.planHardening!.rounds.length).toBe(1);
    expect(withNewRound.planHardening!.rounds[0].round).toBe(1);
    expect(withNewRound.planHardening!.rounds[0].critique).toBe("c1-new");
    // Archive still intact
    expect(withNewRound.previousPlanHardenings!.length).toBe(1);
  });

  // Bug #3 regression: cascade via a2p_harden_tests (without re-hardening
  // requirements) also archives the plan instead of wiping.
  it("archives planHardening on hardenSliceTests cascade", () => {
    const sm = setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    hardenPlanFull("s1");

    const originalRoundCount = sm.read().slices[0].planHardening!.rounds.length;
    expect(originalRoundCount).toBeGreaterThan(0);

    // Re-harden tests (same ACs, slightly different mapping)
    handleHardenTests({
      projectPath: dir,
      sliceId: "s1",
      acToTestMap: [
        { ac: "AC1", tests: ["t1-updated"], rationale: "r" },
        { ac: "AC2", tests: ["t2-updated"], rationale: "r" },
      ],
      positiveCases: ["p"],
      negativeCases: ["n"],
      edgeCases: [],
      regressions: [],
      additionalConcerns: [],
      doneMetric: "tests green",
    });

    const after = sm.read().slices[0];
    expect(after.planHardening).toBeUndefined();
    expect(after.previousPlanHardenings).toBeDefined();
    expect(after.previousPlanHardenings!.length).toBe(1);
    expect(after.previousPlanHardenings![0].rounds.length).toBe(originalRoundCount);
  });

  // ─── L2 LGTM-escape-hatch (Phase 3a) ─────────────────────────────────────
  // User-insight: forcing .min(1) on critique makes LLMs invent filler
  // critique on Round 2-3 when nothing real is left. The LGTM literal is an
  // opt-out, guarded against gaming (see state-manager.appendSlicePlanRound).

  const LGTM = "LGTM — no substantive issues on re-review.";

  it("LGTM: accepts on round 2 when plan unchanged and prior round had substantive critique", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    // Round 1: substantive critique
    const r1 = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p",
        critique: "c1 substantive initial critique",
        revisedPlan: "rp1",
        improvementsFound: true,
        finalize: false,
      }),
    );
    expect(r1.success).toBe(true);
    // Round 2: LGTM — unchanged revisedPlan, improvementsFound=false, finalize=true
    const r2 = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 2,
        critique: LGTM,
        revisedPlan: "rp1",
        improvementsFound: false,
        finalize: true,
        finalPlan: {
          touchedAreas: ["a"],
          expectedFiles: ["f.ts"],
          interfacesToChange: [],
          invariantsToPreserve: [],
          risks: [],
          narrative: "n",
        },
      }),
    );
    expect(r2.success).toBe(true);
    expect(r2.finalized).toBe(true);
  });

  it("LGTM: rejects on round 1 (no prior critique possible)", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    const r = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 1,
        initialPlan: "p",
        critique: LGTM,
        revisedPlan: "rp1",
        improvementsFound: false,
        finalize: false,
      }),
    );
    expect(r.error).toMatch(/round 1/i);
  });

  it("LGTM: rejects when improvementsFound is true", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "p",
      critique: "c1 substantive initial critique",
      revisedPlan: "rp1",
      improvementsFound: true,
      finalize: false,
    });
    const r = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 2,
        critique: LGTM,
        revisedPlan: "rp1",
        improvementsFound: true, // contradiction — guard must reject
        finalize: false,
      }),
    );
    expect(r.error).toMatch(/improvementsFound/i);
  });

  it("LGTM: rejects when revisedPlan differs from previous round", () => {
    setupProject();
    hardenReq("s1");
    hardenTestsStep("s1");
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "p",
      critique: "c1 substantive initial critique",
      revisedPlan: "rp1",
      improvementsFound: true,
      finalize: false,
    });
    const r = parse(
      handleHardenPlan({
        projectPath: dir,
        sliceId: "s1",
        round: 2,
        critique: LGTM,
        revisedPlan: "rp2-different", // guard must reject: revisedPlan changed
        improvementsFound: false,
        finalize: false,
      }),
    );
    expect(r.error).toMatch(/bit-identical/i);
  });
});
