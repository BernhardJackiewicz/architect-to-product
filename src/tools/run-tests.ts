import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import { runProcess } from "../utils/process-runner.js";
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
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

  const state = sm.read();
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
    output: truncate(result.stdout + (result.stderr ? "\n---STDERR---\n" + result.stderr : ""), 5000),
  };

  sm.addTestResult(input.sliceId, testResult);

  return JSON.stringify({
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    output: testResult.output,
    hint: result.exitCode === 0
      ? "All tests passed!"
      : "Tests failed. Review the output and fix the issues.",
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

  return { passed, failed, skipped };
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n... (truncated)";
}
