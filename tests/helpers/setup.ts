import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../../src/state/state-manager.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import type { TestResult } from "../../src/state/types.js";

/** Create a temporary directory for test isolation. */
export function makeTmpDir(prefix = "a2p-test"): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Remove a temporary directory. */
export function cleanTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Shorthand for JSON.parse. */
export function parse(json: string): any {
  return JSON.parse(json);
}

/** Add a passing test result to a slice (evidence for green/done transitions). */
export function addPassingTests(sm: StateManager, sliceId: string): void {
  sm.addTestResult(sliceId, {
    timestamp: new Date().toISOString(),
    command: "npm test",
    exitCode: 0,
    passed: 1,
    failed: 0,
    skipped: 0,
    output: "PASS",
  });
}

/** Mark SAST as run for a slice (evidence for sast transition). */
export function addSastEvidence(sm: StateManager, sliceId: string): void {
  sm.markSastRun(sliceId);
}

/**
 * Walk a slice through the full TDD cycle with proper evidence.
 * pending → red → green (with tests) → refactor → sast (with SAST) → done
 */
export function walkSliceToStatus(
  sm: StateManager,
  sliceId: string,
  targetStatus: "red" | "green" | "refactor" | "sast" | "done",
): void {
  const steps: Array<"red" | "green" | "refactor" | "sast" | "done"> =
    ["red", "green", "refactor", "sast", "done"];
  const targetIdx = steps.indexOf(targetStatus);

  for (let i = 0; i <= targetIdx; i++) {
    const step = steps[i];
    // Add evidence before transitions that require it
    if (step === "green") addPassingTests(sm, sliceId);
    if (step === "sast") addSastEvidence(sm, sliceId);
    if (step === "done") addPassingTests(sm, sliceId);
    sm.setSliceStatus(sliceId, step);
  }
}

/** Initialize a project with a basic architecture (no slices). */
export function initWithArch(dir: string, opts?: { language?: string; framework?: string }): void {
  handleInitProject({ projectPath: dir, projectName: "test" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Test",
    description: "Test",
    language: opts?.language ?? "TypeScript",
    framework: opts?.framework ?? "Express",
    features: ["CRUD"],
    dataModel: "items",
    apiDesign: "REST",
  });
}

/** Initialize a project with architecture + slices. */
export function initWithSlices(
  dir: string,
  sliceCount = 2,
  opts?: { language?: string; framework?: string; testStrategy?: string },
): void {
  initWithArch(dir, opts);
  handleCreateBuildPlan({
    projectPath: dir,
    slices: Array.from({ length: sliceCount }, (_, i) => ({
      id: `s0${i + 1}`,
      name: i === 0 ? "Setup" : `Slice ${i + 1}`,
      description: i === 0 ? "Setup" : `Slice ${i + 1}`,
      acceptanceCriteria: ["works"],
      testStrategy: opts?.testStrategy ?? "unit",
      dependencies: i > 0 ? [`s0${i}`] : [],
    })),
  });
}

/** Initialize a project with SAST findings for whitebox/verification tests. */
export function initWithFindings(dir: string, findingCount = 2): StateManager {
  const sm = initWithStateManager(dir);
  // Walk first slice to sast so it has findings context
  const state = sm.read();
  const sliceId = state.slices[0].id;
  addPassingTests(sm, sliceId);
  sm.setSliceStatus(sliceId, "red");
  addPassingTests(sm, sliceId);
  sm.setSliceStatus(sliceId, "green");
  sm.setSliceStatus(sliceId, "refactor");
  addSastEvidence(sm, sliceId);

  for (let i = 0; i < findingCount; i++) {
    sm.addSASTFinding(sliceId, {
      id: `TEST-${String(i + 1).padStart(3, "0")}`,
      tool: "semgrep",
      severity: i === 0 ? "high" : "medium",
      status: "open",
      title: i === 0 ? "Possible SQL injection" : "Hardcoded secret",
      file: `src/handler${i + 1}.ts`,
      line: 42 + i,
      description: `Test finding ${i + 1}`,
      fix: "Fix it",
    });
  }
  // Also add a file to the slice so reachability can be tested
  sm.updateSliceFiles(sliceId, ["src/handler1.ts", "src/handler2.ts"]);
  return sm;
}

/** Initialize via StateManager directly with typed architecture (for hardening tests). */
export function initWithStateManager(dir: string, sliceCount = 3): StateManager {
  const sm = new StateManager(dir);
  sm.init("test-project", dir);
  sm.setArchitecture({
    name: "Test",
    description: "Test project",
    techStack: { language: "TypeScript", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
    features: ["f1"],
    dataModel: "none",
    apiDesign: "REST",
    raw: "",
  });

  const slices = Array.from({ length: sliceCount }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Slice ${i + 1}`,
    description: `Test slice ${i + 1}`,
    acceptanceCriteria: [`AC${i + 1}`],
    testStrategy: "unit",
    dependencies: i > 0 ? [`s${i}`] : [],
    status: "pending" as const,
    files: [],
    testResults: [],
    sastFindings: [],
  }));

  sm.setSlices(slices);
  return sm;
}
