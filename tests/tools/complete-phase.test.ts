import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleCompletePhase } from "../../src/tools/complete-phase.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, addPassingTests, addSastEvidence, addQualityAudit, addReleaseAudit, addPassingVerification, addPassingWhitebox } from "../helpers/setup.js";

const twoPhases = [
  {
    id: "phase-0",
    name: "Spikes",
    description: "Evaluate tools",
    deliverables: ["Spike A"],
    timeline: "Week 1",
  },
  {
    id: "phase-1",
    name: "MVP",
    description: "Build MVP",
    deliverables: ["Feature A", "Feature B"],
    timeline: "Weeks 2-4",
  },
];

function setupMultiPhaseProject(dir: string) {
  handleInitProject({ projectPath: dir, projectName: "multi-phase" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Multi Phase App",
    description: "App with phases",
    language: "TypeScript",
    framework: "Express",
    features: ["Spike A", "Feature A", "Feature B"],
    dataModel: "items",
    apiDesign: "REST",
    phases: twoPhases,
  });
  handleCreateBuildPlan({
    projectPath: dir,
    slices: [
      {
        id: "s01",
        name: "Spike A",
        description: "Evaluate tool",
        acceptanceCriteria: ["tool works"],
        testStrategy: "manual",
        dependencies: [],
        productPhaseId: "phase-0",
      },
    ],
  });
}

function completeSlice(sm: StateManager, sliceId: string) {
  sm.setSliceStatus(sliceId, "red");
  addPassingTests(sm, sliceId);
  sm.setSliceStatus(sliceId, "green");
  sm.setSliceStatus(sliceId, "refactor");
  addSastEvidence(sm, sliceId);
  sm.setSliceStatus(sliceId, "sast");
  addPassingTests(sm, sliceId);
  sm.setSliceStatus(sliceId, "done");
}

describe("handleCompletePhase", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-phase");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("returns error without project", () => {
    const result = parse(handleCompletePhase({ projectPath: tmpDir }));
    expect(result.error).toContain("No project");
  });

  it("returns error for project without phases", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "no-phases" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Simple",
      description: "Simple",
      language: "Python",
      framework: "FastAPI",
      features: ["CRUD"],
      dataModel: "items",
      apiDesign: "REST",
    });
    const result = parse(handleCompletePhase({ projectPath: tmpDir }));
    expect(result.error).toContain("No product phases");
  });

  it("returns error when slices not done", () => {
    setupMultiPhaseProject(tmpDir);
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    // Cannot leave building with incomplete slices
    expect(() => sm.setPhase("security")).toThrow("not done");
  });

  it("returns nextPhase with all fields (deliverables, timeline)", () => {
    setupMultiPhaseProject(tmpDir);
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    completeSlice(sm, "s01");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    const result = parse(handleCompletePhase({ projectPath: tmpDir }));
    expect(result.nextPhase.id).toBe("phase-1");
    expect(result.nextPhase.name).toBe("MVP");
    expect(result.nextPhase.description).toBe("Build MVP");
    expect(result.nextPhase.deliverables).toEqual(["Feature A", "Feature B"]);
    expect(result.nextPhase.timeline).toBe("Weeks 2-4");
    expect(result.nextPhase.index).toBe(1);
  });

  it("advances to next phase when slices done", () => {
    setupMultiPhaseProject(tmpDir);
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    completeSlice(sm, "s01");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    const result = parse(handleCompletePhase({ projectPath: tmpDir }));
    expect(result.success).toBe(true);
    expect(result.completedPhase).toBe("Spikes");
    expect(result.projectComplete).toBe(false);
    expect(result.nextPhase.name).toBe("MVP");
    expect(result.nextPhase.id).toBe("phase-1");

    // Verify state
    const state = sm.read();
    expect(state.phase).toBe("planning");
    expect(state.currentProductPhase).toBe(1);
  });

  it("completes project on last phase", () => {
    setupMultiPhaseProject(tmpDir);
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    completeSlice(sm, "s01");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    // Complete phase 0 → go to phase 1
    handleCompletePhase({ projectPath: tmpDir });

    // Plan phase 1 slices
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "s02",
          name: "Feature A",
          description: "Build feature A",
          acceptanceCriteria: ["works"],
          testStrategy: "jest",
          dependencies: [],
          productPhaseId: "phase-1",
        },
      ],
      append: true,
    });

    sm.setPhase("building");
    completeSlice(sm, "s02");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");

    const result = parse(handleCompletePhase({ projectPath: tmpDir }));
    expect(result.success).toBe(true);
    expect(result.completedPhase).toBe("MVP");
    expect(result.projectComplete).toBe(true);

    const state = sm.read();
    expect(state.phase).toBe("complete");
  });
});
