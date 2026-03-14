import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleAddSlice } from "../../src/tools/add-slice.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, initWithSlices } from "../helpers/setup.js";

describe("handleAddSlice", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-addslice");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("returns error without project", () => {
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s99",
          name: "New",
          description: "New",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
        },
      })
    );
    expect(result.error).toContain("No project");
  });

  it("appends slice to end of plan", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s03",
          name: "Integration",
          description: "Integrate library X",
          acceptanceCriteria: ["adapter works"],
          testStrategy: "jest",
          dependencies: ["s01"],
          type: "integration",
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.addedSlice.id).toBe("s03");
    expect(result.addedSlice.type).toBe("integration");
    expect(result.totalSlices).toBe(3);
    expect(result.addedSlice.position).toBe(3);
  });

  it("inserts slice after specific slice", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s01b",
          name: "Adapter",
          description: "Library adapter",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: ["s01"],
          type: "integration",
        },
        insertAfterSliceId: "s01",
      })
    );

    expect(result.success).toBe(true);
    expect(result.addedSlice.position).toBe(2);
    expect(result.totalSlices).toBe(3);

    // Verify order in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.slices[0].id).toBe("s01");
    expect(state.slices[1].id).toBe("s01b");
    expect(state.slices[2].id).toBe("s02");
  });

  it("rejects duplicate slice ID", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s01",
          name: "Duplicate",
          description: "Dupe",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
        },
      })
    );
    expect(result.error).toContain("already exists");
  });

  it("rejects invalid dependency", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s99",
          name: "Bad dep",
          description: "Bad",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: ["nonexistent"],
        },
      })
    );
    expect(result.error).toContain("nonexistent");
  });

  it("rejects invalid insertAfterSliceId", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s99",
          name: "New",
          description: "New",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
        },
        insertAfterSliceId: "nonexistent",
      })
    );
    expect(result.error).toContain("nonexistent");
  });

  it("returns error when no build plan exists", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Test",
      description: "Test",
      language: "TypeScript",
      framework: "Express",
      features: ["CRUD"],
      dataModel: "items",
      apiDesign: "REST",
    });
    // No create-build-plan call
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s01",
          name: "New",
          description: "New",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
        },
      })
    );
    expect(result.error).toContain("No build plan");
  });

  it("passes hasUI through to created slice", () => {
    initWithSlices(tmpDir);
    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s03",
          name: "Dashboard",
          description: "Dashboard UI",
          acceptanceCriteria: ["renders dashboard"],
          testStrategy: "jest + visual",
          dependencies: [],
          hasUI: true,
        },
      })
    );

    expect(result.success).toBe(true);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    const added = state.slices.find((s) => s.id === "s03");
    expect(added?.hasUI).toBe(true);
  });

  it("sets productPhaseId from current phase when not specified", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Test",
      description: "Test",
      language: "TypeScript",
      framework: "Express",
      features: ["CRUD"],
      dataModel: "items",
      apiDesign: "REST",
      phases: [
        { id: "phase-0", name: "Spike", description: "Spikes", deliverables: ["eval"], timeline: "W1" },
        { id: "phase-1", name: "MVP", description: "MVP", deliverables: ["build"], timeline: "W2" },
      ],
    });
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "s01",
          name: "Spike",
          description: "Spike",
          acceptanceCriteria: ["works"],
          testStrategy: "manual",
          dependencies: [],
          productPhaseId: "phase-0",
        },
      ],
    });

    const result = parse(
      handleAddSlice({
        projectPath: tmpDir,
        slice: {
          id: "s02",
          name: "New",
          description: "New slice",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.addedSlice.productPhaseId).toBe("phase-0");
  });
});
