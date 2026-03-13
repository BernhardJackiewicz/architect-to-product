import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { StateManager } from "../../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-plan-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

function initWithArch(dir: string) {
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
}

function makeSliceInput(id: string, deps: string[] = []) {
  return {
    id,
    name: `Slice ${id}`,
    description: `Desc ${id}`,
    acceptanceCriteria: ["works"],
    testStrategy: "pytest",
    dependencies: deps,
  };
}

describe("handleCreateBuildPlan", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates slices with correct defaults", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s01"), makeSliceInput("s02")],
      })
    );

    expect(result.success).toBe(true);
    expect(result.sliceCount).toBe(2);

    // Verify in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    for (const slice of state.slices) {
      expect(slice.status).toBe("pending");
      expect(slice.files).toEqual([]);
      expect(slice.testResults).toEqual([]);
      expect(slice.sastFindings).toEqual([]);
    }
  });

  it("detects circular dependency A->B->A", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("A", ["B"]), makeSliceInput("B", ["A"])],
      })
    );
    expect(result.error).toContain("Circular");
  });

  it("detects self-dependency A->A", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("A", ["A"])],
      })
    );
    expect(result.error).toContain("Circular");
  });

  it("detects long chain A->B->C->A", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          makeSliceInput("A", ["C"]),
          makeSliceInput("B", ["A"]),
          makeSliceInput("C", ["B"]),
        ],
      })
    );
    expect(result.error).toContain("Circular");
  });

  it("accepts valid DAG", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          makeSliceInput("A"),
          makeSliceInput("B", ["A"]),
          makeSliceInput("C", ["A"]),
          makeSliceInput("D", ["B"]),
        ],
      })
    );
    expect(result.success).toBe(true);
    expect(result.sliceCount).toBe(4);
  });

  it("accepts slice without dependencies", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s01")],
      })
    );
    expect(result.success).toBe(true);
  });

  it("rejects invalid dependency ID", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s01", ["nonexistent"])],
      })
    );
    expect(result.error).toContain("nonexistent");
  });

  it("returns error without architecture", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    // No set-architecture call
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s01")],
      })
    );
    expect(result.error).toContain("architecture");
  });

  it("sets phase to planning", () => {
    initWithArch(tmpDir);
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [makeSliceInput("s01")],
    });

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.phase).toBe("planning");
  });

  it("response has correct order numbering", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s01"), makeSliceInput("s02"), makeSliceInput("s03")],
      })
    );
    expect(result.slices[0].order).toBe(1);
    expect(result.slices[1].order).toBe(2);
    expect(result.slices[2].order).toBe(3);
  });
});
