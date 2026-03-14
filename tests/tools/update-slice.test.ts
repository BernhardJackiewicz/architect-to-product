import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";
import type { ReviewMode } from "../../src/state/types.js";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";

const baseArchInput = {
  name: "Test App",
  description: "A test app",
  language: "TypeScript",
  framework: "Express",
  features: ["CRUD"],
  dataModel: "users",
  apiDesign: "REST",
};

function setupProject(tmpDir: string, reviewMode?: ReviewMode, hasUI = false) {
  handleInitProject({ projectPath: tmpDir, projectName: "test" });
  handleSetArchitecture({
    projectPath: tmpDir,
    ...baseArchInput,
    ...(reviewMode ? { reviewMode } : {}),
  });

  handleCreateBuildPlan({
    projectPath: tmpDir,
    slices: [
      {
        id: "slice-1",
        name: "Slice A",
        description: "A slice",
        acceptanceCriteria: ["works"],
        testStrategy: "unit",
        dependencies: [],
        hasUI,
      },
    ],
  });

  // Transition to building phase
  const sm = new StateManager(tmpDir);
  sm.setPhase("building");

  // Walk the slice through to sast so we can mark done
  const sliceId = "slice-1";
  handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "red" });
  handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "green" });
  handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "refactor" });
  handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "sast" });

  return sliceId;
}

describe("handleUpdateSlice checkpoint logic", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-update");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("reviewMode 'all' + done → awaitingHumanReview: true", () => {
    const sliceId = setupProject(tmpDir, "all");
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(true);
    expect(result.nextStep).toContain("CHECKPOINT");
    expect(result.sliceSummary).toBeDefined();
  });

  it("reviewMode 'ui-only' + hasUI: true + done → awaitingHumanReview: true", () => {
    const sliceId = setupProject(tmpDir, "ui-only", true);
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(true);
    expect(result.nextStep).toContain("CHECKPOINT");
  });

  it("reviewMode 'ui-only' + hasUI: false + done → awaitingHumanReview: false", () => {
    const sliceId = setupProject(tmpDir, "ui-only", false);
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(false);
    expect(result.nextStep).not.toContain("CHECKPOINT");
  });

  it("reviewMode 'off' + done → awaitingHumanReview: false", () => {
    const sliceId = setupProject(tmpDir, "off");
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(false);
  });

  it("no reviewMode set + done → awaitingHumanReview: false", () => {
    const sliceId = setupProject(tmpDir);
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(false);
  });

  it("non-done status → awaitingHumanReview: false", () => {
    // Setup project but only go to red
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    handleSetArchitecture({
      projectPath: tmpDir,
      ...baseArchInput,
      reviewMode: "all",
    });

    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "slice-1",
          name: "Slice B",
          description: "B slice",
          acceptanceCriteria: ["works"],
          testStrategy: "unit",
          dependencies: [],
        },
      ],
    });

    const sm = new StateManager(tmpDir);
    sm.setPhase("building");

    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "slice-1", status: "red" })
    );

    expect(result.success).toBe(true);
    expect(result.awaitingHumanReview).toBe(false);
  });

  it("done status always includes sliceSummary hint", () => {
    const sliceId = setupProject(tmpDir, "off");
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.sliceSummary).toBeDefined();
    expect(result.sliceSummary.hint).toContain("Zusammenfassung");
  });

  it("non-done status has no sliceSummary", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    handleSetArchitecture({
      projectPath: tmpDir,
      ...baseArchInput,
      reviewMode: "all",
    });

    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "slice-1",
          name: "Slice C",
          description: "C slice",
          acceptanceCriteria: ["works"],
          testStrategy: "unit",
          dependencies: [],
        },
      ],
    });

    const sm = new StateManager(tmpDir);
    sm.setPhase("building");

    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "slice-1", status: "red" })
    );

    expect(result.sliceSummary).toBeUndefined();
  });

  it("checkpoint text contains slice name", () => {
    const sliceId = setupProject(tmpDir, "all");
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.nextStep).toContain("Slice A");
  });

  it("ui-only checkpoint includes sliceSummary", () => {
    const sliceId = setupProject(tmpDir, "ui-only", true);
    const result = parse(
      handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" })
    );

    expect(result.sliceSummary).toBeDefined();
    expect(result.sliceSummary.hint).toContain("Zusammenfassung");
  });
});
