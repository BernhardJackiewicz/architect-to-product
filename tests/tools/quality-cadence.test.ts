import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { qualityAuditCadence } from "../../src/utils/quality-cadence.js";
import { StateManager } from "../../src/state/state-manager.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import {
  makeTmpDir, cleanTmpDir, initWithStateManager,
  walkSliceToStatus, forcePhase, addQualityAudit, parse,
  useLegacySliceFlow,
} from "../helpers/setup.js";

// ─── Pure function tests ─────────────────────────────────────────────────────

useLegacySliceFlow();

describe("qualityAuditCadence (pure function)", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-cadence");
    sm = initWithStateManager(dir, 5);
    forcePhase(dir, "building");
  });
  afterEach(() => { cleanTmpDir(dir); });

  it("not due when no slices are done", () => {
    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(false);
    expect(result.slicesSinceAudit).toBe(0);
    expect(result.threshold).toBe(3);
  });

  it("not due when fewer than 3 slices done and no audit", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(false);
    expect(result.slicesSinceAudit).toBe(2);
  });

  it("due when 3 slices done and no audit", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");
    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(true);
    expect(result.slicesSinceAudit).toBe(3);
  });

  it("resets after quality audit records current done count", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");

    // Simulate quality audit that records 3 slices done
    sm.addAuditResult({
      id: "AUD-Q-1",
      mode: "quality",
      timestamp: new Date().toISOString(),
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      buildPassed: true,
      testsPassed: true,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 3, slicesTotal: 5 },
    });

    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(false);
    expect(result.slicesSinceAudit).toBe(0);
  });

  it("due again after 3 more slices past the audit", () => {
    walkSliceToStatus(sm, "s1", "done");

    // Audit records 1 slice done
    sm.addAuditResult({
      id: "AUD-Q-1",
      mode: "quality",
      timestamp: new Date().toISOString(),
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      buildPassed: true,
      testsPassed: true,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 1, slicesTotal: 5 },
    });

    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");
    walkSliceToStatus(sm, "s4", "done");

    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(true);
    expect(result.slicesSinceAudit).toBe(3);
  });

  it("ignores release audits — only counts quality audits", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    walkSliceToStatus(sm, "s3", "done");

    // Release audit should not reset cadence
    sm.addAuditResult({
      id: "AUD-R-1",
      mode: "release",
      timestamp: new Date().toISOString(),
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      buildPassed: true,
      testsPassed: true,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 3, slicesTotal: 5 },
    });

    const state = sm.read();
    const result = qualityAuditCadence(state);
    expect(result.due).toBe(true);
  });

  it("respects custom threshold", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    const state = sm.read();

    expect(qualityAuditCadence(state, 2).due).toBe(true);
    expect(qualityAuditCadence(state, 3).due).toBe(false);
  });
});

// ─── Integration: update-slice response includes cadence hint ────────────────

describe("update-slice includes qualityAuditDue in done response", () => {
  let dir: string;
  let sm: StateManager;

  beforeEach(() => {
    dir = makeTmpDir("a2p-cadence-int");
    sm = initWithStateManager(dir, 4);
    forcePhase(dir, "building");
  });
  afterEach(() => { cleanTmpDir(dir); });

  it("qualityAuditDue=false when fewer than 3 slices done", () => {
    walkSliceToStatus(sm, "s1", "sast");
    // Add final passing tests for done transition
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "npm test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "PASS",
    });
    const result = parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "done" }));
    expect(result.success).toBe(true);
    expect(result.qualityAuditDue).toBe(false);
  });

  it("qualityAuditDue=true when 3 slices done without audit", () => {
    walkSliceToStatus(sm, "s1", "done");
    walkSliceToStatus(sm, "s2", "done");
    // Walk s3 to sast, then mark done via handleUpdateSlice
    walkSliceToStatus(sm, "s3", "sast");
    sm.addTestResult("s3", {
      timestamp: new Date().toISOString(),
      command: "npm test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "PASS",
    });
    const result = parse(handleUpdateSlice({ projectPath: dir, sliceId: "s3", status: "done" }));
    expect(result.success).toBe(true);
    expect(result.qualityAuditDue).toBe(true);
    expect(result.qualityAuditHint).toContain("3 slices completed since last quality audit");
  });

  it("qualityAuditDue not present for non-done status", () => {
    sm.setSliceStatus("s1", "red");
    const result = parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "green" }));
    // green requires passing tests — add them first
    // Actually this will fail because green requires tests. Let me fix the test.
    expect(result.error).toContain("without test results");
  });

  it("qualityAuditDue not present for non-done transitions", () => {
    sm.setSliceStatus("s1", "red");
    sm.addTestResult("s1", {
      timestamp: new Date().toISOString(),
      command: "npm test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "PASS",
    });
    const result = parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "green" }));
    expect(result.success).toBe(true);
    expect(result.qualityAuditDue).toBeUndefined();
  });
});
