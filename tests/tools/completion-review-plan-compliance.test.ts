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

describe("completion review — plan compliance (Slice 3)", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-plancomp");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => { cleanTmpDir(dir); });

  function setupAndWalkToSast(finalPlanInterfaces: string[]): StateManager {
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
        acceptanceCriteria: ["AC1"],
        testStrategy: "unit",
        dependencies: [],
        status: "pending",
        files: [],
        testResults: [],
        sastFindings: [],
      },
    ]);
    // plan declares interface changes → api_contracts concern fires →
    // failure_modes piggybacks. Supply entries across all three artifacts.
    const concernSet = [
      {
        concern: "api_contracts" as const,
        applicability: "required" as const,
        justification: "",
        requirement: "exported symbols match plan",
        linkedAcIds: ["AC1"],
      },
      {
        concern: "failure_modes" as const,
        applicability: "required" as const,
        justification: "",
        requirement: "failure path returns typed error",
        linkedAcIds: ["AC1"],
      },
    ];
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: concernSet,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"], edgeCases: [], regressions: [], additionalConcerns: [],
      doneMetric: "dm",
      systemsConcernTests: [
        { concern: "api_contracts", testNames: ["t1"], evidenceType: "contract", rationale: "c" },
        { concern: "failure_modes", testNames: ["t1"], evidenceType: "negative", rationale: "c" },
      ],
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1",
      round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        expectedFiles: ["src/x.ts", "tests/x.test.ts"],
        interfacesToChange: finalPlanInterfaces,
        invariantsToPreserve: [],
        risks: [],
        narrative: "n",
        systemsConcernPlans: [
          { concern: "api_contracts", approach: "export symbols", filesTouched: ["src/x.ts"], rollbackStrategy: null },
          { concern: "failure_modes", approach: "throw", filesTouched: ["src/x.ts"], rollbackStrategy: null },
        ],
      },
    });

    sm.setSliceStatus("s1", "ready_for_red");
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// test\n");
    handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 1" });
    sm.setSliceStatus("s1", "red");

    // Implementation with a planned export
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const x = 1;\n");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "" });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "" });
    return sm;
  }

  function fullReviewInput(overrides: Partial<any> = {}): any {
    return {
      acCoverage: [{ ac: "AC1", status: "met", evidence: "e" }],
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

  it("populates unplannedInterfaceChanges when a symbol isn't in finalPlan.interfacesToChange", () => {
    setupAndWalkToSast([]); // no planned interfaces
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.planCompliance.unplannedInterfaceChanges).toContain("x");
  });

  it("accepts COMPLETE when every changed export is in the planned interfaces", () => {
    setupAndWalkToSast(["x"]);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.verdict).toBe("COMPLETE");
    expect(res.planCompliance.unplannedInterfaceChanges).toEqual([]);
    expect(res.planCompliance.verdict).toBe("ok");
  });

  it("flags an unplanned file touched during implementation", () => {
    setupAndWalkToSast(["x"]);
    // Sneak an unplanned file in
    writeFileSync(join(dir, "src", "unexpected.ts"), "// drift\n");
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.planCompliance.unplannedFiles).toContain("src/unexpected.ts");
  });

  // Bug #1a regression: prose entries in interfacesToChange should match
  // after bare-identifier extraction. "new export: x" must match the
  // exported symbol "x".
  it("matches prose interfacesToChange entries by extracting the bare identifier", () => {
    setupAndWalkToSast(["new export: x(value: number): number"]);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.planCompliance.unplannedInterfaceChanges).toEqual([]);
    expect(res.planCompliance.verdict).toBe("ok");
  });

  // Bug #1b regression: type-only exports from a planned file should NOT
  // be flagged as unplanned interface changes. They are supporting
  // declarations for a planned function.
  it("does not flag type-only exports from planned files as unplanned", () => {
    // Plan lists only "x" but implementation also exports "XOptions" type
    setupAndWalkToSast(["x"]);
    // Rewrite source to include a type export alongside the value export
    writeFileSync(
      join(dir, "src", "x.ts"),
      "export type XOptions = { verbose: boolean };\nexport const x = 1;\n",
    );
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.planCompliance.unplannedInterfaceChanges).toEqual([]);
    expect(res.planCompliance.verdict).toBe("ok");
  });

  // Bug #1b counter-case: type-only exports from an UNplanned file SHOULD
  // still be flagged.
  it("flags type-only exports from unplanned files as drift", () => {
    setupAndWalkToSast(["x"]);
    // Add an unplanned file with a type export
    writeFileSync(join(dir, "src", "extra.ts"), "export type ExtraConfig = {};\n");
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.planCompliance.unplannedInterfaceChanges).toContain("ExtraConfig");
  });

  // Bug #1a backward compatibility: bare identifiers still work as before.
  it("still matches bare identifier entries (backward compat)", () => {
    setupAndWalkToSast(["x"]);
    const res = parse(
      handleCompletionReview({
        projectPath: dir,
        sliceId: "s1",
        ...fullReviewInput(),
      }),
    );
    expect(res.success).toBe(true);
    expect(res.planCompliance.verdict).toBe("ok");
  });
});
