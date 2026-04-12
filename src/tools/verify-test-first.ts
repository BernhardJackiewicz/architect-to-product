import { z } from "zod";
import { spawnSync } from "node:child_process";
import { requireProject } from "../utils/tool-helpers.js";
import { getSliceDiffSinceBaseline, classifyFiles, DEFAULT_TEST_PATTERNS } from "../utils/slice-diff.js";
import type { TestFirstGuardArtifact, TestResult } from "../state/types.js";

export const verifyTestFirstSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice whose baseline is being verified"),
  testCommand: z
    .string()
    .optional()
    .describe("Test command to run; defaults to project config or 'npm test'"),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .max(600_000)
    .optional()
    .describe("Hard cap on the failing-test run (default 120000)"),
});

export type VerifyTestFirstInput = z.infer<typeof verifyTestFirstSchema>;

export function handleVerifyTestFirst(input: VerifyTestFirstInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  const slice = state.slices.find((s) => s.id === input.sliceId);
  if (!slice) {
    return JSON.stringify({ error: `Slice "${input.sliceId}" not found` });
  }

  if (slice.status !== "ready_for_red" && slice.status !== "completion_fix") {
    return JSON.stringify({
      error: `Slice "${input.sliceId}": a2p_verify_test_first is only valid when status=ready_for_red or completion_fix. Current status: ${slice.status}`,
    });
  }

  if (!slice.baseline) {
    return JSON.stringify({
      error: `Slice "${input.sliceId}": no baseline captured. Transition to ready_for_red again via a2p_update_slice.`,
    });
  }

  const now = new Date().toISOString();
  const baseArtifact = {
    redTestsDeclaredAt: now,
    baselineCommit: slice.baseline.commit,
    baselineCapturedAt: slice.baseline.capturedAt,
  } as const;

  // completion_fix drift-recovery bypass (Bug #3 dogfood fix):
  // If the slice is in completion_fix and the last test result is green,
  // test-first discipline was already proven in the original cycle. Re-proving
  // it when the code is already correct is both impossible (no failing tests
  // to produce) and unnecessary (the original red→green cycle already proved
  // tests were written first). Auto-pass the guard.
  if (slice.status === "completion_fix") {
    const lastTest = slice.testResults[slice.testResults.length - 1];
    if (lastTest && lastTest.exitCode === 0) {
      const artifact: TestFirstGuardArtifact = {
        ...baseArtifact,
        redTestsRunAt: lastTest.timestamp,
        redFailingEvidence: null,
        testFilesTouched: [],
        nonTestFilesTouchedBeforeRedEvidence: [],
        guardVerdict: "pass",
        evidenceReason: `completion_fix drift-recovery: test-first inherited from original cycle; last test run green (exit ${lastTest.exitCode}, ${lastTest.passed} passed)`,
      };
      sm.storeTestFirstGuard(input.sliceId, artifact);
      return JSON.stringify({
        guardVerdict: "pass",
        mode: "completion_fix_inherited",
        evidenceReason: artifact.evidenceReason,
        nextStep: "a2p_update_slice status=red",
      });
    }
  }

  // 1. Diff classification
  const changed = getSliceDiffSinceBaseline(input.projectPath, slice.baseline);
  const projectPatterns = state.architecture?.testFilePatterns;
  const effectivePatterns =
    projectPatterns && projectPatterns.length > 0
      ? projectPatterns
      : DEFAULT_TEST_PATTERNS;
  const { test: testFiles, production: prodFiles } = classifyFiles(
    changed,
    effectivePatterns,
  );

  if (prodFiles.length > 0) {
    const artifact: TestFirstGuardArtifact = {
      ...baseArtifact,
      redTestsRunAt: null,
      redFailingEvidence: null,
      testFilesTouched: testFiles,
      nonTestFilesTouchedBeforeRedEvidence: prodFiles,
      guardVerdict: "fail",
      evidenceReason: `production files changed before failing test run: ${prodFiles.slice(0, 10).join(", ")}${prodFiles.length > 10 ? "…" : ""}`,
    };
    sm.storeTestFirstGuard(input.sliceId, artifact);
    return JSON.stringify({
      error: artifact.evidenceReason,
      guardVerdict: "fail",
      nonTestFilesTouched: prodFiles,
      hint: "Revert the non-test changes (git restore or equivalent), write failing tests first, then re-run a2p_verify_test_first.",
    });
  }

  if (testFiles.length === 0) {
    const artifact: TestFirstGuardArtifact = {
      ...baseArtifact,
      redTestsRunAt: null,
      redFailingEvidence: null,
      testFilesTouched: [],
      nonTestFilesTouchedBeforeRedEvidence: [],
      guardVerdict: "fail",
      evidenceReason: "no test files changed since baseline",
    };
    sm.storeTestFirstGuard(input.sliceId, artifact);
    return JSON.stringify({
      error: artifact.evidenceReason,
      guardVerdict: "fail",
      hint: "Add or modify at least one test file that reflects the failing behavior you intend to implement, then re-run a2p_verify_test_first.",
    });
  }

  // 2. Run the test command — we expect a NON-ZERO exit
  const cmd =
    input.testCommand && input.testCommand.trim().length > 0
      ? input.testCommand
      : state.config.testCommand && state.config.testCommand.trim().length > 0
        ? state.config.testCommand
        : "npm test";
  const timeoutMs = input.timeoutMs ?? 120_000;

  const res = spawnSync(cmd, {
    cwd: input.projectPath,
    shell: true,
    encoding: "utf-8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // spawnSync sets `signal` when the process was killed (e.g. SIGTERM from
  // timeout). We treat that as a failure verdict with an explicit "timeout"
  // reason — NOT as a passing guard — so the slice doesn't advance on a
  // stalled test run.
  const timedOut = (res as { signal?: string | null }).signal != null;
  if (timedOut) {
    const artifact: TestFirstGuardArtifact = {
      ...baseArtifact,
      redTestsRunAt: null,
      redFailingEvidence: null,
      testFilesTouched: testFiles,
      nonTestFilesTouchedBeforeRedEvidence: [],
      guardVerdict: "fail",
      evidenceReason: `test command timed out after ${timeoutMs}ms (killed by ${(res as { signal?: string }).signal ?? "timeout"})`,
    };
    sm.storeTestFirstGuard(input.sliceId, artifact);
    return JSON.stringify({
      error: artifact.evidenceReason,
      guardVerdict: "fail",
      hint: "Increase timeoutMs or narrow the failing test to a focused subset, then re-run a2p_verify_test_first.",
    });
  }

  const exitCode = res.status ?? -1;
  const stdout = (res.stdout ?? "").toString();
  const stderr = (res.stderr ?? "").toString();
  const output = [stdout, stderr].filter(Boolean).join("\n").slice(0, 10_000);

  // Record as a normal TestResult so it shows up in slice.testResults for audit.
  // addTestResult may bump the timestamp via the monotonic helper (when a
  // prior completion review exists on the slice) — we MUST read the persisted
  // timestamp back, not reuse the local one, or the state-manager's
  // cross-check in requireTestFirstGuardPassed will reject the guard.
  const localTestResult: TestResult = {
    timestamp: new Date().toISOString(),
    command: cmd,
    exitCode,
    passed: 0,
    failed: exitCode === 0 ? 0 : 1,
    skipped: 0,
    output,
  };
  const afterAddState = sm.addTestResult(input.sliceId, localTestResult);
  const updatedSlice = afterAddState.slices.find((s) => s.id === input.sliceId);
  const persistedTimestamp =
    updatedSlice?.testResults.at(-1)?.timestamp ?? localTestResult.timestamp;

  if (exitCode === 0) {
    const artifact: TestFirstGuardArtifact = {
      ...baseArtifact,
      redTestsRunAt: persistedTimestamp,
      redFailingEvidence: { exitCode, testCommand: cmd, failedCount: 0 },
      testFilesTouched: testFiles,
      nonTestFilesTouchedBeforeRedEvidence: [],
      guardVerdict: "fail",
      evidenceReason: "tests passed; expected a failing run proving the test was written before the implementation",
    };
    sm.storeTestFirstGuard(input.sliceId, artifact);
    return JSON.stringify({
      error: artifact.evidenceReason,
      guardVerdict: "fail",
      testCommand: cmd,
      hint: "The new test must actually fail against the current implementation. Tighten the assertion so it reflects a behavior that doesn't exist yet, then re-run.",
    });
  }

  // Success path
  const artifact: TestFirstGuardArtifact = {
    ...baseArtifact,
    redTestsRunAt: persistedTimestamp,
    redFailingEvidence: { exitCode, testCommand: cmd, failedCount: null },
    testFilesTouched: testFiles,
    nonTestFilesTouchedBeforeRedEvidence: [],
    guardVerdict: "pass",
    evidenceReason: `failing test run recorded (exit ${exitCode}); ${testFiles.length} test file(s) touched, 0 production files touched`,
  };
  sm.storeTestFirstGuard(input.sliceId, artifact);

  return JSON.stringify({
    success: true,
    sliceId: input.sliceId,
    guardVerdict: "pass",
    testFilesTouched: testFiles,
    testCommand: cmd,
    failingExitCode: exitCode,
    nextStep:
      "a2p_update_slice status=red — A2P has verified test-first discipline against the current baseline. You may now implement until tests pass, then move to green.",
  });
}
