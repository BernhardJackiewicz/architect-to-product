import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import { handleGetBuildLog } from "../../src/tools/get-build-log.js";
import { useLegacySliceFlow, makeTmpDir, initWithStateManager } from "../helpers/setup.js";

useLegacySliceFlow();

describe("a2p_get_build_log", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-buildlog");
  });

  it("returns events chronologically (newest first)", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");
    sm.setPhase("building");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "all", limit: 50 }));
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events[0].action).toBe("phase_change");
    expect(result.events[0].details).toContain("building");
  });

  it("filters by sliceId", () => {
    const sm = initWithStateManager(dir, 0);

    const slices = [
      { id: "s1", name: "S1", description: "d", acceptanceCriteria: ["AC"], testStrategy: "unit", dependencies: [], status: "pending" as const, files: [], testResults: [], sastFindings: [] },
      { id: "s2", name: "S2", description: "d", acceptanceCriteria: ["AC"], testStrategy: "unit", dependencies: [], status: "pending" as const, files: [], testResults: [], sastFindings: [] },
    ];
    sm.setSlices(slices);
    sm.setPhase("planning");
    sm.setPhase("building");
    sm.setSliceStatus("s1", "red");
    sm.setSliceStatus("s2", "red");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, sliceId: "s1", limit: 50 }));
    for (const e of result.events) {
      expect(e.sliceId).toBe("s1");
    }
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("filters by phase", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");
    sm.setPhase("building");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, phase: "planning", limit: 50 }));
    for (const e of result.events) {
      expect(e.phase).toBe("planning");
    }
  });

  it("respects limit", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");
    sm.setPhase("building");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, limit: 2 }));
    expect(result.showing).toBeLessThanOrEqual(2);
    expect(result.totalEvents).toBeGreaterThan(2);
  });

  it("returns empty log for fresh project", () => {
    const sm = new StateManager(dir);
    sm.init("empty", dir);

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, limit: 50 }));
    expect(result.events).toHaveLength(0);
    expect(result.totalEvents).toBe(0);
  });

  it("includes error/failure events in errorsOnly filter", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");

    sm.log("error", "test_fail", "Tests failed", { status: "failure" });
    sm.log("info", "info_event", "All good", { status: "success" });

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, errorsOnly: true, limit: 50 }));
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some((e: any) => e.status === "failure")).toBe(true);
    expect(result.events.some((e: any) => e.status === "success")).toBe(false);
  });

  it("returns error for non-existent project", () => {
    const result = JSON.parse(handleGetBuildLog({ projectPath: "/tmp/nonexistent-project-xyz", limit: 50 }));
    expect(result.error).toBeTruthy();
  });
});
