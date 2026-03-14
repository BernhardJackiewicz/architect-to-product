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
});
