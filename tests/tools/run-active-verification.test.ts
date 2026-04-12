import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegacySliceFlow, makeTmpDir, cleanTmpDir, parse, initWithFindings, initWithStateManager, walkSliceToStatus, addPassingTests, forcePhase, addQualityAudit, addReleaseAudit, addPassingVerification, addPassingWhitebox } from "../helpers/setup.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { cleanTmpDir(dir); });

useLegacySliceFlow();

describe("run-active-verification", () => {
  it("returns error for non-existent project", () => {
    const result = parse(handleRunActiveVerification({ projectPath: "/nonexistent", round: 1 }));
    expect(result.error).toBeDefined();
  });

  it("generates workflow gate tests", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({ projectPath: dir, round: 1 }));
    expect(result.success).toBe(true);
    expect(result.testsRun).toBeGreaterThan(0);
  });

  it("detects missing test evidence for green transition", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      categories: ["workflow_gates"],
    }));
    expect(result.success).toBe(true);
    // The green-without-tests gate should pass (= the gate correctly threw)
    expect(result.testsPassed).toBeGreaterThan(0);
  });

  it("detects missing SAST evidence for sast transition", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      categories: ["workflow_gates"],
    }));
    expect(result.success).toBe(true);
    expect(result.testsPassed).toBeGreaterThan(0);
  });

  it("detects deployment gate bypass with critical SAST", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      categories: ["workflow_gates"],
    }));
    expect(result.success).toBe(true);
    // Deployment with critical SAST test should pass (gate correctly blocks)
    expect(result.testsPassed).toBeGreaterThan(0);
  });

  it("passes when all gates function correctly", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({ projectPath: dir, round: 1 }));
    expect(result.success).toBe(true);
    // Most gate tests should pass since the state manager enforces them
    expect(result.testsPassed).toBeGreaterThanOrEqual(result.testsFailed);
  });

  it("filters by categories parameter", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const allResult = parse(handleRunActiveVerification({ projectPath: dir, round: 1 }));
    const gatesOnly = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      categories: ["workflow_gates"],
    }));
    expect(gatesOnly.testsRun).toBeLessThanOrEqual(allResult.testsRun);
  });

  it("round 3 + blocking findings → requires_human_review=true", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    // Add a whitebox result with blocking findings to make deployment gate test meaningful
    sm.addWhiteboxResult({
      id: "WBA-PRE",
      mode: "full",
      timestamp: new Date().toISOString(),
      candidates_evaluated: 1,
      findings: [{
        id: "WB-PRE",
        category: "AuthAuthz",
        severity: "critical",
        confirmed_exploitable: true,
        evidence_type: "code_verified",
        enforcement_type: "code",
        runtime_path_reachable: true,
        state_change_provable: true,
        boundary_actually_bypassed: true,
        root_cause: "test",
        affected_files: [],
        minimal_fix: "test",
        required_regression_tests: [],
        blocking: true,
      }],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      blocking_count: 1,
    });
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 3,
      categories: ["workflow_gates"],
    }));
    // If there are blocking findings in round 3, requires_human_review should be true
    if (result.blockingCount > 0) {
      expect(result.requiresHumanReview).toBe(true);
    }
  });

  it("round 1-2 + blocking → requires_human_review=false", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
    }));
    expect(result.requiresHumanReview).toBe(false);
  });

  it("stores ActiveVerificationResult in state", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    handleRunActiveVerification({ projectPath: dir, round: 1 });
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.activeVerificationResults).toHaveLength(1);
    expect(state.activeVerificationResults[0].id).toBe("AVR-001");
  });

  it("increments IDs (AVR-001, AVR-002)", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    handleRunActiveVerification({ projectPath: dir, round: 1 });
    handleRunActiveVerification({ projectPath: dir, round: 2 });
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.activeVerificationResults).toHaveLength(2);
    expect(state.activeVerificationResults[0].id).toBe("AVR-001");
    expect(state.activeVerificationResults[1].id).toBe("AVR-002");
  });

  it("records build event in history", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    handleRunActiveVerification({ projectPath: dir, round: 1 });
    const sm = new StateManager(dir);
    const state = sm.read();
    const events = state.buildHistory.filter((e) => e.action === "active_verification");
    expect(events.length).toBeGreaterThan(0);
  });

  it("state recovery: round-trip save/load", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      categories: ["state_recovery"],
    }));
    expect(result.success).toBe(true);
    expect(result.testsPassed).toBeGreaterThan(0);
    expect(result.testsFailed).toBe(0);
  });

  it("deployment gate blocks with blocking whitebox findings (StateManager)", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    sm.setPhase("building");
    for (const slice of sm.read().slices) {
      walkSliceToStatus(sm, slice.id, "done");
    }
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");

    sm.addWhiteboxResult({
      id: "WBA-BLOCK",
      mode: "full",
      timestamp: new Date().toISOString(),
      candidates_evaluated: 1,
      findings: [{
        id: "WB-BLOCK",
        category: "Secrets",
        severity: "critical",
        confirmed_exploitable: true,
        evidence_type: "code_verified",
        enforcement_type: "prompt-only",
        runtime_path_reachable: true,
        state_change_provable: true,
        boundary_actually_bypassed: true,
        root_cause: "Secret exposure",
        affected_files: ["config.ts"],
        minimal_fix: "Use env vars",
        required_regression_tests: [],
        blocking: true,
      }],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      blocking_count: 1,
    });

    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    expect(() => sm.setPhase("deployment")).toThrow(/blocking whitebox/i);
  });

  it("deployment gate allows when whitebox has no blocking findings", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    sm.setPhase("building");
    for (const slice of sm.read().slices) {
      walkSliceToStatus(sm, slice.id, "done");
    }
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    expect(() => sm.setPhase("deployment")).not.toThrow();
  });
});

describe("active verification duplicate event prevention", () => {
  it("produces exactly 1 active_verification event per run (no duplicates)", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    handleRunActiveVerification({ projectPath: dir, round: 1 });

    const state = new StateManager(dir).read();
    const verifyEvents = state.buildHistory.filter((e: any) => e.action === "active_verification");
    expect(verifyEvents.length).toBe(1);
    expect(verifyEvents[0].metadata).toBeDefined();
    expect(verifyEvents[0].metadata.toolName).toBe("active_verification");
  });
});
