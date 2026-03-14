import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { makeTmpDir, initWithStateManager, addPassingTests, addSastEvidence, walkSliceToStatus, forcePhase } from "../helpers/setup.js";

// ─── Slice Status Enforcement ────────────────────────────────────────────────

describe("Enforcement: green requires passing tests", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 1);
    sm.setSliceStatus("s1", "red");
  });

  it("rejects green without any test results", () => {
    expect(() => sm.setSliceStatus("s1", "green")).toThrow("without test results");
  });

  it("rejects green when last test failed", () => {
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "npm test",
      exitCode: 1,
      passed: 3,
      failed: 2,
      skipped: 0,
      output: "FAIL",
    });
    expect(() => sm.setSliceStatus("s1", "green")).toThrow("last test run failed");
  });

  it("allows green when last test passed", () => {
    addPassingTests(sm, "s1");
    const state = sm.setSliceStatus("s1", "green");
    expect(state.slices[0].status).toBe("green");
  });

  it("allows green when last test passed even if earlier tests failed", () => {
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "npm test",
      exitCode: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      output: "FAIL",
    });
    addPassingTests(sm, "s1");
    const state = sm.setSliceStatus("s1", "green");
    expect(state.slices[0].status).toBe("green");
  });
});

describe("Enforcement: sast requires SAST scan", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 1);
    sm.setSliceStatus("s1", "red");
    addPassingTests(sm, "s1");
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
  });

  it("rejects sast without SAST run", () => {
    expect(() => sm.setSliceStatus("s1", "sast")).toThrow("without running SAST");
  });

  it("allows sast after markSastRun", () => {
    addSastEvidence(sm, "s1");
    const state = sm.setSliceStatus("s1", "sast");
    expect(state.slices[0].status).toBe("sast");
  });
});

describe("Enforcement: done requires passing tests", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 1);
    walkSliceToStatus(sm, "s1", "sast");
  });

  it("rejects done when last test failed after SAST fixes", () => {
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "npm test",
      exitCode: 1,
      passed: 3,
      failed: 1,
      skipped: 0,
      output: "FAIL",
    });
    expect(() => sm.setSliceStatus("s1", "done")).toThrow("last test run failed");
  });

  it("allows done when last test passed", () => {
    addPassingTests(sm, "s1");
    const state = sm.setSliceStatus("s1", "done");
    expect(state.slices[0].status).toBe("done");
  });
});

describe("Enforcement: sast → red resets SAST evidence", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 1);
    walkSliceToStatus(sm, "s1", "sast");
  });

  it("clears sastRanAt when going back to red", () => {
    sm.setSliceStatus("s1", "red");
    const state = sm.read();
    expect(state.slices[0].sastRanAt).toBeUndefined();
  });

  it("requires re-running SAST after fix cycle", () => {
    sm.setSliceStatus("s1", "red");
    addPassingTests(sm, "s1");
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    // Should fail without re-running SAST
    expect(() => sm.setSliceStatus("s1", "sast")).toThrow("without running SAST");
  });

  it("passes after re-running SAST in fix cycle", () => {
    sm.setSliceStatus("s1", "red");
    addPassingTests(sm, "s1");
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    addSastEvidence(sm, "s1");
    const state = sm.setSliceStatus("s1", "sast");
    expect(state.slices[0].status).toBe("sast");
  });
});

// ─── Phase Transition Enforcement ────────────────────────────────────────────

describe("Enforcement: building → refactoring/security requires all slices done", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 3);
    sm.setPhase("planning");
    sm.setPhase("building");
  });

  it("rejects building → refactoring with pending slices", () => {
    expect(() => sm.setPhase("refactoring")).toThrow("not done");
    expect(() => sm.setPhase("refactoring")).toThrow("s1");
  });

  it("rejects building → security with partial progress", () => {
    walkSliceToStatus(sm, "s1", "done");
    // s2 and s3 still pending
    expect(() => sm.setPhase("security")).toThrow("not done");
  });

  it("allows building → security when all slices done", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");
    sm.setBuildSignoff();
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });

  it("allows building → refactoring when all slices done", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");
    const state = sm.setPhase("refactoring");
    expect(state.phase).toBe("refactoring");
  });

  it("allows building → security with 0 slices", () => {
    // Edge case: empty project
    const emptyDir = makeTmpDir("a2p-enforce-empty");
    const emptySm = new StateManager(emptyDir);
    emptySm.init("empty", emptyDir);
    emptySm.setPhase("planning");
    emptySm.setPhase("building");
    emptySm.setBuildSignoff();
    const state = emptySm.setPhase("security");
    expect(state.phase).toBe("security");
  });
});

// ─── Tool-Level Enforcement (via handleUpdateSlice) ──────────────────────────

describe("Enforcement: handleUpdateSlice returns errors for missing evidence", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    initWithStateManager(dir, 1);
    forcePhase(dir, "building");
  });

  it("returns error when transitioning to green without tests", () => {
    const sm = new StateManager(dir);
    sm.setSliceStatus("s1", "red");
    const result = JSON.parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "green" }));
    expect(result.error).toContain("without test results");
  });

  it("returns error when transitioning to sast without SAST run", () => {
    const sm = new StateManager(dir);
    sm.setSliceStatus("s1", "red");
    addPassingTests(sm, "s1");
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    const result = JSON.parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "sast" }));
    expect(result.error).toContain("without running SAST");
  });

  it("returns error when marking done with failing tests", () => {
    const sm = new StateManager(dir);
    walkSliceToStatus(sm, "s1", "sast");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "test",
      exitCode: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      output: "FAIL",
    });
    const result = JSON.parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "done" }));
    expect(result.error).toContain("last test run failed");
  });
});

// ─── markSastRun ─────────────────────────────────────────────────────────────

describe("StateManager: markSastRun", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-enforce");
    sm = initWithStateManager(dir, 1);
  });

  it("sets sastRanAt timestamp", () => {
    sm.markSastRun("s1");
    const state = sm.read();
    expect(state.slices[0].sastRanAt).toBeDefined();
    expect(new Date(state.slices[0].sastRanAt!).getTime()).toBeGreaterThan(0);
  });

  it("records sast_run event in buildHistory", () => {
    sm.markSastRun("s1");
    const state = sm.read();
    const lastEvent = state.buildHistory[state.buildHistory.length - 1];
    expect(lastEvent.action).toBe("sast_run");
    expect(lastEvent.sliceId).toBe("s1");
  });

  it("throws for unknown slice", () => {
    expect(() => sm.markSastRun("nonexistent")).toThrow("not found");
  });
});
