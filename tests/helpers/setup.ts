import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../../src/state/state-manager.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import type { TestResult, Phase, AuditResult, ActiveVerificationResult } from "../../src/state/types.js";
import { readFileSync, writeFileSync } from "node:fs";

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

/**
 * Force a phase directly in state file (bypasses transition checks).
 * TEST ONLY — for setting up test preconditions.
 */
export function forcePhase(dir: string, phase: Phase): void {
  const statePath = join(dir, ".a2p", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state.phase = phase;
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Force a top-level field in state file (bypasses all checks).
 * TEST ONLY — for setting up test preconditions like stale timestamps.
 */
export function forceField(dir: string, field: string, value: unknown): void {
  const statePath = join(dir, ".a2p", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  state[field] = value;
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/** Add a quality audit result (evidence for building->security gate). */
export function addQualityAudit(sm: StateManager): void {
  sm.addAuditResult({
    id: `AUD-Q-${Date.now()}`,
    mode: "quality",
    timestamp: new Date().toISOString(),
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    buildPassed: true,
    testsPassed: true,
    aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 },
  });
}

/** Add a release audit result (evidence for security->deployment gate). */
export function addReleaseAudit(sm: StateManager): void {
  sm.addAuditResult({
    id: `AUD-R-${Date.now()}`,
    mode: "release",
    timestamp: new Date().toISOString(),
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    buildPassed: true,
    testsPassed: true,
    aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 },
  });
}

/** Add a passing active verification result (evidence for security->deployment gate). */
export function addPassingVerification(sm: StateManager): void {
  sm.addActiveVerificationResult({
    id: `AVR-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: 1,
    tests_run: 1,
    tests_passed: 1,
    tests_failed: 0,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
    requires_human_review: false,
  });
}

/** Add a passing whitebox audit result + adversarial review completion (evidence for security->deployment gate). */
export function addPassingWhitebox(sm: StateManager): void {
  sm.addWhiteboxResult({
    id: `WBA-${Date.now()}`,
    mode: "full",
    timestamp: new Date().toISOString(),
    candidates_evaluated: 0,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
  });
  sm.completeAdversarialReview(0, "test: no findings");
  sm.clearPendingSecurityDecision();
}

/** Add ONLY the whitebox audit result without adversarial review completion. */
export function addWhiteboxOnly(sm: StateManager): void {
  sm.addWhiteboxResult({
    id: `WBA-${Date.now()}`,
    mode: "full",
    timestamp: new Date().toISOString(),
    candidates_evaluated: 0,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
  });
}

/** Complete ONLY the adversarial review (requires whitebox audit first). */
export function completeAdversarialReview(sm: StateManager): void {
  sm.completeAdversarialReview(0, "test: no findings");
  sm.clearPendingSecurityDecision();
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
