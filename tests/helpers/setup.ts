import { mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../../src/state/state-manager.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import type {
  TestResult,
  Phase,
  AuditResult,
  ActiveVerificationResult,
  SystemsConcernId,
} from "../../src/state/types.js";
import { computeRequiredConcerns } from "../../src/utils/systems-applicability.js";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Opt the current test file into legacy slice-flow mode by flipping the
 * test-only StateManager.forceLegacyFlowForTests flag in beforeAll and
 * restoring it in afterAll. Invoke this at the top of any test file that
 * exercises legacy state-machine semantics directly (pending → red without
 * hardening + guard).
 *
 * Requires that the test file imports from vitest at module level (beforeAll
 * and afterAll are globals when `test.globals: true` is set in vitest.config).
 */
export function useLegacySliceFlow(): void {
  // Use dynamic globals because vitest sets them on globalThis when
  // `globals: true` is active.
  const g = globalThis as unknown as {
    beforeAll: (fn: () => void) => void;
    afterAll: (fn: () => void) => void;
  };
  let originalFlag = false;
  g.beforeAll(() => {
    originalFlag = StateManager.forceLegacyFlowForTests;
    StateManager.forceLegacyFlowForTests = true;
  });
  g.afterAll(() => {
    StateManager.forceLegacyFlowForTests = originalFlag;
  });
}

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

function computeAcHashLocal(ac: string[]): string {
  const normalized = ac.map((s) => s.trim()).filter((s) => s.length > 0);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

/**
 * Directly seed requirements/test/plan hardening artifacts on a slice in state.json.
 * TEST ONLY — bypasses the tool API for tests that don't want to exercise
 * the hardening flow in detail.
 */
export function seedSliceHardening(sm: StateManager, sliceId: string): void {
  const statePath = join(sm.projectPath, ".a2p", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const slice = state.slices.find((s: any) => s.id === sliceId);
  if (!slice) throw new Error(`Slice ${sliceId} not found in state`);

  const now = new Date().toISOString();
  const acHash = computeAcHashLocal(slice.acceptanceCriteria);

  // A2P v2: compute required concerns and seed minimal valid entries so the
  // systems-concern gate does not reject seeded slices. Architecture may be
  // null during early-onboarding tests; computeRequiredConcerns handles that
  // and returns at least `failure_modes` (always-on).
  const architecture = state.architecture ?? null;
  const required = [...computeRequiredConcerns(slice, architecture)] as SystemsConcernId[];
  const firstAc = slice.acceptanceCriteria[0] ?? "AC1";

  slice.requirementsHardening = {
    goal: "test goal",
    nonGoals: [],
    affectedComponents: ["test"],
    assumptions: [],
    risks: [],
    finalAcceptanceCriteria: [...slice.acceptanceCriteria],
    acHash,
    hardenedAt: now,
    systemsConcerns: required.map((concern) => ({
      concern,
      applicability: "required",
      justification: "",
      requirement: `seeded requirement for ${concern}`,
      linkedAcIds: [firstAc],
    })),
  };
  slice.testHardening = {
    acToTestMap: slice.acceptanceCriteria.map((ac: string) => ({
      ac,
      tests: ["t1"],
      rationale: "test",
    })),
    positiveCases: ["p"],
    negativeCases: ["n"],
    edgeCases: [],
    regressions: [],
    additionalConcerns: [],
    doneMetric: "tests green",
    hardenedAt: now,
    requirementsAcHash: acHash,
    systemsConcernTests: required.map((concern) => ({
      concern,
      testNames: ["t1"],
      evidenceType: "positive" as const,
      rationale: `seeded test for ${concern}`,
    })),
  };
  slice.planHardening = {
    rounds: [
      {
        round: 1,
        initialPlan: "initial",
        critique: "critique",
        revisedPlan: "revised",
        improvementsFound: false,
        createdAt: now,
      },
    ],
    finalPlan: {
      touchedAreas: ["test"],
      expectedFiles: ["test.ts"],
      interfacesToChange: [],
      invariantsToPreserve: [],
      risks: [],
      narrative: "test plan",
      systemsConcernPlans: required.map((concern) => ({
        concern,
        approach: `seeded plan for ${concern}`,
        filesTouched: ["test.ts"],
        rollbackStrategy: null,
      })),
    },
    finalized: true,
    finalizedAt: now,
    requirementsAcHash: acHash,
    testsHardenedAt: now,
  };

  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Directly seed a baseline + passing test-first guard on a slice. TEST ONLY.
 * Requires hardening to already be present. Also records a matching
 * failing-test result in slice.testResults so the state-manager's
 * cross-check in requireTestFirstGuardPassed is satisfied.
 */
export function seedPassingGuard(sm: StateManager, sliceId: string): void {
  const statePath = join(sm.projectPath, ".a2p", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const slice = state.slices.find((s: any) => s.id === sliceId);
  if (!slice) throw new Error(`Slice ${sliceId} not found in state`);

  const baselineAt = new Date().toISOString();
  // Ensure the test result timestamp is strictly >= baseline.capturedAt.
  const testAt = new Date(new Date(baselineAt).getTime() + 1).toISOString();
  slice.baseline = { commit: null, fileHashes: {}, capturedAt: baselineAt };
  slice.testResults = slice.testResults ?? [];
  slice.testResults.push({
    timestamp: testAt,
    command: "test",
    exitCode: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    output: "seeded failing test",
  });
  slice.testFirstGuard = {
    redTestsDeclaredAt: testAt,
    redTestsRunAt: testAt,
    redFailingEvidence: { exitCode: 1, testCommand: "test", failedCount: 1 },
    testFilesTouched: ["test.ts"],
    nonTestFilesTouchedBeforeRedEvidence: [],
    guardVerdict: "pass",
    baselineCommit: null,
    baselineCapturedAt: baselineAt,
    evidenceReason: "seeded by test helper",
  };

  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Directly seed a COMPLETE completion review for a slice (cleared of all
 * missing/stub signals, deep coverage, ok plan compliance). TEST ONLY.
 */
export function seedCompleteReview(sm: StateManager, sliceId: string): void {
  const statePath = join(sm.projectPath, ".a2p", "state.json");
  const state = JSON.parse(readFileSync(statePath, "utf-8"));
  const slice = state.slices.find((s: any) => s.id === sliceId);
  if (!slice) throw new Error(`Slice ${sliceId} not found in state`);

  const now = new Date().toISOString();
  const architecture = state.architecture ?? null;
  const required = [...computeRequiredConcerns(slice, architecture)] as SystemsConcernId[];

  slice.completionReviews = slice.completionReviews ?? [];
  const nextLoop = slice.completionReviews.filter((r: any) => !r.supersededByHardeningAt).length + 1;
  slice.completionReviews.push({
    loop: nextLoop,
    createdAt: now,
    acCoverage: slice.acceptanceCriteria.map((ac: string) => ({
      ac,
      status: "met",
      evidence: "test",
    })),
    testCoverageQuality: "deep",
    planCompliance: {
      unplannedFiles: [],
      unplannedInterfaceChanges: [],
      touchedAreasCovered: true,
      verdict: "ok",
    },
    missingFunctionality: [],
    missingTests: [],
    missingEdgeCases: [],
    missingIntegrationWork: [],
    missingCleanupRefactor: [],
    missingPlanFixes: [],
    shortcutsOrStubs: [],
    automatedStubSignals: [],
    stubJustifications: [],
    verdict: "COMPLETE",
    nextActions: [],
    // A2P v2: per-concern verdicts so pre-DONE gate passes for seeded slices.
    systemsConcernReviews: required.map((concern) => ({
      concern,
      verdict: "satisfied" as const,
      evidence: "seeded by test helper",
      shortfall: "",
    })),
  });

  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Walk a slice through the full native hardening + TDD cycle with seeded
 * evidence so existing tests don't have to replay the hardening flow.
 * pending → (seed hardening) → ready_for_red → (seed guard) → red → green
 *         → refactor → (SAST run) → sast → (seed complete review) → done
 *
 * Bootstrap slices use the legacy flow automatically.
 */
export function walkSliceToStatus(
  sm: StateManager,
  sliceId: string,
  targetStatus:
    | "ready_for_red"
    | "red"
    | "green"
    | "refactor"
    | "sast"
    | "completion_fix"
    | "done",
): void {
  const state = sm.read();
  const slice = state.slices.find((s) => s.id === sliceId);
  if (!slice) throw new Error(`Slice ${sliceId} not found`);

  // Bootstrap slices AND the test-only legacy-flow flag take the legacy path.
  // Everything else is native.
  if (slice.bootstrap === true || StateManager.forceLegacyFlowForTests) {
    walkBootstrapSlice(sm, sliceId, targetStatus);
    return;
  }

  const order: Array<
    "ready_for_red" | "red" | "green" | "refactor" | "sast" | "done"
  > = ["ready_for_red", "red", "green", "refactor", "sast", "done"];
  const normalized = targetStatus === "completion_fix" ? "sast" : targetStatus;
  const targetIdx = order.indexOf(normalized as typeof order[number]);

  for (let i = 0; i <= targetIdx; i++) {
    const step = order[i];
    switch (step) {
      case "ready_for_red":
        if (!sm.read().slices.find((s) => s.id === sliceId)?.requirementsHardening) {
          seedSliceHardening(sm, sliceId);
        }
        sm.setSliceStatus(sliceId, "ready_for_red");
        break;
      case "red":
        seedPassingGuard(sm, sliceId);
        sm.setSliceStatus(sliceId, "red");
        break;
      case "green":
        addPassingTests(sm, sliceId);
        sm.setSliceStatus(sliceId, "green");
        break;
      case "refactor":
        sm.setSliceStatus(sliceId, "refactor");
        break;
      case "sast":
        addSastEvidence(sm, sliceId);
        sm.setSliceStatus(sliceId, "sast");
        break;
      case "done":
        addPassingTests(sm, sliceId);
        seedCompleteReview(sm, sliceId);
        sm.setSliceStatus(sliceId, "done");
        break;
    }
  }
}

function walkBootstrapSlice(
  sm: StateManager,
  sliceId: string,
  targetStatus: string,
): void {
  const steps: Array<"red" | "green" | "refactor" | "sast" | "done"> = [
    "red",
    "green",
    "refactor",
    "sast",
    "done",
  ];
  const targetIdx = steps.indexOf(targetStatus as typeof steps[number]);
  if (targetIdx === -1) return;
  for (let i = 0; i <= targetIdx; i++) {
    const step = steps[i];
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

// ─── Plan-compliant helper aliases ─────────────────────────────────────
// The plan referred to these helpers by specific names. The existing
// seed* helpers are the canonical implementation; these aliases give
// test code written against the plan's vocabulary a direct import path.

/** Alias for {@link seedSliceHardening}. */
export const hardenSliceFully = seedSliceHardening;

/** Alias for {@link seedPassingGuard}. */
export const passTestFirstGuard = seedPassingGuard;

/** Alias for {@link seedCompleteReview}. */
export const recordCompleteReview = seedCompleteReview;
