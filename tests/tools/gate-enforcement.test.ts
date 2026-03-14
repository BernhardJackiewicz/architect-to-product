import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import {
  makeTmpDir, cleanTmpDir, initWithStateManager, walkSliceToStatus,
  forcePhase, forceField, addQualityAudit, addReleaseAudit, addPassingVerification,
} from "../helpers/setup.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-gates"); });
afterEach(() => { cleanTmpDir(dir); });

// ============================================================================
// Quality Gate: building -> security requires quality audit
// ============================================================================

describe("Quality Gate: building -> security", () => {
  it("BLOCKED: building->security without quality audit -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    expect(() => sm.setPhase("security")).toThrow("quality audit");
  });

  it("ALLOWED: building->security with quality audit -> success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });

  it("ALLOWED: building->refactoring does NOT require quality audit", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    // No quality audit needed for refactoring
    const state = sm.setPhase("refactoring");
    expect(state.phase).toBe("refactoring");
  });

  it("quality audit with critical findings does NOT block building->security", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    // Quality audit with critical findings -- gate only checks existence, not severity
    sm.addAuditResult({
      id: "AQ-CRIT", mode: "quality", timestamp: new Date().toISOString(),
      findings: [{ category: "build_failure", severity: "critical", file: "x", line: 0, message: "fail", fix: "fix" }],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      buildPassed: false, testsPassed: null,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 3, slicesTotal: 3 },
    });
    // Should still allow transition -- quality audit is informational
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });
});

// ============================================================================
// Quality Gate: staleness check
// ============================================================================

describe("Quality Gate: staleness check", () => {
  it("BLOCKED: stale quality audit -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    // Simulate code change AFTER quality audit
    forceField(dir, "lastSecurityRelevantChangeAt", new Date(Date.now() + 10000).toISOString());
    expect(() => sm.setPhase("security")).toThrow("stale");
  });

  it("ALLOWED: fresh quality audit -> success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    // Set lastSecurityRelevantChangeAt to past
    forceField(dir, "lastSecurityRelevantChangeAt", new Date(Date.now() - 10000).toISOString());
    addQualityAudit(sm); // timestamp is now(), which is after the change
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });
});

// ============================================================================
// Release Audit Gate: security -> deployment requires release audit
// ============================================================================

describe("Release Audit Gate: security -> deployment", () => {
  it("BLOCKED: security->deployment without release audit -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingVerification(sm);
    // No release audit
    expect(() => sm.setPhase("deployment")).toThrow("release audit");
  });

  it("BLOCKED: security->deployment with release audit containing critical findings -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingVerification(sm);
    // Release audit with critical findings
    sm.addAuditResult({
      id: "AR-CRIT", mode: "release", timestamp: new Date().toISOString(),
      findings: [{ category: "build_failure", severity: "critical", file: "x", line: 0, message: "Build failed", fix: "fix" }],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      buildPassed: false, testsPassed: null,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 3, slicesTotal: 3 },
    });
    expect(() => sm.setPhase("deployment")).toThrow("critical finding");
  });

  it("ALLOWED: security->deployment with clean release audit -> success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// Active Verification Gate: security -> deployment requires verification
// ============================================================================

describe("Verification Gate: security -> deployment", () => {
  it("BLOCKED: security->deployment without verification -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    // No verification
    expect(() => sm.setPhase("deployment")).toThrow("active verification");
  });

  it("BLOCKED: security->deployment with blocking verification findings -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    // Verification with blocking findings
    sm.addActiveVerificationResult({
      id: "AVR-BLOCK", timestamp: new Date().toISOString(), round: 1,
      tests_run: 5, tests_passed: 3, tests_failed: 2,
      findings: [{
        id: "AV-001", category: "WorkflowGateEnforcement", severity: "critical",
        confirmed_exploitable: true, evidence_type: "runtime_tested",
        enforcement_type: "code", runtime_path_reachable: true,
        state_change_provable: true, boundary_actually_bypassed: true,
        root_cause: "Gate bypass", affected_files: [], minimal_fix: "Fix gate",
        required_regression_tests: [], blocking: true,
      }],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      blocking_count: 1, requires_human_review: false,
    });
    expect(() => sm.setPhase("deployment")).toThrow("blocking finding");
  });

  it("ALLOWED: security->deployment with clean verification -> success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });

  it("uses LATEST verification result, not first", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    // First verification: blocking
    sm.addActiveVerificationResult({
      id: "AVR-1", timestamp: new Date().toISOString(), round: 1,
      tests_run: 1, tests_passed: 0, tests_failed: 1, findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      blocking_count: 1, requires_human_review: false,
    });
    // Second verification: clean
    addPassingVerification(sm);
    // Should pass because latest verification is clean
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// Verification Gate: staleness check
// ============================================================================

describe("Verification Gate: staleness check", () => {
  it("BLOCKED: stale verification -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    // Simulate code change AFTER verification
    const future = new Date(Date.now() + 10000).toISOString();
    forceField(dir, "lastSecurityRelevantChangeAt", future);
    // Also set fresh SAST so stale-SAST gate doesn't fire first
    forceField(dir, "lastFullSastAt", future);
    expect(() => sm.setPhase("deployment")).toThrow("verification is stale");
  });

  it("ALLOWED: fresh verification -> success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    // Set change timestamp in the past, then add fresh verification
    forceField(dir, "lastSecurityRelevantChangeAt", new Date(Date.now() - 10000).toISOString());
    addPassingVerification(sm); // timestamp is now(), after the change
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// Backup Gate: stateful apps blocked without backup config
// ============================================================================

describe("Backup Gate: stateful app deployment", () => {
  function initStatefulProject(tmpDir: string): StateManager {
    handleInitProject({ projectPath: tmpDir, projectName: "stateful-app" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Stateful", description: "Has DB",
      language: "Python", framework: "FastAPI",
      database: "PostgreSQL",
      features: ["CRUD"],
      dataModel: "items", apiDesign: "REST",
    });
    return new StateManager(tmpDir);
  }

  function initStatelessProject(tmpDir: string): StateManager {
    handleInitProject({ projectPath: tmpDir, projectName: "stateless-app" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Stateless", description: "No DB",
      language: "Python", framework: "FastAPI",
      features: ["health check"],
      dataModel: "none", apiDesign: "REST",
    });
    return new StateManager(tmpDir);
  }

  it("BLOCKED: stateful app without backup configured -> throw", () => {
    const sm = initStatefulProject(dir);
    sm.setPhase("planning");
    sm.setSlices([{
      id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
      testStrategy: "unit", dependencies: [], status: "pending",
      files: [], testResults: [], sastFindings: [],
    }]);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    expect(() => sm.setPhase("deployment")).toThrow("backup configuration");
  });

  it("ALLOWED: stateful app with backup configured -> success", () => {
    const sm = initStatefulProject(dir);
    sm.setBackupStatus({ configured: true, schedulerType: "cron" });
    sm.setPhase("planning");
    sm.setSlices([{
      id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
      testStrategy: "unit", dependencies: [], status: "pending",
      files: [], testResults: [], sastFindings: [],
    }]);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });

  it("ALLOWED: stateless app without backup configured -> success (not required)", () => {
    const sm = initStatelessProject(dir);
    sm.setPhase("planning");
    sm.setSlices([{
      id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
      testStrategy: "unit", dependencies: [], status: "pending",
      files: [], testResults: [], sastFindings: [],
    }]);
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    // Stateless app: backupConfig.required is false, so no backup gate
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// Full Gate Sequence: all gates enforce in correct order
// ============================================================================

describe("Full Gate Sequence: correct order enforcement", () => {
  it("gates fire in order: SAST -> findings -> whitebox -> audit -> verification -> backup", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");

    // No SAST -> should fail on SAST first
    expect(() => sm.setPhase("deployment")).toThrow("full SAST");

    // Add SAST -> should fail on release audit next
    sm.markFullSastRun(0);
    expect(() => sm.setPhase("deployment")).toThrow("release audit");

    // Add release audit -> should fail on verification next
    addReleaseAudit(sm);
    expect(() => sm.setPhase("deployment")).toThrow("active verification");

    // Add verification -> should succeed (stateless app, no backup gate)
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});
