import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  makeTmpDir,
  cleanTmpDir,
  parse,
  seedSliceHardening,
  seedPassingGuard,
} from "../helpers/setup.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { handleVerifyTestFirst } from "../../src/tools/verify-test-first.js";
import { StateManager } from "../../src/state/state-manager.js";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

describe("test-first guard (real git repo)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-guard");

    // Init git repo with a baseline commit
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);

    // Project init
    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "T",
      description: "t",
      techStack: {
        language: "TS",
        framework: "Express",
        database: null,
        frontend: null,
        hosting: null,
        other: [],
      },
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

    // Harden: requirements, tests, plan
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
    });
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
    });
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "ip",
      critique: "c",
      revisedPlan: "r",
      improvementsFound: false,
      finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        expectedFiles: ["src/foo.ts", "tests/foo.test.ts"],
        interfacesToChange: [],
        invariantsToPreserve: [],
        risks: [],
        narrative: "n",
      },
    });

    // Transition to ready_for_red (captures baseline against git HEAD)
    sm.setSliceStatus("s1", "ready_for_red");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("baseline commit is set to git HEAD on ready_for_red", () => {
    const sm = new StateManager(dir);
    const state = sm.read();
    const slice = state.slices[0];
    expect(slice.baseline).toBeDefined();
    expect(slice.baseline!.commit).toBeTruthy();
  });

  it("guard fails when a production file is changed", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "foo.ts"), "export const x = 1;\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.guardVerdict).toBe("fail");
    expect(res.error).toMatch(/production files changed/);
  });

  it("guard fails when no test file is changed", () => {
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.guardVerdict).toBe("fail");
    expect(res.error).toMatch(/no test files changed/);
  });

  it("guard fails when the test command passes", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// test\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 0",
      }),
    );
    expect(res.guardVerdict).toBe("fail");
    expect(res.error).toMatch(/expected a failing run/);
  });

  it("guard passes when only a test file is changed and the test run fails", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// test\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.success).toBe(true);
    expect(res.guardVerdict).toBe("pass");
    expect(res.testFilesTouched).toContain("tests/foo.test.ts");
  });

  it("red transition is rejected without a passing guard", () => {
    const sm = new StateManager(dir);
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /test-first guard not verified|guard/i,
    );
  });

  it("red transition is allowed after a passing guard", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// test\n");
    handleVerifyTestFirst({
      projectPath: dir,
      sliceId: "s1",
      testCommand: "exit 1",
    });
    const sm = new StateManager(dir);
    const state = sm.setSliceStatus("s1", "red");
    expect(state.slices[0].status).toBe("red");
  });

  it("red transition is rejected when guard references a fabricated redTestsRunAt", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// test\n");
    handleVerifyTestFirst({
      projectPath: dir,
      sliceId: "s1",
      testCommand: "exit 1",
    });

    // Tamper: replace the guard's redTestsRunAt with a fabricated timestamp
    // that does not correspond to any recorded testResults entry.
    const statePath = join(dir, ".a2p", "state.json");
    const stateJson = JSON.parse(readFileSync(statePath, "utf-8"));
    stateJson.slices[0].testFirstGuard.redTestsRunAt = "1999-01-01T00:00:00.000Z";
    writeFileSync(statePath, JSON.stringify(stateJson, null, 2), "utf-8");

    const sm = new StateManager(dir);
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /no matching entry in slice\.testResults/,
    );
  });

  it("red transition is rejected when the referenced test run is older than the baseline", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// test\n");
    handleVerifyTestFirst({
      projectPath: dir,
      sliceId: "s1",
      testCommand: "exit 1",
    });

    // Tamper: bump baseline.capturedAt into the future so the recorded test
    // is now "older than the baseline", simulating a stale reference.
    const statePath = join(dir, ".a2p", "state.json");
    const stateJson = JSON.parse(readFileSync(statePath, "utf-8"));
    stateJson.slices[0].baseline.capturedAt = "2999-01-01T00:00:00.000Z";
    writeFileSync(statePath, JSON.stringify(stateJson, null, 2), "utf-8");

    const sm = new StateManager(dir);
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /older than the baseline/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B-5 + B-6: file-hash fallback path AND configurable testFilePatterns
// ─────────────────────────────────────────────────────────────────────────

describe("test-first guard — file-hash fallback (non-git dir)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-guard-filehash");

    // NOTE: no `git init` — this is a non-git project so baseline falls back
    // to file-hash snapshots.
    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "T",
      description: "t",
      techStack: {
        language: "TS",
        framework: "Express",
        database: null,
        frontend: null,
        hosting: null,
        other: [],
      },
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
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
    });
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
    });
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "ip",
      critique: "c",
      revisedPlan: "r",
      improvementsFound: false,
      finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        expectedFiles: ["src/foo.ts", "tests/foo.test.ts"],
        interfacesToChange: [],
        invariantsToPreserve: [],
        risks: [],
        narrative: "n",
      },
    });
    sm.setSliceStatus("s1", "ready_for_red");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("B-5: captures a file-hash baseline when the project is not a git repo", () => {
    const sm = new StateManager(dir);
    const state = sm.read();
    const slice = state.slices[0];
    expect(slice.baseline).toBeDefined();
    // Non-git → commit is null, fileHashes map is present (may be empty if no
    // trackable files exist besides the excluded .a2p state dir).
    expect(slice.baseline!.commit).toBeNull();
    expect(slice.baseline!.fileHashes).toBeDefined();
  });

  it("B-5: guard passes via file-hash diff when only a test file is added", () => {
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// failing test\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.success).toBe(true);
    expect(res.guardVerdict).toBe("pass");
    expect(res.testFilesTouched).toContain("tests/foo.test.ts");
  });
});

describe("test-first guard — configurable testFilePatterns override", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-guard-patterns");

    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "T",
      description: "t",
      techStack: {
        language: "TS",
        framework: "Express",
        database: null,
        frontend: null,
        hosting: null,
        other: [],
      },
      features: ["f"],
      dataModel: "n",
      apiDesign: "REST",
      raw: "",
      // Only files matching this pattern are classified as tests.
      testFilePatterns: ["**/*.probe.ts"],
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
    handleHardenRequirements({
      projectPath: dir,
      sliceId: "s1",
      goal: "goal",
      nonGoals: [],
      affectedComponents: ["src/foo.ts"],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ["AC1"],
    });
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
    });
    handleHardenPlan({
      projectPath: dir,
      sliceId: "s1",
      round: 1,
      initialPlan: "ip",
      critique: "c",
      revisedPlan: "r",
      improvementsFound: false,
      finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        expectedFiles: ["src/foo.probe.ts"],
        interfacesToChange: [],
        invariantsToPreserve: [],
        risks: [],
        narrative: "n",
      },
    });
    sm.setSliceStatus("s1", "ready_for_red");
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("B-6: a file matching the custom pattern is classified as a test file", () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "foo.probe.ts"), "// probe test\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.success).toBe(true);
    expect(res.guardVerdict).toBe("pass");
    expect(res.testFilesTouched).toContain("src/foo.probe.ts");
  });

  it("B-6: a file NOT matching the custom pattern (but matching defaults) is classified as production", () => {
    // tests/foo.test.ts matches DEFAULT_TEST_PATTERNS but NOT the custom override.
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "foo.test.ts"), "// would-be test\n");
    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s1",
        testCommand: "exit 1",
      }),
    );
    expect(res.guardVerdict).toBe("fail");
    expect(res.error).toMatch(/production files changed/);
  });
});

// Bug #2 regression: committed files from prior slices must NOT be flagged
// as production drift for the current slice.
describe("verify_test_first — cross-slice commit isolation (Bug #2 dogfood fix)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-guard-xslice");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => { cleanTmpDir(dir); });

  it("does not flag committed prior-slice files as production drift", () => {
    const sm = new StateManager(dir);
    sm.init("t", dir);
    sm.setArchitecture({
      name: "T", description: "t",
      techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f"], dataModel: "n", apiDesign: "REST", raw: "",
    });
    sm.setSlices([
      { id: "s1", name: "s1", description: "d", acceptanceCriteria: ["AC1"], testStrategy: "unit", dependencies: [], status: "pending", files: [], testResults: [], sastFindings: [] },
      { id: "s2", name: "s2", description: "d", acceptanceCriteria: ["AC2"], testStrategy: "unit", dependencies: [], status: "pending", files: [], testResults: [], sastFindings: [] },
    ]);

    // Simulate slice 1 done + committed (another slice's production code)
    mkdirSync(join(dir, "src", "s1"), { recursive: true });
    writeFileSync(join(dir, "src", "s1", "foo.ts"), "export const foo = 1;\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-m", "s1 complete", "-q"]);

    // Now start slice 2
    seedSliceHardening(sm, "s2");
    sm.setSliceStatus("s2", "ready_for_red");

    // Write only a test file for s2 (no production changes)
    mkdirSync(join(dir, "tests", "s2"), { recursive: true });
    writeFileSync(join(dir, "tests", "s2", "bar.test.ts"), "// s2 test\n");

    const res = parse(
      handleVerifyTestFirst({
        projectPath: dir,
        sliceId: "s2",
        testCommand: "exit 1",
      }),
    );
    // Guard must pass — slice 1's committed files are settled history
    expect(res.guardVerdict).toBe("pass");
    expect(res.error).toBeUndefined();
  });
});

// Bug #3 regression: completion_fix with green tests must auto-pass
// verify_test_first (test-first was already proven in the original cycle).
describe("verify_test_first — completion_fix bypass (Bug #3 dogfood fix)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-guard-cfbypass");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => { cleanTmpDir(dir); });

  function setupToCompletionFix(): StateManager {
    const sm = new StateManager(dir);
    sm.init("t", dir);
    sm.setArchitecture({
      name: "T", description: "t",
      techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f"], dataModel: "n", apiDesign: "REST", raw: "",
    });
    sm.setSlices([
      { id: "s1", name: "s", description: "d", acceptanceCriteria: ["AC1"], testStrategy: "unit", dependencies: [], status: "pending", files: [], testResults: [], sastFindings: [] },
    ]);
    seedSliceHardening(sm, "s1");
    sm.setSliceStatus("s1", "ready_for_red");
    seedPassingGuard(sm, "s1");
    sm.setSliceStatus("s1", "red");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "" });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "" });
    // Submit NOT_COMPLETE to trigger completion_fix
    sm.recordSliceCompletionReview("s1", {
      loop: 1, createdAt: new Date().toISOString(),
      acCoverage: [{ ac: "AC1", status: "met", evidence: "e" }],
      testCoverageQuality: "deep",
      planCompliance: { unplannedFiles: ["external.md"], unplannedInterfaceChanges: [], touchedAreasCovered: true, verdict: "drift" },
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: ["external drift"],
      shortcutsOrStubs: [], automatedStubSignals: [], stubJustifications: [],
      verdict: "NOT_COMPLETE", nextActions: ["fix drift"],
    });
    sm.setSliceStatus("s1", "completion_fix");
    return sm;
  }

  it("auto-passes with pass_inherited_completion_fix verdict when tests are green in completion_fix mode", () => {
    setupToCompletionFix();
    const res = parse(
      handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 0" }),
    );
    expect(res.guardVerdict).toBe("pass_inherited_completion_fix");
    expect(res.mode).toBe("completion_fix_inherited");
    expect(res.evidenceReason).toMatch(/completion_fix drift-recovery/);
  });

  it("does NOT auto-pass when the last test result is failing", () => {
    const sm = setupToCompletionFix();
    // Override last test result to be failing
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 1, passed: 0, failed: 1, skipped: 0, output: "fail" });
    // Must not get the bypass — needs real test-first guard
    const res = parse(
      handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 1" }),
    );
    // Should NOT be completion_fix_inherited — should go through normal flow
    expect(res.mode).toBeUndefined();
  });

  // Regression: the original Bug #3 dogfood fix set guardVerdict="pass" but left
  // testFilesTouched empty + redFailingEvidence null. The downstream
  // requireTestFirstGuardPassed then rejected the completion_fix → red
  // transition because those fields were expected to be populated. The v1.2
  // fix introduces pass_inherited_completion_fix as a distinct verdict so the
  // downstream check can branch on it.
  it("completion_fix → red transition succeeds after inherited pass (was Handwerkhelfer-blocker)", () => {
    const sm = setupToCompletionFix();
    handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 0" });
    // This was throwing before the fix: "no test files were touched before RED."
    expect(() => sm.setSliceStatus("s1", "red")).not.toThrow();
    const state = sm.read();
    const slice = state.slices.find((s) => s.id === "s1")!;
    expect(slice.status).toBe("red");
    expect(slice.testFirstGuard?.guardVerdict).toBe("pass_inherited_completion_fix");
  });

  // Anti-regression: a hand-crafted artifact with plain "pass" but empty
  // testFilesTouched must still be rejected. Only the dedicated
  // "pass_inherited_completion_fix" verdict unlocks the bypass.
  it("rejects plain pass with empty testFilesTouched (forged artifact)", () => {
    const sm = setupToCompletionFix();
    const state = sm.read();
    const slice = state.slices.find((s) => s.id === "s1")!;
    const baselineCommit = slice.baseline?.commit ?? null;
    const baselineCapturedAt = slice.baseline!.capturedAt;
    sm.storeTestFirstGuard("s1", {
      redTestsDeclaredAt: new Date().toISOString(),
      redTestsRunAt: slice.testResults.at(-1)!.timestamp,
      redFailingEvidence: null,
      testFilesTouched: [],
      nonTestFilesTouchedBeforeRedEvidence: [],
      guardVerdict: "pass",
      baselineCommit,
      baselineCapturedAt,
      evidenceReason: "forged: plain pass with no evidence",
    });
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /no test files were touched before RED/,
    );
  });
});
