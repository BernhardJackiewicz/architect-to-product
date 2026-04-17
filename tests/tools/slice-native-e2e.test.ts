import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";
import { StateManager } from "../../src/state/state-manager.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { handleVerifyTestFirst } from "../../src/tools/verify-test-first.js";
import { handleCompletionReview } from "../../src/tools/completion-review.js";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

/**
 * End-to-end test that walks a non-bootstrap slice through the full native
 * flow using the REAL tool handlers, not the seeding helpers. Proves the
 * Slice 0 infrastructure actually composes.
 */
describe("native flow end-to-end (real tools)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-e2e-native");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  function setupProject(): StateManager {
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
        name: "slice1",
        description: "d",
        acceptanceCriteria: ["AC1"],
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

  function hardenFully(): void {
    // plan.interfacesToChange=["x"] → api_contracts concern fires →
    // failure_modes piggybacks. Supply both so the v2 gate passes.
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "ship X",
      nonGoals: [],
      affectedComponents: ["src/x.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: [
        {
          concern: "api_contracts",
          applicability: "required",
          justification: "",
          requirement: "x() is exported and used by external callers",
          linkedAcIds: ["AC1"],
        },
        {
          concern: "failure_modes",
          applicability: "required",
          justification: "",
          requirement: "invalid inputs produce a typed error",
          linkedAcIds: ["AC1"],
        },
      ],
    });
    handleHardenTests({
      projectPath: dir,
      sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"],
      negativeCases: ["n"],
      edgeCases: [],
      regressions: [],
      additionalConcerns: [],
      doneMetric: "tests green",
      systemsConcernTests: [
        { concern: "api_contracts", testNames: ["t1"], evidenceType: "contract", rationale: "covers x() signature" },
        { concern: "failure_modes", testNames: ["t1"], evidenceType: "negative", rationale: "covers invalid input" },
      ],
    });
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "plan 1",
      critique: "c",
      revisedPlan: "p1",
      improvementsFound: false,
      finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        expectedFiles: ["src/x.ts", "tests/x.test.ts"],
        interfacesToChange: ["x"],
        invariantsToPreserve: [],
        risks: [],
        narrative: "small narrative",
        systemsConcernPlans: [
          { concern: "api_contracts", approach: "export const x = 1", filesTouched: ["src/x.ts"], rollbackStrategy: null },
          { concern: "failure_modes", approach: "throw TypeError on non-number input", filesTouched: ["src/x.ts"], rollbackStrategy: null },
        ],
      },
    });
  }

  it("walks pending → ready_for_red → red → green → refactor → sast → done", () => {
    const sm = setupProject();
    hardenFully();
    sm.setSliceStatus("s1", "ready_for_red");

    // Write a failing test, verify guard, red
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// failing test\n");
    const g = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(g.guardVerdict).toBe("pass");

    sm.setSliceStatus("s1", "red");

    // Write implementation, record passing test, transition green
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const x = 42;\n");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "test",
      exitCode: 0,
      passed: 1,
      failed: 0,
      skipped: 0,
      output: "pass",
    });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "test",
      exitCode: 0,
      passed: 1,
      failed: 0,
      skipped: 0,
      output: "pass",
    });

    // Completion review
    const rev = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        acCoverage: [{ ac: "AC1", status: "met", evidence: "tests/x.test.ts covers AC1" }],
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
        systemsConcernReviews: [
          { concern: "api_contracts", verdict: "satisfied", evidence: "src/x.ts exports x", shortfall: "" },
          { concern: "failure_modes", verdict: "satisfied", evidence: "tests/x.test.ts covers error path", shortfall: "" },
        ],
      }),
    );
    expect(rev.success).toBe(true);
    expect(rev.verdict).toBe("COMPLETE");

    const final = sm.setSliceStatus("s1", "done");
    expect(final.slices[0].status).toBe("done");
    expect(final.slices[0].completionReviews?.length).toBe(1);
    expect(final.slices[0].completionReviews?.[0].verdict).toBe("COMPLETE");
  });

  it("NOT_COMPLETE review sends slice to completion_fix and requires a fresh guard to return to red", () => {
    const sm = setupProject();
    hardenFully();
    sm.setSliceStatus("s1", "ready_for_red");

    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// failing test\n");
    handleVerifyTestFirst({
      projectPath: dir,
      sliceId: "s1",
      testCommand: "exit 1",
    });
    sm.setSliceStatus("s1", "red");

    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const x = 42;\n");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "test",
      exitCode: 0,
      passed: 1,
      failed: 0,
      skipped: 0,
      output: "pass",
    });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "test",
      exitCode: 0,
      passed: 1,
      failed: 0,
      skipped: 0,
      output: "pass",
    });

    // NOT_COMPLETE review
    const rev = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        acCoverage: [{ ac: "AC1", status: "partial", evidence: "only happy path" }],
        testCoverageQuality: "shallow",
        missingFunctionality: [],
        missingTests: ["error cases"],
        missingEdgeCases: [],
        missingIntegrationWork: [],
        missingCleanupRefactor: [],
        missingPlanFixes: [],
        shortcutsOrStubs: [],
        stubJustifications: [],
        verdict: "NOT_COMPLETE",
        nextActions: ["add error-case tests"],
      }),
    );
    expect(rev.success).toBe(true);
    expect(rev.verdict).toBe("NOT_COMPLETE");

    // Transition to completion_fix (refreshes baseline, clears guard)
    sm.setSliceStatus("s1", "completion_fix");
    const afterFix = sm.read();
    expect(afterFix.slices[0].status).toBe("completion_fix");
    expect(afterFix.slices[0].testFirstGuard).toBeUndefined();

    // Attempting to transition to red without a fresh guard is rejected.
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /test-first guard not verified|verdict is "fail"/i,
    );

    // Commit the intermediate fix so the next diff is clean relative to the
    // refreshed baseline, then write a new failing test and re-verify.
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "pre-fix snapshot", "-q"]);
    // The refreshed baseline was captured before this commit — re-capture by
    // dropping back to pending and re-entering ready_for_red so the helper
    // captures the new HEAD.
    // (Completion_fix baseline freshness under intermediate commits is a
    // Slice 2 refinement — we validate the transition is re-gated.)
  });
});
