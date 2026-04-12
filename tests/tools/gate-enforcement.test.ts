import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../../src/state/state-manager.js";
import {
  makeTmpDir, cleanTmpDir, initWithStateManager, walkSliceToStatus, addPassingTests,
  forcePhase, forceField, addQualityAudit, addReleaseAudit, addPassingVerification,
  addPassingWhitebox, addWhiteboxOnly, completeAdversarialReview, addSastEvidence,
  useLegacySliceFlow,
} from "../helpers/setup.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCompleteAdversarialReview } from "../../src/tools/complete-adversarial-review.js";
import { handleBuildSignoff } from "../../src/tools/build-signoff.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-gates"); });
afterEach(() => { cleanTmpDir(dir); });

// ============================================================================
// Quality Gate: building -> security requires quality audit
// ============================================================================

useLegacySliceFlow();

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
// Adversarial Review Gate: security -> deployment requires adversarial review
// ============================================================================

describe("Adversarial Review Gate: security -> deployment", () => {
  it("BLOCKED: security->deployment without adversarial review -> throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm); // whitebox but NO adversarial review
    addReleaseAudit(sm);
    addPassingVerification(sm);
    expect(() => sm.setPhase("deployment")).toThrow("adversarial review");
  });

  it("ALLOWED: security->deployment with adversarial review completed -> passes gate", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    completeAdversarialReview(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });

  it("INVALIDATED: new whitebox audit resets adversarial review completion", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    completeAdversarialReview(sm);
    // Adversarial review is completed
    expect(sm.read().adversarialReviewState).not.toBeNull();
    // New whitebox audit invalidates it
    addWhiteboxOnly(sm);
    expect(sm.read().adversarialReviewState).toBeNull();
  });

  it("BLOCKED: completeAdversarialReview requires whitebox audit first", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    // No whitebox audit
    expect(() => sm.completeAdversarialReview(0)).toThrow("whitebox audit");
  });

  it("BLOCKED: completeAdversarialReview only in security phase", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    expect(() => sm.completeAdversarialReview(0)).toThrow("security phase");
  });
});

// ============================================================================
// Adversarial Review: iterative round tracking
// ============================================================================

describe("Adversarial Review: round tracking", () => {
  it("round 1: creates initial state with round=1 and roundHistory[1]", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    sm.completeAdversarialReview(3, "reviewed auth + API");
    const state = sm.read();
    expect(state.adversarialReviewState).not.toBeNull();
    expect(state.adversarialReviewState!.round).toBe(1);
    expect(state.adversarialReviewState!.totalFindingsRecorded).toBe(3);
    expect(state.adversarialReviewState!.roundHistory).toHaveLength(1);
    expect(state.adversarialReviewState!.roundHistory[0].round).toBe(1);
    expect(state.adversarialReviewState!.roundHistory[0].findingsRecorded).toBe(3);
    expect(state.adversarialReviewState!.roundHistory[0].note).toBe("reviewed auth + API");
  });

  it("round 2: increments round and accumulates findings", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    sm.completeAdversarialReview(5, "round 1");
    sm.completeAdversarialReview(2, "round 2");
    const state = sm.read();
    expect(state.adversarialReviewState!.round).toBe(2);
    expect(state.adversarialReviewState!.totalFindingsRecorded).toBe(7);
    expect(state.adversarialReviewState!.roundHistory).toHaveLength(2);
    expect(state.adversarialReviewState!.roundHistory[0].round).toBe(1);
    expect(state.adversarialReviewState!.roundHistory[1].round).toBe(2);
    expect(state.adversarialReviewState!.roundHistory[1].findingsRecorded).toBe(2);
  });

  it("round 3: full history preserved across 3 rounds", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    sm.completeAdversarialReview(4, "r1");
    sm.completeAdversarialReview(3, "r2");
    sm.completeAdversarialReview(1, "r3");
    const state = sm.read();
    expect(state.adversarialReviewState!.round).toBe(3);
    expect(state.adversarialReviewState!.totalFindingsRecorded).toBe(8);
    expect(state.adversarialReviewState!.roundHistory).toHaveLength(3);
  });

  it("invalidation: new whitebox resets ALL round state to null", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    sm.completeAdversarialReview(5, "r1");
    sm.completeAdversarialReview(2, "r2");
    expect(sm.read().adversarialReviewState!.round).toBe(2);
    // New whitebox audit invalidates everything
    addWhiteboxOnly(sm);
    expect(sm.read().adversarialReviewState).toBeNull();
    // After re-doing review, starts at round 1 again
    sm.completeAdversarialReview(1, "fresh start");
    expect(sm.read().adversarialReviewState!.round).toBe(1);
    expect(sm.read().adversarialReviewState!.totalFindingsRecorded).toBe(1);
    expect(sm.read().adversarialReviewState!.roundHistory).toHaveLength(1);
  });

  it("gate: passes with any number of rounds >= 1", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    sm.completeAdversarialReview(0, "r1");
    sm.completeAdversarialReview(0, "r2");
    sm.completeAdversarialReview(0, "r3");
    sm.clearPendingSecurityDecision();
    addReleaseAudit(sm);
    addPassingVerification(sm);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// Adversarial Review: tool output
// ============================================================================

describe("Adversarial Review: tool output", () => {
  it("round 2 output contains previousFindings from round 1", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    // Record a finding on a slice before completing round 1
    const sliceId = sm.read().slices[0].id;
    sm.addSASTFinding(sliceId, {
      id: "ADV-001", tool: "adversarial-review", severity: "high", status: "open",
      title: "Rate Limit Memory Leak", file: "src/rate-limit.ts", line: 10,
      description: "Leak", fix: "Fix",
    });
    sm.completeAdversarialReview(1, "r1");
    // Now complete round 2 via tool handler
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "r2 — no new findings",
    }));
    expect(result.success).toBe(true);
    expect(result.currentRound).toBe(2);
    expect(result.totalFindingsRecorded).toBe(1);
    expect(result.previousFindings).toHaveLength(1);
    expect(result.previousFindings[0].title).toBe("Rate Limit Memory Leak");
    expect(result.previousFindings[0].file).toBe("src/rate-limit.ts");
    expect(result.hint).toContain("Round 2");
    expect(result.hint).toContain("Options");
  });

  it("round 3 output contains ALL previousFindings from rounds 1+2", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    const sliceId = sm.read().slices[0].id;
    // Round 1 findings
    sm.addSASTFinding(sliceId, {
      id: "ADV-001", tool: "adversarial-review", severity: "high", status: "open",
      title: "Finding A", file: "src/a.ts", line: 1, description: "A", fix: "Fix A",
    });
    sm.completeAdversarialReview(1, "r1");
    // Round 2 findings
    sm.addSASTFinding(sliceId, {
      id: "ADV-002", tool: "adversarial-review", severity: "medium", status: "open",
      title: "Finding B", file: "src/b.ts", line: 5, description: "B", fix: "Fix B",
    });
    sm.completeAdversarialReview(1, "r2");
    // Round 3 via tool
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "r3",
    }));
    expect(result.currentRound).toBe(3);
    expect(result.totalFindingsRecorded).toBe(2);
    expect(result.previousFindings).toHaveLength(2);
    expect(result.roundHistory).toHaveLength(3);
  });

  it("roundHistory output capped at 5, older summarized", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addWhiteboxOnly(sm);
    // Complete 6 rounds
    for (let i = 0; i < 6; i++) {
      sm.completeAdversarialReview(i, `round ${i + 1}`);
    }
    // 7th round via tool
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "round 7",
    }));
    expect(result.currentRound).toBe(7);
    expect(result.roundHistory).toHaveLength(5); // capped
    expect(result.olderRoundsSummary).toContain("2 earlier round");
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
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
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    // Stateless app: backupConfig.required is false, so no backup gate
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ============================================================================
// E2E Gate: UI projects with Playwright must go through e2e_testing
// ============================================================================

describe("E2E Gate: UI + Playwright enforcement", () => {
  function addPlaywright(sm: StateManager): void {
    sm.addCompanion({
      name: "Playwright", type: "playwright",
      command: "npx playwright test", installed: true, config: {},
    });
  }

  function markSlicesHasUI(dir: string): void {
    const statePath = join(dir, ".a2p", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    for (const s of state.slices) s.hasUI = true;
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  it("BLOCKED: UI + Playwright -> building→security blocked", () => {
    const sm = initWithStateManager(dir);
    addPlaywright(sm);
    markSlicesHasUI(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    expect(() => sm.setPhase("security")).toThrow("Cannot skip E2E testing");
  });

  it("ALLOWED: UI + Playwright -> building→refactoring→e2e_testing→security", () => {
    const sm = initWithStateManager(dir);
    addPlaywright(sm);
    markSlicesHasUI(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    // Correct path: building → refactoring → e2e_testing → security
    const s1 = sm.setPhase("refactoring");
    expect(s1.phase).toBe("refactoring");
    const s2 = sm.setPhase("e2e_testing");
    expect(s2.phase).toBe("e2e_testing");
    const s3 = sm.setPhase("security");
    expect(s3.phase).toBe("security");
  });

  it("ALLOWED: backend-only project -> building→security allowed", () => {
    const sm = initWithStateManager(dir);
    // No hasUI slices, no Playwright
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });

  it("ALLOWED: UI project without Playwright -> building→security allowed", () => {
    const sm = initWithStateManager(dir);
    markSlicesHasUI(dir);
    // No Playwright companion
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
  });

  it("BLOCKED: UI + Playwright -> refactoring→security blocked", () => {
    const sm = initWithStateManager(dir);
    addPlaywright(sm);
    markSlicesHasUI(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setPhase("refactoring");
    expect(() => sm.setPhase("security")).toThrow("Cannot skip E2E testing");
  });
});

// ============================================================================
// Security Re-Entry: onboarding→security, deployment→security, complete→security
// ============================================================================

describe("Security Re-Entry: direct transitions", () => {
  it("ALLOWED: onboarding→security WITH architecture → securityReentryReason=security_only", () => {
    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "T", description: "T",
      techStack: { language: "TypeScript", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f1"], dataModel: "none", apiDesign: "REST", raw: "",
    });
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
    expect(state.securityReentryReason).toBe("security_only");
  });

  it("BLOCKED: onboarding→security WITHOUT architecture → throw", () => {
    const sm = new StateManager(dir);
    sm.init("test", dir);
    expect(() => sm.setPhase("security")).toThrow("architecture");
  });

  it("ALLOWED: deployment→security → securityReentryReason=post_deploy", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "deployment");
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
    expect(state.securityReentryReason).toBe("post_deploy");
  });

  it("ALLOWED: complete→security → securityReentryReason=post_complete", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "complete");
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
    expect(state.securityReentryReason).toBe("post_complete");
  });

  it("building→security sets NO securityReentryReason (normal flow)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    const state = sm.setPhase("security");
    expect(state.phase).toBe("security");
    expect(state.securityReentryReason).toBeNull();
  });

  it("securityReentryReason cleared when leaving security", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "deployment");
    sm.setPhase("security");
    expect(sm.read().securityReentryReason).toBe("post_deploy");
    // Go back to building
    sm.setPhase("building");
    expect(sm.read().securityReentryReason).toBeNull();
  });
});

// ============================================================================
// Security Re-Entry: invalidation of stale approvals
// ============================================================================

describe("Security Re-Entry: invalidation", () => {
  it("deployment→security invalidates deployApproval, adversarialReview, lastFullSast", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    sm.setPhase("deployment");
    // Force some approval state
    forceField(dir, "deployApprovalAt", "2026-01-01T00:00:00Z");
    forceField(dir, "deployApprovalStateHash", "hash");
    // Now re-enter security
    const state = sm.setPhase("security");
    expect(state.deployApprovalAt).toBeNull();
    expect(state.deployApprovalStateHash).toBeNull();
    expect(state.adversarialReviewState).toBeNull();
    expect(state.lastFullSastAt).toBeNull();
    expect(state.lastFullSastFindingCount).toBe(0);
  });

  it("complete→security invalidates deployApproval, adversarialReview, lastFullSast", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "complete");
    // Force some approval state
    forceField(dir, "deployApprovalAt", "2026-01-01T00:00:00Z");
    forceField(dir, "adversarialReviewState", { completedAt: "2026-01-01T00:00:00Z", round: 1, totalFindingsRecorded: 0, roundHistory: [] });
    forceField(dir, "lastFullSastAt", "2026-01-01T00:00:00Z");
    forceField(dir, "lastFullSastFindingCount", 5);
    const state = sm.setPhase("security");
    expect(state.deployApprovalAt).toBeNull();
    expect(state.deployApprovalStateHash).toBeNull();
    expect(state.adversarialReviewState).toBeNull();
    expect(state.lastFullSastAt).toBeNull();
    expect(state.lastFullSastFindingCount).toBe(0);
  });

  it("security→deployment after re-entry still enforces all 9 gates", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "deployment");
    sm.setPhase("security");
    // All gates must be re-satisfied
    expect(() => sm.setPhase("deployment")).toThrow("full SAST");
  });
});

// ============================================================================
// projectFindings: SAST findings without slice
// ============================================================================

describe("projectFindings: slice-less findings", () => {
  it("addSASTFinding(null) persists to projectFindings", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.addSASTFinding(null, {
      id: "PF-001", tool: "semgrep", severity: "high", status: "open",
      title: "SQL Injection", file: "src/db.ts", line: 10,
      description: "desc", fix: "fix",
    });
    const state = sm.read();
    expect(state.projectFindings).toHaveLength(1);
    expect(state.projectFindings[0].id).toBe("PF-001");
  });

  it("open CRITICAL projectFinding blocks security→deployment", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    // Record finding first, then run SAST after (so SAST isn't stale)
    sm.addSASTFinding(null, {
      id: "PF-CRIT", tool: "manual", severity: "critical", status: "open",
      title: "Critical Bug", file: "src/x.ts", line: 1,
      description: "desc", fix: "fix",
    });
    sm.markFullSastRun(1);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    expect(() => sm.setPhase("deployment")).toThrow("CRITICAL/HIGH");
  });

  it("getProgress includes projectFindings in openFindings count", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.addSASTFinding(null, {
      id: "PF-002", tool: "manual", severity: "medium", status: "open",
      title: "Issue", file: "src/y.ts", line: 5, description: "d", fix: "f",
    });
    const progress = sm.getProgress();
    expect(progress.openFindings).toBe(1);
  });
});

// ============================================================================
// Regression: building→security gates unchanged
// ============================================================================

describe("Regression: building→security gates unchanged", () => {
  it("BLOCKED: building→security without signoff → still blocked", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    // No signoff
    expect(() => sm.setPhase("security")).toThrow("build signoff");
  });
});

// ============================================================================
// Full Gate Sequence: all gates enforce in correct order
// ============================================================================

describe("Full Gate Sequence: correct order enforcement", () => {
  it("gates fire in order: SAST -> findings -> whitebox -> adversarial -> audit -> verification -> backup", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");

    // No SAST -> should fail on SAST first
    expect(() => sm.setPhase("deployment")).toThrow("full SAST");

    // Add SAST -> should fail on whitebox next
    sm.markFullSastRun(0);
    expect(() => sm.setPhase("deployment")).toThrow("whitebox");

    // Add whitebox (without adversarial review) -> should fail on adversarial review next
    addWhiteboxOnly(sm);
    expect(() => sm.setPhase("deployment")).toThrow("adversarial review");

    // Complete adversarial review -> should fail on release audit next
    completeAdversarialReview(sm);
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

// ============================================================================
// Build Signoff: E2E warning for UI slices without Playwright
// ============================================================================

describe("Build Signoff: UI/E2E warning", () => {
  function markSlicesHasUI(tmpDir: string): void {
    const statePath = join(tmpDir, ".a2p", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    for (const s of state.slices) s.hasUI = true;
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  it("UI slices + no Playwright → e2eWarning in build signoff output", () => {
    const sm = initWithStateManager(dir);
    markSlicesHasUI(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    const result = JSON.parse(handleBuildSignoff({ projectPath: dir }));
    expect(result.success).toBe(true);
    expect(result.e2eWarning).toBeDefined();
    expect(result.e2eWarning).toContain("UI slices detected");
    expect(result.e2eWarning).toContain("playwright-mcp");
  });

  it("no UI slices → no e2eWarning in build signoff output", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    const result = JSON.parse(handleBuildSignoff({ projectPath: dir }));
    expect(result.success).toBe(true);
    expect(result.e2eWarning).toBeUndefined();
  });

  it("UI slices + Playwright installed → no e2eWarning", () => {
    const sm = initWithStateManager(dir);
    sm.addCompanion({
      name: "Playwright", type: "playwright",
      command: "npx playwright test", installed: true, config: {},
    });
    markSlicesHasUI(dir);
    forcePhase(dir, "building");
    for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
    const result = JSON.parse(handleBuildSignoff({ projectPath: dir }));
    expect(result.success).toBe(true);
    expect(result.e2eWarning).toBeUndefined();
  });
});

// ============================================================================
// Done Guard: tests must be run after SAST scan
// ============================================================================

describe("Done Guard: post-SAST test requirement", () => {
  it("BLOCKED: done when last test is before SAST → throw", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    const sliceId = sm.read().slices[0].id;
    // Walk to refactor state normally
    addPassingTests(sm, sliceId);
    sm.setSliceStatus(sliceId, "red");
    addPassingTests(sm, sliceId);
    sm.setSliceStatus(sliceId, "green");
    sm.setSliceStatus(sliceId, "refactor");
    // Add test BEFORE SAST
    addPassingTests(sm, sliceId);
    // Small delay to ensure SAST timestamp is after test
    const statePath = join(dir, ".a2p", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    const slice = state.slices.find((s: any) => s.id === sliceId);
    // Force test timestamp to be old
    slice.testResults[slice.testResults.length - 1].timestamp = "2020-01-01T00:00:00.000Z";
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
    // Now run SAST (timestamp will be now())
    sm.markSastRun(sliceId);
    sm.setSliceStatus(sliceId, "sast");
    // Try done without re-running tests
    expect(() => sm.setSliceStatus(sliceId, "done")).toThrow("tests must be re-run after SAST");
  });

  it("ALLOWED: done when last test is after SAST → success", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "building");
    const sliceId = sm.read().slices[0].id;
    // Normal walkSliceToStatus already adds tests after SAST
    walkSliceToStatus(sm, sliceId, "done");
    const slice = sm.read().slices.find(s => s.id === sliceId);
    expect(slice!.status).toBe("done");
  });
});

// ============================================================================
// Record Finding: fingerprint-based dedup
// ============================================================================

describe("Record Finding: fingerprint dedup", () => {
  it("duplicate fingerprint with different ID → error", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    // First finding
    sm.addSASTFinding("s1", {
      id: "F-001", tool: "semgrep", severity: "high", status: "open",
      title: "SQL Injection", file: "src/db.ts", line: 10,
      description: "desc", fix: "fix",
    });
    // Same fingerprint, different ID
    // handleRecordFinding imported at top
    const result = JSON.parse(handleRecordFinding({
      projectPath: dir, sliceId: "s1",
      id: "F-002", tool: "semgrep", severity: "high", status: "open",
      title: "SQL Injection", file: "src/db.ts", line: 10,
      description: "another desc", fix: "fix",
    }));
    expect(result.error).toContain("Duplicate finding");
  });

  it("same file+line but different title → allowed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    // First finding
    sm.addSASTFinding("s1", {
      id: "F-001", tool: "semgrep", severity: "high", status: "open",
      title: "SQL Injection", file: "src/db.ts", line: 10,
      description: "desc", fix: "fix",
    });
    // Same file+line, different title
    // handleRecordFinding imported at top
    const result = JSON.parse(handleRecordFinding({
      projectPath: dir, sliceId: "s1",
      id: "F-002", tool: "semgrep", severity: "high", status: "open",
      title: "XSS Vulnerability", file: "src/db.ts", line: 10,
      description: "another desc", fix: "fix",
    }));
    expect(result.success).toBe(true);
  });
});
