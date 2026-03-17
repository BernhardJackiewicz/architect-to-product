import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleRunTests } from "../../src/tools/run-tests.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, initWithSlices, forcePhase } from "../helpers/setup.js";

describe("handleRunTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-runtests");
    initWithSlices(tmpDir, 1, { language: "Python", framework: "FastAPI", testStrategy: "pytest" });
    forcePhase(tmpDir, "building");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("parses pytest-style output", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo '5 passed, 2 failed, 1 skipped'",
      })
    );
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("parses vitest/jest-style output", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo 'Tests  5 passed | 2 failed | 1 skipped'",
      })
    );
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(2);
    expect(result.skipped).toBe(1);
  });

  it("empty output yields zeroes", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo ''",
      })
    );
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("exit code 0 -> success true", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "true",
      })
    );
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("exit code != 0 -> success false", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "false",
      })
    );
    expect(result.success).toBe(false);
    expect(result.exitCode).not.toBe(0);
  });

  it("output is truncated at ~5000 chars", () => {
    // Generate >5000 chars of output
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "python3 -c \"print('x' * 6000)\"",
      })
    );
    expect(result.output.length).toBeLessThanOrEqual(5100);
  });

  it("returns error without test command", () => {
    // Config has no testCommand set by default, and we pass no command parameter
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
      })
    );
    expect(result.error).toBeTruthy();
  });

  it("command parameter override is blocked when config testCommand is set", () => {
    // Set config testCommand
    const sm = new StateManager(tmpDir);
    sm.updateConfig({ testCommand: "echo config_output" });

    // Pass a different command as parameter — should be blocked
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo override_output",
      })
    );
    expect(result.error).toContain("override not allowed");
  });

  it("test result is stored in state", () => {
    handleRunTests({
      projectPath: tmpDir,
      sliceId: "s01",
      command: "echo '3 passed'",
    });

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.slices[0].testResults.length).toBe(1);
    expect(state.slices[0].testResults[0].passed).toBe(3);
  });

  it("uses config testCommand when no command parameter given", () => {
    const sm = new StateManager(tmpDir);
    sm.updateConfig({ testCommand: "echo from_config" });

    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
      })
    );
    expect(result.output).toContain("from_config");
  });

  // ─── Flutter/Dart test output parsing ─────────────────────────────────

  it("parses Flutter-style output (all passed)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo '00:05 +10: All tests passed!'",
      })
    );
    expect(result.passed).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("parses Flutter-style output (with failures)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf '00:05 +8 -2: Some tests failed.'; exit 1",
      })
    );
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(2);
  });

  it("parses Flutter-style output (with skipped)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo '00:03 +7 ~2 -1: Some tests failed.'",
      })
    );
    expect(result.passed).toBe(7);
    expect(result.skipped).toBe(2);
    expect(result.failed).toBe(1);
  });

  // ─── XCTest output parsing ────────────────────────────────────────────

  it("parses XCTest-style output (all passed)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo 'Executed 12 tests, with 0 failures (0 unexpected) in 1.234 (1.345) seconds'",
      })
    );
    expect(result.passed).toBe(12);
    expect(result.failed).toBe(0);
  });

  it("parses XCTest-style output (with failures)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf 'Executed 10 tests, with 3 failures in 2.0 seconds'; exit 1",
      })
    );
    expect(result.passed).toBe(7);
    expect(result.failed).toBe(3);
  });

  // ─── Gradle/Kotlin output parsing ─────────────────────────────────────

  it("parses Gradle-style output (with failures)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf '15 tests completed, 2 failed'; exit 1",
      })
    );
    expect(result.passed).toBe(13);
    expect(result.failed).toBe(2);
  });

  it("parses Gradle-style output (all passed)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo '8 tests completed, 0 failed'",
      })
    );
    expect(result.passed).toBe(8);
    expect(result.failed).toBe(0);
  });

  // ─── ANSI / carriage-return robustness ────────────────────────────────

  it("parses Flutter output with ANSI escape codes", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf '\\033[32m+15\\033[0m: All tests passed!'",
      })
    );
    expect(result.passed).toBe(15);
    expect(result.failed).toBe(0);
    expect(result.countsParsed).toBe(true);
  });

  it("parses Flutter output taking last count (not first +0)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf '+0: loading\\n+10: All tests passed!'",
      })
    );
    expect(result.passed).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.countsParsed).toBe(true);
  });

  it("parses Flutter output with carriage returns", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "printf '\\r+0: loading\\r+12: All tests passed!'",
      })
    );
    expect(result.passed).toBe(12);
    expect(result.failed).toBe(0);
    expect(result.countsParsed).toBe(true);
  });

  // ─── Gradle JUnit XML parsing ─────────────────────────────────────────

  it("parses Gradle JUnit XML summary", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: `echo '<testsuite tests="14" failures="1" errors="0" skipped="2">'`,
      })
    );
    expect(result.passed).toBe(11);
    expect(result.failed).toBe(1);
    expect(result.skipped).toBe(2);
    expect(result.countsParsed).toBe(true);
  });

  it("parses Gradle alternative format (N tests, N failures)", () => {
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo '22 tests, 0 failures'",
      })
    );
    expect(result.passed).toBe(22);
    expect(result.failed).toBe(0);
    expect(result.countsParsed).toBe(true);
  });

  it("produces exactly 1 test_run event per run (no duplicates)", () => {
    handleRunTests({
      projectPath: tmpDir,
      sliceId: "s01",
      command: "echo '3 passed, 0 failed'",
    });

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    const testRunEvents = state.buildHistory.filter(
      (e: any) => e.action === "test_run"
    );
    expect(testRunEvents.length).toBe(1);
    // The single event should carry metadata
    expect(testRunEvents[0].metadata).toBeDefined();
    expect(testRunEvents[0].metadata.passed).toBe(3);
  });
});
