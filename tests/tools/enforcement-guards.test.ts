import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../../src/state/state-manager.js";
import { handleRunTests } from "../../src/tools/run-tests.js";
import { handleRunSast } from "../../src/tools/run-sast.js";
import { handleRunAudit } from "../../src/tools/run-audit.js";
import { handleRunWhiteboxAudit } from "../../src/tools/run-whitebox-audit.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { handleRunQuality } from "../../src/tools/run-quality.js";
import { handleRunE2e } from "../../src/tools/run-e2e.js";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleGetChecklist } from "../../src/tools/get-checklist.js";
import { handleBuildSignoff } from "../../src/tools/build-signoff.js";
import { handleDeployApproval } from "../../src/tools/deploy-approval.js";
import { ProjectStateSchema } from "../../src/state/validators.js";
import {
  makeTmpDir, cleanTmpDir, parse, forcePhase,
  initWithStateManager, walkSliceToStatus, addPassingTests,
  forceField, addQualityAudit, addReleaseAudit, addPassingVerification,
} from "../helpers/setup.js";

describe("Enforcement Guards", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir("a2p-guards"); });
  afterEach(() => { cleanTmpDir(dir); });

  // === Phase Guards (~12) ===

  describe("phase guards", () => {
    it("a2p_run_tests in security phase → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleRunTests({ projectPath: dir, sliceId: "s1" }));
      expect(result.error).toContain("building");
    });

    it("a2p_run_sast mode=slice in security → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleRunSast({ projectPath: dir, sliceId: "s1", mode: "slice" }));
      expect(result.error).toContain("building");
    });

    it("a2p_run_sast mode=full in building → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      const result = parse(handleRunSast({ projectPath: dir, sliceId: null, mode: "full" }));
      expect(result.error).toContain("security");
    });

    it("a2p_run_sast mode=full in security → OK (no phase error)", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleRunSast({ projectPath: dir, sliceId: null, mode: "full" }));
      // Should not have a phase error — may have semgrep-not-installed but that's fine
      expect(result.error).toBeUndefined();
      expect(result.success).toBe(true);
    }, 15000);

    it("a2p_run_audit mode=quality in security → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
      expect(result.error).toContain("building");
    });

    it("a2p_run_audit mode=release in building → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      const result = parse(handleRunAudit({ projectPath: dir, mode: "release", runBuild: false, runTests: false }));
      expect(result.error).toContain("security");
    });

    it("a2p_run_whitebox_audit in building → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
      expect(result.error).toContain("security");
    });

    it("a2p_generate_deployment in security → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleGenerateDeployment({ projectPath: dir }));
      expect(result.error).toContain("deployment");
    });

    it("a2p_update_slice in security → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "red" }));
      expect(result.error).toContain("building");
    });

    it("a2p_record_finding in deployment → OK", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      const result = parse(handleRecordFinding({
        projectPath: dir, sliceId: "s1", id: "F1", tool: "manual",
        severity: "low", status: "open", title: "test", file: "t.ts", line: 1,
        description: "d", fix: "f",
      }));
      expect(result.error).toBeUndefined();
    });

    it("a2p_get_checklist in building → OK (read-only, no phase guard)", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      const result = parse(handleGetChecklist({ projectPath: dir }));
      expect(result.error).toBeUndefined();
    });

    it("a2p_run_e2e in building → OK", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      const result = parse(handleRunE2e({
        projectPath: dir, baseUrl: "http://localhost:3000",
        scenarios: [{ name: "test", steps: ["step"], passed: true }],
      }));
      expect(result.error).toBeUndefined();
    });
  });

  // === Build Signoff + Invalidation (~6) ===

  describe("build signoff", () => {
    it("setBuildSignoff in building with done slices → OK", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      const state = sm.setBuildSignoff("tested everything");
      expect(state.buildSignoffAt).toBeTruthy();
      expect(state.buildSignoffSliceHash).toBeTruthy();
    });

    it("setBuildSignoff with undone slices → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      expect(() => sm.setBuildSignoff()).toThrow("not done");
    });

    it("setBuildSignoff in wrong phase → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      expect(() => sm.setBuildSignoff()).toThrow("building phase");
    });

    it("building→security without signoff → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      expect(() => sm.setPhase("security")).toThrow("build signoff");
    });

    it("signoff invalidated after addTestResult → building→security → throw (stale signoff)", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      expect(sm.read().buildSignoffAt).toBeTruthy();
      // Adding a test result invalidates the signoff
      addPassingTests(sm, sm.read().slices[0].id);
      expect(sm.read().buildSignoffAt).toBeNull();
      // Trying to proceed to security fails
      expect(() => sm.setPhase("security")).toThrow("build signoff");
    });

    it("signoff invalidated after addTestResult", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      expect(sm.read().buildSignoffAt).toBeTruthy();
      addPassingTests(sm, sm.read().slices[0].id);
      expect(sm.read().buildSignoffAt).toBeNull();
    });
  });

  // === Deploy Approval + Invalidation (~5) ===

  describe("deploy approval", () => {
    it("setDeployApproval in deployment → OK", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      sm.markFullSastRun(0);
      const state = sm.setDeployApproval("staging tested");
      expect(state.deployApprovalAt).toBeTruthy();
      expect(state.deployApprovalStateHash).toBeTruthy();
    });

    it("setDeployApproval in wrong phase → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      expect(() => sm.setDeployApproval()).toThrow("deployment phase");
    });

    it("generate-deployment without approval → error", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      const result = parse(handleGenerateDeployment({ projectPath: dir }));
      expect(result.error).toContain("approval");
    });

    it("approval invalidated after addSASTFinding", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      sm.markFullSastRun(0);
      sm.setDeployApproval();
      expect(sm.read().deployApprovalAt).toBeTruthy();
      sm.addSASTFinding("s1", {
        id: "NEW-1", tool: "manual", severity: "low", status: "open",
        title: "test", file: "t.ts", line: 1, description: "d", fix: "f",
      });
      expect(sm.read().deployApprovalAt).toBeNull();
    });

    it("approval invalidated after addWhiteboxResult", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      sm.markFullSastRun(0);
      sm.setDeployApproval();
      expect(sm.read().deployApprovalAt).toBeTruthy();
      sm.addWhiteboxResult({
        id: "WBA-1", mode: "full", timestamp: new Date().toISOString(),
        candidates_evaluated: 0, findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 },
        blocking_count: 0,
      });
      expect(sm.read().deployApprovalAt).toBeNull();
    });
  });

  // === SAST Gate (~3) ===

  describe("SAST deployment gate", () => {
    it("security→deployment without full SAST → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      expect(() => sm.setPhase("deployment")).toThrow("full SAST");
    });

    it("security→deployment with full SAST + release audit + verification → OK", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addReleaseAudit(sm);
      addPassingVerification(sm);
      expect(() => sm.setPhase("deployment")).not.toThrow();
    });

    it("markFullSastRun sets lastFullSastAt + lastFullSastFindingCount", () => {
      const sm = initWithStateManager(dir);
      sm.markFullSastRun(5);
      const state = sm.read();
      expect(state.lastFullSastAt).toBeTruthy();
      expect(state.lastFullSastFindingCount).toBe(5);
    });
  });

  // === Whitebox SAST precondition (~3) ===

  describe("whitebox SAST precondition", () => {
    it("whitebox without any SAST → warning with reason no_sast_at_all", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
      expect(result.warning).toBeDefined();
      expect(result.reason).toBe("no_sast_at_all");
    });

    it("whitebox with slice SAST but no full SAST → warning with reason no_full_sast", () => {
      const sm = initWithStateManager(dir);
      sm.markSastRun("s1");
      forcePhase(dir, "security");
      const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
      expect(result.warning).toBeDefined();
      expect(result.reason).toBe("no_full_sast");
    });

    it("whitebox after full SAST with no findings → normal clean result", () => {
      const sm = initWithStateManager(dir);
      sm.markFullSastRun(0);
      forcePhase(dir, "security");
      const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
      expect(result.warning).toBeUndefined();
      expect(result.success).toBe(true);
    });
  });

  // === Test command override (~2) ===

  describe("test command override restriction", () => {
    it("override blocked when testCommand is configured", () => {
      const sm = initWithStateManager(dir);
      sm.updateConfig({ testCommand: "npm test" });
      forcePhase(dir, "building");
      const result = parse(handleRunTests({
        projectPath: dir, sliceId: "s1", command: "echo hacked",
      }));
      expect(result.error).toContain("override not allowed");
    });

    it("override allowed when testCommand is empty (first-time setup)", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      // config.testCommand is "" by default
      const result = parse(handleRunTests({
        projectPath: dir, sliceId: "s1", command: "echo '1 passed'",
      }));
      // Should not have phase error or override error
      expect(result.error).toBeUndefined();
    });
  });

  // === Hardening v2 (~9) ===

  describe("deploy approval invalidation (v2)", () => {
    it("deploy approval invalidated after addAuditResult", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      sm.markFullSastRun(0);
      sm.setDeployApproval();
      expect(sm.read().deployApprovalAt).toBeTruthy();
      sm.addAuditResult({
        id: "AUD-1", mode: "release", timestamp: new Date().toISOString(),
        findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 },
        buildPassed: true, testsPassed: true,
        aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 3, slicesTotal: 3 },
      });
      expect(sm.read().deployApprovalAt).toBeNull();
    });

    it("deploy approval invalidated after markFullSastRun", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      sm.markFullSastRun(0);
      sm.setDeployApproval();
      expect(sm.read().deployApprovalAt).toBeTruthy();
      sm.markFullSastRun(1);
      expect(sm.read().deployApprovalAt).toBeNull();
    });
  });

  describe("stale SAST detection (v2)", () => {
    it("stale full SAST blocks security→deployment", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      // Set SAST to an old timestamp, then trigger a change after it
      forceField(dir, "lastFullSastAt", "2020-01-01T00:00:00.000Z");
      sm.addSASTFinding("s1", {
        id: "STALE-1", tool: "manual", severity: "low", status: "open",
        title: "new finding", file: "t.ts", line: 1, description: "d", fix: "f",
      });
      expect(() => sm.setPhase("deployment")).toThrow("stale");
    });

    it("whitebox with stale full SAST → warning stale_full_sast", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "security");
      // Force stale timestamps: SAST ran before last security-relevant change, no open findings
      forceField(dir, "lastFullSastAt", "2020-01-01T00:00:00.000Z");
      forceField(dir, "lastSecurityRelevantChangeAt", "2025-01-01T00:00:00.000Z");
      const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
      expect(result.warning).toBeDefined();
      expect(result.reason).toBe("stale_full_sast");
    });
  });

  describe("architecture invalidation (v2)", () => {
    it("architecture change invalidates build signoff", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      sm.setBuildSignoff();
      expect(sm.read().buildSignoffAt).toBeTruthy();
      sm.setArchitecture({
        name: "New", description: "Changed", techStack: {
          language: "Go", framework: "Gin", database: null, frontend: null, hosting: null, other: [],
        }, features: ["f2"], dataModel: "none", apiDesign: "REST", raw: "",
      });
      expect(sm.read().buildSignoffAt).toBeNull();
    });
  });

  describe("deploy approval preconditions (v2)", () => {
    it("setDeployApproval without full SAST → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      expect(() => sm.setDeployApproval()).toThrow("full SAST");
    });

    it("setDeployApproval with stale SAST → throw", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "deployment");
      // Set SAST to an old timestamp, then trigger a change after it
      forceField(dir, "lastFullSastAt", "2020-01-01T00:00:00.000Z");
      sm.addSASTFinding("s1", {
        id: "STALE-3", tool: "manual", severity: "low", status: "open",
        title: "post-sast", file: "t.ts", line: 1, description: "d", fix: "f",
      });
      expect(() => sm.setDeployApproval()).toThrow("stale");
    });
  });

  describe("test command override escape hatch (v2)", () => {
    it("override allowed with allowTestCommandOverride=true", () => {
      const sm = initWithStateManager(dir);
      sm.updateConfig({ testCommand: "npm test", allowTestCommandOverride: true });
      forcePhase(dir, "building");
      const result = parse(handleRunTests({
        projectPath: dir, sliceId: "s1", command: "echo '1 passed'",
      }));
      expect(result.error).toBeUndefined();
    });
  });

  // === Backward compat (~2) ===

  describe("backward compatibility", () => {
    it("old state without new fields loads with defaults", () => {
      const raw = {
        version: 1, projectName: "old", architecture: null, slices: [],
        currentSliceIndex: -1, phase: "onboarding",
        config: { projectPath: dir, testCommand: "", lintCommand: "", buildCommand: "", formatCommand: "" },
        companions: [], qualityIssues: [], buildHistory: [],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      const result = ProjectStateSchema.parse(raw);
      expect(result.lastSecurityRelevantChangeAt).toBeNull();
      expect(result.lastFullSastAt).toBeNull();
      expect(result.lastFullSastFindingCount).toBe(0);
      expect(result.buildSignoffAt).toBeNull();
      expect(result.buildSignoffSliceHash).toBeNull();
      expect(result.deployApprovalAt).toBeNull();
      expect(result.deployApprovalStateHash).toBeNull();
      expect(result.config.allowTestCommandOverride).toBe(false);
    });

    it("a2p_build_signoff tool returns success", () => {
      const sm = initWithStateManager(dir);
      forcePhase(dir, "building");
      for (const s of sm.read().slices) walkSliceToStatus(sm, s.id, "done");
      const result = parse(handleBuildSignoff({ projectPath: dir, note: "looks good" }));
      expect(result.success).toBe(true);
      expect(result.signedOffAt).toBeTruthy();
      expect(result.note).toBe("looks good");
    });
  });
});
