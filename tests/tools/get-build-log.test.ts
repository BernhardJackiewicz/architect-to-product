import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import { handleGetBuildLog } from "../../src/tools/get-build-log.js";
import { makeTmpDir, initWithStateManager } from "../helpers/setup.js";

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
    // Newest first: last event should be phase_change → building
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

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "slice", sliceId: "s1", limit: 50 }));
    // All returned events should be for s1
    for (const e of result.events) {
      expect(e.sliceId).toBe("s1");
    }
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("filters by phase", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");
    sm.setPhase("building");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "phase", phase: "planning", limit: 50 }));
    for (const e of result.events) {
      expect(e.phase).toBe("planning");
    }
  });

  it("respects limit", () => {
    const sm = initWithStateManager(dir, 0);
    sm.setPhase("planning");
    sm.setPhase("building");

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "all", limit: 2 }));
    expect(result.showing).toBeLessThanOrEqual(2);
    expect(result.totalEvents).toBeGreaterThan(2);
  });

  it("returns empty log for fresh project", () => {
    const sm = new StateManager(dir);
    sm.init("empty", dir);

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "all", limit: 50 }));
    expect(result.events).toHaveLength(0);
    expect(result.totalEvents).toBe(0);
  });

  it("includes error events in errors filter", () => {
    const sm = initWithStateManager(dir, 0);
    const slices = [
      { id: "s1", name: "S1", description: "d", acceptanceCriteria: ["AC"], testStrategy: "unit", dependencies: [], status: "pending" as const, files: [], testResults: [], sastFindings: [] },
    ];
    sm.setSlices(slices);
    sm.setPhase("planning");
    sm.setPhase("building");
    sm.setSliceStatus("s1", "red");
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.setSliceStatus("s1", "sast");

    sm.addSASTFinding("s1", {
      id: "F1",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "XSS",
      file: "app.ts",
      line: 10,
      description: "reflected xss",
      fix: "escape",
    });

    const result = JSON.parse(handleGetBuildLog({ projectPath: dir, filter: "errors", limit: 50 }));
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.some((e: any) => e.action === "sast_finding")).toBe(true);
  });

  it("returns error for non-existent project", () => {
    const result = JSON.parse(handleGetBuildLog({ projectPath: "/tmp/nonexistent-project-xyz", filter: "all", limit: 50 }));
    expect(result.error).toBeTruthy();
  });
});
