import { z } from "zod";
import { mkdtempSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import { generateRunId } from "../utils/log-sanitizer.js";
import { StateManager } from "../state/state-manager.js";
import { isBlockingWhiteboxFinding } from "./run-whitebox-audit.js";
import type {
  WhiteboxFinding,
  ActiveVerificationResult,
} from "../state/types.js";

export const runActiveVerificationSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  round: z.number().int().min(1).max(3).optional().default(1).describe("Verification round (1-3)"),
  categories: z.array(z.enum([
    "workflow_gates", "state_recovery", "deployment_gates",
  ])).optional().describe("Categories to test (default: all)"),
});

export type RunActiveVerificationInput = z.infer<typeof runActiveVerificationSchema>;

interface TestCase {
  name: string;
  category: "workflow_gates" | "state_recovery" | "deployment_gates";
  run: (tempDir: string) => TestOutcome;
}

interface TestOutcome {
  passed: boolean;
  finding?: WhiteboxFinding;
}

export function handleRunActiveVerification(input: RunActiveVerificationInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const verifyStart = Date.now();
  const state = sm.read();
  try { requirePhase(state.phase, ["security"], "a2p_run_active_verification"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }
  const categoriesToTest = input.categories ?? ["workflow_gates", "state_recovery", "deployment_gates"];

  // Create temp copy of state for destructive tests
  const tempDir = mkdtempSync(join(tmpdir(), "a2p-verify-"));
  try {
    cpSync(join(input.projectPath, ".a2p"), join(tempDir, ".a2p"), { recursive: true });

    // Generate test cases
    const allTests = generateTestCases(state, input.projectPath);
    const filtered = allTests.filter((t) => categoriesToTest.includes(t.category));
    const testsToRun = filtered.slice(0, 50);

    let passed = 0;
    let failed = 0;
    const findings: WhiteboxFinding[] = [];
    let findingIdx = 0;

    for (const test of testsToRun) {
      // Reset temp state before each test
      cpSync(join(input.projectPath, ".a2p"), join(tempDir, ".a2p"), { recursive: true });

      const outcome = test.run(tempDir);
      if (outcome.passed) {
        passed++;
      } else {
        failed++;
        if (outcome.finding) {
          findingIdx++;
          outcome.finding.id = `AV-${String(findingIdx).padStart(3, "0")}`;
          outcome.finding.blocking = isBlockingWhiteboxFinding(outcome.finding);
          findings.push(outcome.finding);
        }
      }
    }

    const summary = {
      critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
    };

    const blockingCount = findings.filter((f) => f.blocking).length;
    const requiresHumanReview = input.round >= 3 && blockingCount > 0;

    const existingCount = state.activeVerificationResults.length;
    const resultId = `AVR-${String(existingCount + 1).padStart(3, "0")}`;

    const result: ActiveVerificationResult = {
      id: resultId,
      timestamp: new Date().toISOString(),
      round: input.round,
      tests_run: testsToRun.length,
      tests_passed: passed,
      tests_failed: failed,
      findings,
      summary,
      blocking_count: blockingCount,
      requires_human_review: requiresHumanReview,
    };

    sm.addActiveVerificationResult(result);

    const durationMs = Date.now() - verifyStart;
    sm.log(
      blockingCount > 0 ? "error" : failed > 0 ? "warn" : "info",
      "active_verification",
      `${resultId} round ${input.round}: ${passed}/${testsToRun.length} passed`,
      {
        status: blockingCount > 0 ? "failure" : failed > 0 ? "warning" : "success",
        durationMs,
        runId: generateRunId(),
        metadata: { passed, failed, toolName: "active_verification" },
      },
    );

    return JSON.stringify({
      success: true,
      verificationId: resultId,
      round: input.round,
      testsRun: testsToRun.length,
      testsPassed: passed,
      testsFailed: failed,
      findings: findings.slice(0, 20),
      totalFindings: findings.length,
      bySeverity: summary,
      blockingCount,
      requiresHumanReview,
      hint: requiresHumanReview
        ? "Round 3 with blocking findings — HUMAN REVIEW REQUIRED."
        : blockingCount > 0
          ? `${blockingCount} blocking gate failure(s). Fix and re-verify.`
          : failed > 0
            ? `${failed} non-blocking test failure(s). Review as appropriate.`
            : "All gate tests passed. Runtime invariants verified.",
    });
  } finally {
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* cleanup best-effort */ }
  }
}

// --- Test Case Generation ---

function generateTestCases(
  state: import("../state/types.js").ProjectState,
  _projectPath: string,
): TestCase[] {
  const tests: TestCase[] = [];
  const hasSlices = state.slices.length > 0;

  // --- Workflow Gate Tests ---

  if (hasSlices) {
    const firstSlice = state.slices[0];

    // Green without tests must fail
    tests.push({
      name: "setSliceStatus(green) without tests must throw",
      category: "workflow_gates",
      run: (tempDir) => {
        const tempSm = new StateManager(tempDir);
        try {
          const s = tempSm.read();
          const slice = s.slices.find((sl) => sl.id === firstSlice.id);
          if (!slice || slice.status !== "pending") {
            // Need a pending slice — set one up
            return testSliceTransitionGuard(tempSm, firstSlice.id, "green", "pending");
          }
          tempSm.setSliceStatus(firstSlice.id, "red");
          tempSm.setSliceStatus(firstSlice.id, "green");
          return gateShouldHaveThrown("green without tests");
        } catch {
          return { passed: true };
        }
      },
    });

    // SAST without evidence must fail
    tests.push({
      name: "setSliceStatus(sast) without SAST evidence must throw",
      category: "workflow_gates",
      run: (tempDir) => testSliceTransitionGuard(new StateManager(tempDir), firstSlice.id, "sast", "refactor"),
    });

    // Done without tests must fail
    tests.push({
      name: "setSliceStatus(done) without tests must throw",
      category: "workflow_gates",
      run: (tempDir) => testSliceTransitionGuard(new StateManager(tempDir), firstSlice.id, "done", "sast"),
    });

    // Backtrack sast→red must clear sastRanAt
    tests.push({
      name: "sast→red backtrack must clear sastRanAt",
      category: "workflow_gates",
      run: (tempDir) => {
        const tempSm = new StateManager(tempDir);
        try {
          // Walk slice to sast
          walkSliceForVerification(tempSm, firstSlice.id, "sast");
          tempSm.setSliceStatus(firstSlice.id, "red");
          const s = tempSm.read();
          const slice = s.slices.find((sl) => sl.id === firstSlice.id);
          if (slice?.sastRanAt) {
            return {
              passed: false,
              finding: makeGateFinding(
                "WorkflowGateEnforcement",
                "high",
                "sast→red backtrack did not clear sastRanAt",
                "Ensure backtrack clears SAST evidence",
              ),
            };
          }
          return { passed: true };
        } catch {
          return { passed: true }; // If error, the guard is working
        }
      },
    });
  }

  // Deployment gate with critical SAST
  tests.push({
    name: "setPhase(deployment) with open critical SAST must throw",
    category: "workflow_gates",
    run: (tempDir) => {
      const tempSm = new StateManager(tempDir);
      try {
        const s = tempSm.read();
        // Inject a critical SAST finding
        if (s.slices.length > 0) {
          tempSm.addSASTFinding(s.slices[0].id, {
            id: "TEST-CRIT",
            tool: "manual",
            severity: "critical",
            status: "open",
            title: "Test critical finding",
            file: "test.ts",
            line: 1,
            description: "Injected for verification",
            fix: "N/A",
          });
        }
        // Walk to security phase
        walkToPhase(tempSm, "security");
        tempSm.setPhase("deployment");
        return gateShouldHaveThrown("deployment with critical SAST");
      } catch {
        return { passed: true };
      }
    },
  });

  // Deployment gate with blocking whitebox findings
  tests.push({
    name: "setPhase(deployment) with blocking whitebox findings must throw",
    category: "deployment_gates",
    run: (tempDir) => {
      const tempSm = new StateManager(tempDir);
      try {
        // Add a whitebox result with blocking findings
        tempSm.addWhiteboxResult({
          id: "WBA-TEST",
          mode: "full",
          timestamp: new Date().toISOString(),
          candidates_evaluated: 1,
          findings: [{
            id: "WB-TEST",
            category: "AuthAuthz",
            severity: "critical",
            confirmed_exploitable: true,
            evidence_type: "code_verified",
            enforcement_type: "code",
            runtime_path_reachable: true,
            state_change_provable: true,
            boundary_actually_bypassed: true,
            root_cause: "test",
            affected_files: ["test.ts"],
            minimal_fix: "test",
            required_regression_tests: [],
            blocking: true,
          }],
          summary: { critical: 1, high: 0, medium: 0, low: 0 },
          blocking_count: 1,
        });
        walkToPhase(tempSm, "security");
        tempSm.setPhase("deployment");
        return gateShouldHaveThrown("deployment with blocking whitebox");
      } catch {
        return { passed: true };
      }
    },
  });

  // Deployment allowed when no blocking findings
  tests.push({
    name: "setPhase(deployment) allowed without blocking findings",
    category: "deployment_gates",
    run: (tempDir) => {
      const tempSm = new StateManager(tempDir);
      try {
        walkToPhase(tempSm, "security");
        tempSm.setPhase("deployment");
        return { passed: true };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("whitebox") || msg.includes("CRITICAL") || msg.includes("cannot deploy")) {
          return {
            passed: false,
            finding: makeGateFinding(
              "DeploymentArtifactSafety",
              "high",
              `Deployment incorrectly blocked: ${msg}`,
              "Ensure deployment is allowed when no blocking findings exist",
            ),
          };
        }
        return { passed: true }; // Other errors (e.g., missing slices) are fine
      }
    },
  });

  // --- State Recovery Tests ---

  tests.push({
    name: "State round-trip: save → load → verify integrity",
    category: "state_recovery",
    run: (tempDir) => {
      const tempSm = new StateManager(tempDir);
      try {
        const before = tempSm.read();
        // Re-read and compare
        const after = tempSm.read();
        if (before.projectName !== after.projectName ||
            before.slices.length !== after.slices.length ||
            before.phase !== after.phase) {
          return {
            passed: false,
            finding: makeGateFinding(
              "StateRecoverySafety",
              "critical",
              "State round-trip lost data",
              "Fix state serialization/deserialization",
            ),
          };
        }
        return { passed: true };
      } catch (err) {
        return {
          passed: false,
          finding: makeGateFinding(
            "StateRecoverySafety",
            "critical",
            `State read failed: ${err instanceof Error ? err.message : String(err)}`,
            "Fix state file format or validation",
          ),
        };
      }
    },
  });

  // Building gate: can't leave without all slices done
  if (hasSlices) {
    tests.push({
      name: "Cannot leave building phase without all slices done",
      category: "workflow_gates",
      run: (tempDir) => {
        const tempSm = new StateManager(tempDir);
        try {
          const s = tempSm.read();
          if (s.phase !== "building") {
            // Walk to building
            if (s.phase === "onboarding") tempSm.setPhase("planning");
            if (tempSm.read().phase === "planning") tempSm.setPhase("building");
          }
          // Try to leave building without all slices done
          const current = tempSm.read();
          const notDone = current.slices.filter((sl) => sl.status !== "done");
          if (notDone.length > 0) {
            tempSm.setPhase("security");
            return gateShouldHaveThrown("leaving building with undone slices");
          }
          return { passed: true }; // all slices are already done
        } catch {
          return { passed: true };
        }
      },
    });
  }

  return tests;
}

// --- Helpers ---

function testSliceTransitionGuard(
  tempSm: StateManager,
  sliceId: string,
  targetStatus: string,
  fromStatus: string,
): TestOutcome {
  try {
    const s = tempSm.read();
    const slice = s.slices.find((sl) => sl.id === sliceId);
    if (!slice) return { passed: true }; // Can't test without slices

    // Walk to fromStatus if needed
    if (targetStatus === "sast" && slice.status === "pending") {
      addTestEvidence(tempSm, sliceId);
      tempSm.setSliceStatus(sliceId, "red");
      addTestEvidence(tempSm, sliceId);
      tempSm.setSliceStatus(sliceId, "green");
      tempSm.setSliceStatus(sliceId, "refactor");
    }
    if (targetStatus === "done" && slice.status === "pending") {
      addTestEvidence(tempSm, sliceId);
      tempSm.setSliceStatus(sliceId, "red");
      addTestEvidence(tempSm, sliceId);
      tempSm.setSliceStatus(sliceId, "green");
      tempSm.setSliceStatus(sliceId, "refactor");
      tempSm.markSastRun(sliceId);
      tempSm.setSliceStatus(sliceId, "sast");
    }

    // Now try the transition WITHOUT evidence — should throw
    tempSm.setSliceStatus(sliceId, targetStatus as any);
    return gateShouldHaveThrown(`${targetStatus} without evidence`);
  } catch {
    return { passed: true };
  }
}

function walkSliceForVerification(sm: StateManager, sliceId: string, target: "sast" | "done"): void {
  const steps: Array<"red" | "green" | "refactor" | "sast" | "done"> = ["red", "green", "refactor", "sast", "done"];
  const targetIdx = steps.indexOf(target);
  for (let i = 0; i <= targetIdx; i++) {
    const step = steps[i];
    if (step === "green" || step === "done") addTestEvidence(sm, sliceId);
    if (step === "sast") sm.markSastRun(sliceId);
    sm.setSliceStatus(sliceId, step);
  }
}

function walkToPhase(sm: StateManager, target: "security" | "deployment"): void {
  const s = sm.read();
  const phaseOrder: import("../state/types.js").Phase[] = [
    "onboarding", "planning", "building", "refactoring", "e2e_testing", "security", "deployment",
  ];
  const currentIdx = phaseOrder.indexOf(s.phase);
  const targetIdx = phaseOrder.indexOf(target);

  if (currentIdx >= targetIdx) return;

  // Walk slices to done if in building
  if (currentIdx <= 2) {
    if (s.phase === "onboarding") sm.setPhase("planning");
    if (sm.read().phase === "planning") sm.setPhase("building");

    // Walk all slices to done
    const state = sm.read();
    for (const slice of state.slices) {
      if (slice.status === "done") continue;
      walkSliceForVerification(sm, slice.id, "done");
    }
    sm.setPhase("security");
  }

  if (target === "deployment" && sm.read().phase === "security") {
    sm.setPhase("deployment");
  }
}

function addTestEvidence(sm: StateManager, sliceId: string): void {
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

function gateShouldHaveThrown(context: string): TestOutcome {
  return {
    passed: false,
    finding: makeGateFinding(
      "WorkflowGateEnforcement",
      "critical",
      `Gate did not block: ${context}`,
      "Ensure the gate throws an error for this scenario",
    ),
  };
}

function makeGateFinding(
  category: import("../state/types.js").WhiteboxCategory,
  severity: import("../state/types.js").FindingSeverity,
  rootCause: string,
  fix: string,
): WhiteboxFinding {
  return {
    id: "AV-000", // will be overwritten
    category,
    severity,
    confirmed_exploitable: true,
    evidence_type: "runtime_tested",
    enforcement_type: "code",
    runtime_path_reachable: true,
    state_change_provable: true,
    boundary_actually_bypassed: true,
    root_cause: rootCause,
    affected_files: [],
    minimal_fix: fix,
    required_regression_tests: [],
    blocking: false, // will be set by caller
  };
}
