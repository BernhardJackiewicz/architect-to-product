import { z } from "zod";
import { requireProject, requirePhase, truncate } from "../utils/tool-helpers.js";
import { runProcess } from "../utils/process-runner.js";
import { generateRunId, sanitizeOutput, truncatePreview } from "../utils/log-sanitizer.js";
import type { EventMetadata } from "../state/types.js";
import type { TestResult } from "../state/types.js";

export const runTestsSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("ID of the slice being tested"),
  command: z
    .string()
    .optional()
    .describe("Test command to run (defaults to project config testCommand)"),
  timeoutMs: z
    .number()
    .optional()
    .describe("Timeout in milliseconds (default: 120000)"),
});

export type RunTestsInput = z.infer<typeof runTestsSchema>;

export function handleRunTests(input: RunTestsInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["building"], "a2p_run_tests"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  // Block test command override when a test command is configured (unless escape hatch enabled)
  if (input.command && state.config.testCommand && !state.config.allowTestCommandOverride) {
    return JSON.stringify({
      error: `Test command override not allowed. Set config.allowTestCommandOverride=true to enable. Configured: "${state.config.testCommand}".`,
    });
  }
  const testCommand = input.command ?? state.config.testCommand;

  if (!testCommand) {
    return JSON.stringify({
      error: "No test command configured. Set it via a2p_set_architecture or pass command parameter.",
    });
  }

  const result = runProcess(testCommand, input.projectPath, input.timeoutMs ?? 120_000);

  // Try to parse test counts from output
  const counts = parseTestCounts(result.stdout + "\n" + result.stderr);

  const testResult: TestResult = {
    timestamp: new Date().toISOString(),
    command: testCommand,
    exitCode: result.exitCode,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    output: sanitizeOutput(truncate(result.stdout + (result.stderr ? "\n---STDERR---\n" + result.stderr : ""), 5000)),
  };

  sm.addTestResult(input.sliceId, testResult);

  const runId = generateRunId();
  const preview = truncatePreview(sanitizeOutput(result.stdout + (result.stderr ? "\n" + result.stderr : "")));

  sm.log(result.exitCode === 0 ? "info" : "error", "test_run", `Tests: ${counts.passed} passed, ${counts.failed} failed`, {
    sliceId: input.sliceId,
    status: result.exitCode === 0 ? "success" : "failure",
    durationMs: result.durationMs,
    runId,
    metadata: { passed: counts.passed, failed: counts.failed, skipped: counts.skipped, exitCode: result.exitCode, command: testCommand } as EventMetadata,
    outputSummary: preview,
  });

  const countsParsed = counts.passed > 0 || counts.failed > 0 || counts.skipped > 0;

  return JSON.stringify({
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    countsParsed,
    durationMs: result.durationMs,
    output: testResult.output,
    hint: result.exitCode === 0
      ? "All tests passed!"
      : countsParsed
        ? "Tests failed. Review the output and fix the issues."
        : "Tests failed. Could not parse test counts — check the raw output.",
  });
}

/**
 * Best-effort parsing of test counts from various frameworks.
 */
function parseTestCounts(output: string): {
  passed: number;
  failed: number;
  skipped: number;
} {
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  // Strip ANSI escape codes and normalize \r to \n before parsing
  // Handles colored output from dart test, flutter test, and other runners
  output = output.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r/g, '\n');

  // pytest: "5 passed, 2 failed, 1 skipped"
  const pytestMatch = output.match(
    /(\d+)\s+passed(?:.*?(\d+)\s+failed)?(?:.*?(\d+)\s+skipped)?/
  );
  if (pytestMatch) {
    passed = parseInt(pytestMatch[1], 10) || 0;
    failed = parseInt(pytestMatch[2], 10) || 0;
    skipped = parseInt(pytestMatch[3], 10) || 0;
    return { passed, failed, skipped };
  }

  // vitest/jest: "Tests  5 passed | 2 failed | 1 skipped"
  const vitestMatch = output.match(
    /(\d+)\s+passed.*?(\d+)\s+failed/
  );
  if (vitestMatch) {
    passed = parseInt(vitestMatch[1], 10) || 0;
    failed = parseInt(vitestMatch[2], 10) || 0;
    const skipMatch = output.match(/(\d+)\s+skipped/);
    skipped = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    return { passed, failed, skipped };
  }

  // Go: "ok" lines for passed, "FAIL" for failed
  const goPassMatch = output.match(/ok\s+/g);
  const goFailMatch = output.match(/FAIL\s+/g);
  if (goPassMatch || goFailMatch) {
    passed = goPassMatch?.length ?? 0;
    failed = goFailMatch?.length ?? 0;
    return { passed, failed, skipped };
  }

  // Flutter/Dart: "00:05 +10: All tests passed!" or "00:05 +10 -2: Some tests failed."
  // Use last match — progress output starts with +0 (loading), final line has actual counts
  const flutterMatches = [...output.matchAll(/\+(\d+)(?:\s+(?:~(\d+)))?(?:\s+-(\d+))?:/g)];
  const flutterMatch = flutterMatches.length > 0 ? flutterMatches[flutterMatches.length - 1] : null;
  if (flutterMatch) {
    passed = parseInt(flutterMatch[1], 10) || 0;
    skipped = parseInt(flutterMatch[2], 10) || 0;
    failed = parseInt(flutterMatch[3], 10) || 0;
    return { passed, failed, skipped };
  }

  // Swift XCTest: "Executed 5 tests, with 1 failure"
  const xctestMatch = output.match(/Executed\s+(\d+)\s+tests?,\s+with\s+(\d+)\s+failure/);
  if (xctestMatch) {
    const total = parseInt(xctestMatch[1], 10) || 0;
    failed = parseInt(xctestMatch[2], 10) || 0;
    passed = total - failed;
    return { passed, failed, skipped };
  }

  // Kotlin/Gradle: multiple patterns — Gradle output varies by version and config
  // Pattern 1: "5 tests completed, 1 failed" (--console=plain)
  const gradleMatch = output.match(/(\d+)\s+tests?\s+completed?,\s*(\d+)\s+failed/);
  if (gradleMatch) {
    const total = parseInt(gradleMatch[1], 10) || 0;
    failed = parseInt(gradleMatch[2], 10) || 0;
    passed = total - failed;
    return { passed, failed, skipped };
  }
  // Pattern 2: "BUILD SUCCESSFUL" with "N tests" in task output
  // Gradle default output: "N tests completed, N failed" or just "> Task :test" with no summary
  // Parse from JUnit XML summary if present: tests="N" failures="N" errors="N" skipped="N"
  const junitMatch = output.match(/tests="(\d+)".*?failures="(\d+)"(?:.*?errors="(\d+)")?(?:.*?skipped="(\d+)")?/);
  if (junitMatch) {
    const total = parseInt(junitMatch[1], 10) || 0;
    failed = (parseInt(junitMatch[2], 10) || 0) + (parseInt(junitMatch[3], 10) || 0);
    skipped = parseInt(junitMatch[4], 10) || 0;
    passed = total - failed - skipped;
    return { passed, failed, skipped };
  }
  // Pattern 3: Gradle "N tests, N failures" (some Gradle versions)
  const gradleAltMatch = output.match(/(\d+)\s+tests?,\s*(\d+)\s+failures?/);
  if (gradleAltMatch) {
    const total = parseInt(gradleAltMatch[1], 10) || 0;
    failed = parseInt(gradleAltMatch[2], 10) || 0;
    passed = total - failed;
    return { passed, failed, skipped };
  }

  return { passed, failed, skipped };
}

