import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, initWithArch, walkSliceToStatus, addQualityAudit, addReleaseAudit, addPassingVerification, addPassingWhitebox } from "../helpers/setup.js";

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
    tmpDir = makeTmpDir("a2p-plan");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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

  it("append mode adds slices to existing plan", () => {
    initWithArch(tmpDir);
    // First plan
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [makeSliceInput("s01"), makeSliceInput("s02")],
    });

    // Complete slices, then move through phases
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s01", "done");
    walkSliceToStatus(sm, "s02", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s03"), makeSliceInput("s04", ["s01"])],
        append: true,
      })
    );

    expect(result.success).toBe(true);
    expect(result.sliceCount).toBe(2);
    expect(result.totalSlices).toBe(4);
    expect(result.appended).toBe(true);
    expect(result.slices[0].order).toBe(3); // continues from existing
    expect(result.slices[1].order).toBe(4);

    // Verify in state
    const state = sm.read();
    expect(state.slices.length).toBe(4);
  });

  it("append mode validates deps against existing + new slices", () => {
    initWithArch(tmpDir);
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [makeSliceInput("s01")],
    });

    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s01", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    // s03 depends on s01 (existing) — should work
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s03", ["s01"])],
        append: true,
      })
    );
    expect(result.success).toBe(true);
  });

  it("append mode rejects dep that exists in neither old nor new slices", () => {
    initWithArch(tmpDir);
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [makeSliceInput("s01")],
    });

    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s01", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [makeSliceInput("s03", ["ghost"])],
        append: true,
      })
    );
    expect(result.error).toContain("ghost");
  });

  it("passes productPhaseId and type through to slices", () => {
    initWithArch(tmpDir);
    const result = parse(
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            ...makeSliceInput("s01"),
            productPhaseId: "phase-0",
            type: "integration" as const,
            hasUI: true,
          },
        ],
      })
    );

    expect(result.success).toBe(true);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.slices[0].productPhaseId).toBe("phase-0");
    expect(state.slices[0].type).toBe("integration");
    expect(state.slices[0].hasUI).toBe(true);
  });
});
