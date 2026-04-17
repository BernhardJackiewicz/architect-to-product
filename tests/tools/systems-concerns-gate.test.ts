import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { StateManager } from "../../src/state/state-manager.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { handleVerifyTestFirst } from "../../src/tools/verify-test-first.js";
import { handleCompletionReview } from "../../src/tools/completion-review.js";
import { makeTmpDir, cleanTmpDir } from "../helpers/setup.js";

/**
 * A2P v2 pre-RED and pre-DONE systems-concern gate tests.
 *
 * These exercise the enforcement paths added in state-manager.ts:
 *   - requireSystemsConcernsHardening (pre-RED)
 *   - requireSystemsConcernsReviewed  (pre-DONE)
 *
 * All v1 gates remain active; these tests pick slice shapes that trigger
 * specific concern rules and prove that the corresponding error surfaces.
 */
function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function setupProjectWithApiSlice(dir: string): StateManager {
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
      description: "plain slice",
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

describe("A2P v2 pre-RED gate — requireSystemsConcernsHardening", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-v2-gate");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("blocks ready_for_red when a REQUIRED concern is absent from requirementsHardening", () => {
    const sm = setupProjectWithApiSlice(dir);

    // Plan declares an interfaceChange → api_contracts is REQUIRED.
    // failure_modes piggybacks when any other concern fires.
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "g",
      nonGoals: [],
      affectedComponents: ["src/x.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
      // Missing api_contracts entry on purpose
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
      doneMetric: "dm",
    });
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
        touchedAreas: ["src"],
        expectedFiles: ["src/x.ts"],
        interfacesToChange: ["foo"],
        invariantsToPreserve: [],
        risks: [],
        narrative: "n",
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /systems concern "api_contracts" is REQUIRED.*missing from requirementsHardening/,
    );
  });

  it("blocks ready_for_red when concern is missing from testHardening.systemsConcernTests", () => {
    const sm = setupProjectWithApiSlice(dir);

    const concerns = [
      { concern: "api_contracts" as const, applicability: "required" as const, justification: "", requirement: "x exported", linkedAcIds: ["AC1"] },
      { concern: "failure_modes" as const, applicability: "required" as const, justification: "", requirement: "error path", linkedAcIds: ["AC1"] },
    ];
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: concerns,
    });
    // testHardening.systemsConcernTests OMITTED
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"], edgeCases: [], regressions: [], additionalConcerns: [],
      doneMetric: "dm",
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts"], interfacesToChange: ["foo"],
        invariantsToPreserve: [], risks: [], narrative: "n",
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /systems concern "api_contracts" is REQUIRED.*testHardening\.systemsConcernTests/,
    );
  });

  it("blocks ready_for_red when concern is declared not_applicable but rules mark it REQUIRED", () => {
    const sm = setupProjectWithApiSlice(dir);
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: [
        { concern: "api_contracts", applicability: "not_applicable", justification: "no external callers", requirement: "", linkedAcIds: [] },
        { concern: "failure_modes", applicability: "required", justification: "", requirement: "e", linkedAcIds: ["AC1"] },
      ],
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"], edgeCases: [], regressions: [], additionalConcerns: [],
      doneMetric: "dm",
      systemsConcernTests: [
        { concern: "api_contracts", testNames: ["t1"], evidenceType: "contract", rationale: "r" },
        { concern: "failure_modes", testNames: ["t1"], evidenceType: "negative", rationale: "r" },
      ],
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts"], interfacesToChange: ["foo"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: [
          { concern: "api_contracts", approach: "a", filesTouched: ["src/x.ts"], rollbackStrategy: null },
          { concern: "failure_modes", approach: "b", filesTouched: ["src/x.ts"], rollbackStrategy: null },
        ],
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /declared "not_applicable" but applicability rules mark it REQUIRED/,
    );
  });

  it("allows ready_for_red when every REQUIRED concern has complete entries across all three artifacts", () => {
    const sm = setupProjectWithApiSlice(dir);
    const reqEntries = [
      { concern: "api_contracts" as const, applicability: "required" as const, justification: "", requirement: "x exported", linkedAcIds: ["AC1"] },
      { concern: "failure_modes" as const, applicability: "required" as const, justification: "", requirement: "error path", linkedAcIds: ["AC1"] },
    ];
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: reqEntries,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"], edgeCases: [], regressions: [], additionalConcerns: [],
      doneMetric: "dm",
      systemsConcernTests: [
        { concern: "api_contracts", testNames: ["t1"], evidenceType: "contract", rationale: "r" },
        { concern: "failure_modes", testNames: ["t1"], evidenceType: "negative", rationale: "r" },
      ],
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts"], interfacesToChange: ["foo"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: [
          { concern: "api_contracts", approach: "a", filesTouched: ["src/x.ts"], rollbackStrategy: null },
          { concern: "failure_modes", approach: "b", filesTouched: ["src/x.ts"], rollbackStrategy: null },
        ],
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).not.toThrow();
  });
});

describe("A2P v2 pre-DONE gate — requireSystemsConcernsReviewed", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-v2-gate-done");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  function walkToSast(sm: StateManager): void {
    const reqEntries = [
      { concern: "api_contracts" as const, applicability: "required" as const, justification: "", requirement: "x exported", linkedAcIds: ["AC1"] },
      { concern: "failure_modes" as const, applicability: "required" as const, justification: "", requirement: "error path", linkedAcIds: ["AC1"] },
    ];
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: reqEntries,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"], edgeCases: [], regressions: [], additionalConcerns: [],
      doneMetric: "dm",
      systemsConcernTests: [
        { concern: "api_contracts", testNames: ["t1"], evidenceType: "contract", rationale: "r" },
        { concern: "failure_modes", testNames: ["t1"], evidenceType: "negative", rationale: "r" },
      ],
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts", "tests/x.test.ts"], interfacesToChange: ["x"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: [
          { concern: "api_contracts", approach: "a", filesTouched: ["src/x.ts"], rollbackStrategy: null },
          { concern: "failure_modes", approach: "b", filesTouched: ["src/x.ts"], rollbackStrategy: null },
        ],
      },
    });
    sm.setSliceStatus("s1", "ready_for_red");
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// test\n");
    handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 1" });
    sm.setSliceStatus("s1", "red");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const x = 1;\n");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });
  }

  it("blocks sast → done when completion review is missing a systemsConcernReviews entry", () => {
    const sm = setupProjectWithApiSlice(dir);
    walkToSast(sm);
    // Record review WITHOUT systemsConcernReviews
    handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
    });

    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /completion review is missing systemsConcernReviews entry for REQUIRED concern "api_contracts"/,
    );
  });

  it("blocks sast → done when a concern is verdicted 'unsatisfied'", () => {
    const sm = setupProjectWithApiSlice(dir);
    walkToSast(sm);
    handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
      systemsConcernReviews: [
        { concern: "api_contracts", verdict: "unsatisfied", evidence: "", shortfall: "missing null-check in handler" },
        { concern: "failure_modes", verdict: "satisfied", evidence: "tests/x.test.ts", shortfall: "" },
      ],
    });

    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /systems concern "api_contracts" verdicted "unsatisfied".*missing null-check/,
    );
  });

  it("blocks sast → done when a REQUIRED concern is verdicted 'not_applicable'", () => {
    const sm = setupProjectWithApiSlice(dir);
    walkToSast(sm);
    handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
      systemsConcernReviews: [
        { concern: "api_contracts", verdict: "not_applicable", evidence: "", shortfall: "" },
        { concern: "failure_modes", verdict: "satisfied", evidence: "tests/x.test.ts", shortfall: "" },
      ],
    });

    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /cannot be verdicted "not_applicable" at completion time/,
    );
  });

  it("allows sast → done when every REQUIRED concern is verdicted 'satisfied'", () => {
    const sm = setupProjectWithApiSlice(dir);
    walkToSast(sm);
    handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
      systemsConcernReviews: [
        { concern: "api_contracts", verdict: "satisfied", evidence: "src/x.ts exports x", shortfall: "" },
        { concern: "failure_modes", verdict: "satisfied", evidence: "tests/x.test.ts", shortfall: "" },
      ],
    });

    const state = sm.setSliceStatus("s1", "done");
    expect(state.slices[0].status).toBe("done");
  });
});

describe("A2P v2 bootstrap slices skip the systems-concern gate", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-v2-gate-bootstrap");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("bootstrap slice goes pending → red with no hardening or systems concerns", () => {
    const sm = new StateManager(dir);
    sm.init("t", dir);
    sm.setArchitecture({
      name: "T", description: "t",
      techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f"], dataModel: "n", apiDesign: "REST", raw: "",
    });
    sm.setSlices([
      {
        id: "s1",
        name: "bootstrap slice",
        description: "bootstrap",
        acceptanceCriteria: ["AC1"],
        testStrategy: "unit",
        dependencies: [],
        status: "pending",
        files: [],
        testResults: [],
        sastFindings: [],
        bootstrap: true,
      },
    ]);
    // Legacy flow for bootstrap: pending → red without ready_for_red
    expect(() => sm.setSliceStatus("s1", "red")).not.toThrow();
  });
});
