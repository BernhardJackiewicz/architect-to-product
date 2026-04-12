import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  makeTmpDir,
  cleanTmpDir,
  initWithArch,
  walkSliceToStatus,
  addPassingTests,
} from "../helpers/setup.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";

describe("bootstrap slice invariants", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-bootstrap");
    initWithArch(dir);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("accepts a single bootstrap slice as the first slice", () => {
    const res = JSON.parse(
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "s0",
            name: "Bootstrap",
            description: "boot",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
            bootstrap: true,
          },
          {
            id: "s1",
            name: "Next",
            description: "next",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: ["s0"],
          },
        ],
      }),
    );
    expect(res.success).toBe(true);
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.bootstrapSliceId).toBe("s0");
    expect(state.bootstrapLockedAt).toBeNull();
  });

  it("rejects two bootstrap slices in the same plan", () => {
    expect(() =>
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "s0",
            name: "Bootstrap",
            description: "",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
            bootstrap: true,
          },
          {
            id: "s1",
            name: "Also Bootstrap",
            description: "",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
            bootstrap: true,
          },
        ],
      }),
    ).toThrow(/more than one bootstrap/);
  });

  it("rejects a bootstrap slice that is not first", () => {
    expect(() =>
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "s0",
            name: "Normal",
            description: "",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
          },
          {
            id: "s1",
            name: "Late bootstrap",
            description: "",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
            bootstrap: true,
          },
        ],
      }),
    ).toThrow(/must be the first slice/);
  });

  it("bootstrap slice walks the legacy flow end-to-end", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s0",
          name: "Bootstrap",
          description: "",
          acceptanceCriteria: ["AC1"],
          testStrategy: "unit",
          dependencies: [],
          bootstrap: true,
        },
      ],
    });
    const sm = new StateManager(dir);
    sm.setPhase("building");
    // Legacy walk (no hardening, no guard)
    sm.setSliceStatus("s0", "red");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "green");
    sm.setSliceStatus("s0", "refactor");
    sm.markSastRun("s0");
    sm.setSliceStatus("s0", "sast");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "done");
    const state = sm.read();
    expect(state.slices[0].status).toBe("done");
    expect(state.bootstrapLockedAt).not.toBeNull();
  });

  it("B-1: bootstrap slice attempting ready_for_red is rejected (legacy flow only)", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s0",
          name: "Bootstrap",
          description: "",
          acceptanceCriteria: ["AC1"],
          testStrategy: "unit",
          dependencies: [],
          bootstrap: true,
        },
      ],
    });
    const sm = new StateManager(dir);
    sm.setPhase("building");
    expect(() => sm.setSliceStatus("s0", "ready_for_red")).toThrow(
      /cannot transition from "pending" to "ready_for_red"/,
    );
  });

  it("B-2: after bootstrap lock, a new non-bootstrap slice can be added and must go through native flow", () => {
    // Land the bootstrap slice fully
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s0",
          name: "Bootstrap",
          description: "",
          acceptanceCriteria: ["AC1"],
          testStrategy: "unit",
          dependencies: [],
          bootstrap: true,
        },
      ],
    });
    const sm = new StateManager(dir);
    sm.setPhase("building");
    sm.setSliceStatus("s0", "red");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "green");
    sm.setSliceStatus("s0", "refactor");
    sm.markSastRun("s0");
    sm.setSliceStatus("s0", "sast");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "done");

    // Lock is now set
    const locked = sm.read();
    expect(locked.bootstrapLockedAt).not.toBeNull();

    // Append a new non-bootstrap slice directly via state-manager (bypassing
    // the tool's phase transition which would require moving to planning).
    sm.addSlices([
      {
        id: "s1",
        name: "Feature",
        description: "",
        acceptanceCriteria: ["ACf"],
        testStrategy: "unit",
        dependencies: [],
        status: "pending",
        files: [],
        testResults: [],
        sastFindings: [],
      },
    ]);

    // The new slice must require the full native flow — pending → red rejected
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /cannot transition from "pending" to "red"/,
    );
  });

  it("B-3: non-bootstrap slices coexist with a pending bootstrap and still enforce gates", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s0",
          name: "Bootstrap",
          description: "",
          acceptanceCriteria: ["AC1"],
          testStrategy: "unit",
          dependencies: [],
          bootstrap: true,
        },
        {
          id: "s1",
          name: "Feature",
          description: "",
          acceptanceCriteria: ["ACf"],
          testStrategy: "unit",
          dependencies: ["s0"],
        },
      ],
    });
    const sm = new StateManager(dir);
    sm.setPhase("building");
    // s1 (non-bootstrap) must still require native-flow hardening
    expect(() => sm.setSliceStatus("s1", "red")).toThrow(
      /cannot transition from "pending" to "red"/,
    );
    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /requirements not hardened/,
    );
  });

  it("locks the bootstrap slot after the bootstrap slice is done", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s0",
          name: "Bootstrap",
          description: "",
          acceptanceCriteria: ["AC1"],
          testStrategy: "unit",
          dependencies: [],
          bootstrap: true,
        },
      ],
    });
    const sm = new StateManager(dir);
    sm.setPhase("building");
    sm.setSliceStatus("s0", "red");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "green");
    sm.setSliceStatus("s0", "refactor");
    sm.markSastRun("s0");
    sm.setSliceStatus("s0", "sast");
    addPassingTests(sm, "s0");
    sm.setSliceStatus("s0", "done");

    // Attempt to register another bootstrap slice — rejected.
    expect(() =>
      handleCreateBuildPlan({
        projectPath: dir,
        append: true,
        slices: [
          {
            id: "s1",
            name: "Late bootstrap",
            description: "",
            acceptanceCriteria: ["AC1"],
            testStrategy: "unit",
            dependencies: [],
            bootstrap: true,
          },
        ],
      }),
    ).toThrow(/Bootstrap phase locked/);
  });
});
