import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleRunTests } from "../../src/tools/run-tests.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-runtests-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

function setupProject(dir: string) {
  handleInitProject({ projectPath: dir, projectName: "test" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Test",
    description: "Test",
    language: "Python",
    framework: "FastAPI",
    features: ["CRUD"],
    dataModel: "items",
    apiDesign: "REST",
  });
  handleCreateBuildPlan({
    projectPath: dir,
    slices: [
      {
        id: "s01",
        name: "Setup",
        description: "Setup",
        acceptanceCriteria: ["works"],
        testStrategy: "pytest",
        dependencies: [],
      },
    ],
  });
}

describe("handleRunTests", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    setupProject(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
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

  it("command parameter overrides config testCommand", () => {
    // Set config testCommand to something that would fail
    const sm = new StateManager(tmpDir);
    sm.updateConfig({ testCommand: "echo config_output" });

    // Pass a different command as parameter
    const result = parse(
      handleRunTests({
        projectPath: tmpDir,
        sliceId: "s01",
        command: "echo override_output",
      })
    );
    expect(result.output).toContain("override_output");
    expect(result.output).not.toContain("config_output");
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
