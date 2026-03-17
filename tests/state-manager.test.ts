import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../src/state/state-manager.js";
import type { Slice, TestResult, SASTFinding, QualityIssue } from "../src/state/types.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-test-"));
}

function makeSlice(id: string, overrides?: Partial<Slice>): Slice {
  return {
    id,
    name: `Slice ${id}`,
    description: `Description for ${id}`,
    acceptanceCriteria: ["it works"],
    testStrategy: "unit tests",
    dependencies: [],
    status: "pending",
    files: [],
    testResults: [],
    sastFindings: [],
    ...overrides,
  };
}

describe("StateManager", () => {
  let tmpDir: string;
  let sm: StateManager;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    sm = new StateManager(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("init", () => {
    it("creates initial state with correct defaults", () => {
      const state = sm.init("test-project", tmpDir);

      expect(state.version).toBe(1);
      expect(state.projectName).toBe("test-project");
      expect(state.phase).toBe("onboarding");
      expect(state.architecture).toBeNull();
      expect(state.slices).toEqual([]);
      expect(state.currentSliceIndex).toBe(-1);
      expect(state.companions).toEqual([]);
      expect(state.qualityIssues).toEqual([]);
      expect(state.buildHistory).toEqual([]);
      expect(state.config.projectPath).toBe(tmpDir);
    });

    it("throws if state already exists", () => {
      sm.init("test-project", tmpDir);
      expect(() => sm.init("test-project", tmpDir)).toThrow("already exists");
    });
  });

  describe("exists", () => {
    it("returns false before init", () => {
      expect(sm.exists()).toBe(false);
    });

    it("returns true after init", () => {
      sm.init("test", tmpDir);
      expect(sm.exists()).toBe(true);
    });
  });

  describe("read", () => {
    it("reads back initialized state", () => {
      sm.init("test-project", tmpDir);
      const state = sm.read();
      expect(state.projectName).toBe("test-project");
      expect(state.phase).toBe("onboarding");
    });

    it("throws if no state file", () => {
      expect(() => sm.read()).toThrow("No state file");
    });
  });

  describe("setPhase", () => {
    it("transitions onboarding → planning", () => {
      sm.init("test", tmpDir);
      const state = sm.setPhase("planning");
      expect(state.phase).toBe("planning");
    });

    it("transitions planning → building", () => {
      sm.init("test", tmpDir);
      sm.setPhase("planning");
      const state = sm.setPhase("building");
      expect(state.phase).toBe("building");
    });

    it("rejects invalid transitions", () => {
      sm.init("test", tmpDir);
      expect(() => sm.setPhase("building")).toThrow("Cannot transition");
    });

    it("rejects transition from complete", () => {
      sm.init("test", tmpDir);
      sm.setPhase("planning");
      sm.setPhase("building");
      sm.setBuildSignoff();
      sm.addAuditResult({ id: "AQ1", mode: "quality", timestamp: new Date().toISOString(), findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, buildPassed: true, testsPassed: true, aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 } });
      sm.setPhase("security");
      sm.markFullSastRun(0);
      sm.addWhiteboxResult({ id: "WBA-1", mode: "full", timestamp: new Date().toISOString(), candidates_evaluated: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0 });
      sm.completeAdversarialReview(0, "test");
      sm.clearPendingSecurityDecision();
      sm.addAuditResult({ id: "AR1", mode: "release", timestamp: new Date().toISOString(), findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, buildPassed: true, testsPassed: true, aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 } });
      sm.addActiveVerificationResult({ id: "AV1", timestamp: new Date().toISOString(), round: 1, tests_run: 1, tests_passed: 1, tests_failed: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0, requires_human_review: false });
      sm.setPhase("deployment");
      sm.setSslVerification({ domain: "test.com", verifiedAt: new Date().toISOString(), method: "caddy-auto", issuer: "Let's Encrypt", expiresAt: null, autoRenewal: true, httpsRedirect: true, hstsPresent: true });
      sm.setPhase("complete");
      expect(() => sm.setPhase("onboarding")).toThrow("Cannot transition");
    });

    it("records phase change in build history", () => {
      sm.init("test", tmpDir);
      sm.setPhase("planning");
      const state = sm.read();
      expect(state.buildHistory.length).toBe(1);
      expect(state.buildHistory[0].action).toBe("phase_change");
    });
  });

  describe("setSlices", () => {
    it("sets slices and resets currentSliceIndex to 0", () => {
      sm.init("test", tmpDir);
      const slices = [makeSlice("s1"), makeSlice("s2"), makeSlice("s3")];
      const state = sm.setSlices(slices);

      expect(state.slices.length).toBe(3);
      expect(state.currentSliceIndex).toBe(0);
    });

    it("sets currentSliceIndex to -1 for empty slices", () => {
      sm.init("test", tmpDir);
      const state = sm.setSlices([]);
      expect(state.currentSliceIndex).toBe(-1);
    });
  });

  describe("setSliceStatus", () => {
    beforeEach(() => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2")]);
    });

    it("transitions pending → red", () => {
      const state = sm.setSliceStatus("s1", "red");
      expect(state.slices[0].status).toBe("red");
    });

    it("follows full TDD cycle: pending → red → green → refactor → sast → done", () => {
      sm.setSliceStatus("s1", "red");
      sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "ok" });
      sm.setSliceStatus("s1", "green");
      sm.setSliceStatus("s1", "refactor");
      sm.markSastRun("s1");
      sm.setSliceStatus("s1", "sast");
      sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "ok" });
      const state = sm.setSliceStatus("s1", "done");
      expect(state.slices[0].status).toBe("done");
    });

    it("rejects invalid slice status transitions", () => {
      expect(() => sm.setSliceStatus("s1", "green")).toThrow("cannot transition");
    });

    it("rejects unknown slice ID", () => {
      expect(() => sm.setSliceStatus("nonexistent", "red")).toThrow("not found");
    });

    it("allows sast → red (back to fix)", () => {
      sm.setSliceStatus("s1", "red");
      sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "test", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "ok" });
      sm.setSliceStatus("s1", "green");
      sm.setSliceStatus("s1", "refactor");
      sm.markSastRun("s1");
      sm.setSliceStatus("s1", "sast");
      const state = sm.setSliceStatus("s1", "red");
      expect(state.slices[0].status).toBe("red");
    });
  });

  describe("advanceSlice", () => {
    it("moves to next slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2"), makeSlice("s3")]);
      // currentSliceIndex starts at 0, advance to 1
      const state = sm.advanceSlice();
      expect(state.currentSliceIndex).toBe(1);
    });

    it("throws when no more slices", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);
      expect(() => sm.advanceSlice()).toThrow("No more slices");
    });
  });

  describe("getCurrentSlice", () => {
    it("returns null when no slices", () => {
      sm.init("test", tmpDir);
      expect(sm.getCurrentSlice()).toBeNull();
    });

    it("returns the current slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2")]);
      const slice = sm.getCurrentSlice();
      expect(slice?.id).toBe("s1");
    });
  });

  describe("addTestResult", () => {
    it("appends test result to slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);

      const result: TestResult = {
        timestamp: new Date().toISOString(),
        command: "npm test",
        exitCode: 0,
        passed: 5,
        failed: 0,
        skipped: 1,
        output: "All tests passed",
      };

      const state = sm.addTestResult("s1", result);
      expect(state.slices[0].testResults.length).toBe(1);
      expect(state.slices[0].testResults[0].passed).toBe(5);
    });
  });

  describe("addSASTFinding", () => {
    it("adds finding to a specific slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);

      const finding: SASTFinding = {
        id: "F001",
        tool: "semgrep",
        severity: "high",
        status: "open",
        title: "SQL Injection",
        file: "src/db.py",
        line: 42,
        description: "Unparameterized query",
        fix: "Use parameterized queries",
      };

      const state = sm.addSASTFinding("s1", finding);
      expect(state.slices[0].sastFindings.length).toBe(1);
    });
  });

  describe("addQualityIssue", () => {
    it("adds quality issue to state", () => {
      sm.init("test", tmpDir);

      const issue: QualityIssue = {
        id: "Q001",
        type: "dead_code",
        file: "src/old.py",
        symbol: "unused_function",
        description: "Never called anywhere",
        status: "open",
      };

      const state = sm.addQualityIssue(issue);
      expect(state.qualityIssues.length).toBe(1);
      expect(state.qualityIssues[0].type).toBe("dead_code");
    });
  });

  describe("addCompanion", () => {
    it("adds a new companion", () => {
      sm.init("test", tmpDir);
      const state = sm.addCompanion({
        name: "codebase-memory-mcp",
        type: "codebase_memory",
        command: "codebase-memory-mcp",
        installed: true,
        config: {},
      });
      expect(state.companions.length).toBe(1);
    });

    it("replaces existing companion of same type", () => {
      sm.init("test", tmpDir);
      sm.addCompanion({
        name: "old-db",
        type: "database",
        command: "old",
        installed: false,
        config: {},
      });
      const state = sm.addCompanion({
        name: "supabase-mcp",
        type: "database",
        command: "new",
        installed: true,
        config: {},
      });
      expect(state.companions.length).toBe(1);
      expect(state.companions[0].name).toBe("supabase-mcp");
    });
  });

  describe("setArchitecture", () => {
    it("sets architecture in state", () => {
      sm.init("test", tmpDir);
      const arch = {
        name: "Todo App",
        description: "Simple todo",
        techStack: {
          language: "Python",
          framework: "FastAPI",
          database: "SQLite",
          frontend: null,
          hosting: "Hetzner",
          other: [],
        },
        features: ["CRUD todos", "Auth"],
        dataModel: "todos table",
        apiDesign: "REST",
        raw: "Build a todo app with FastAPI",
      };

      const state = sm.setArchitecture(arch);
      expect(state.architecture?.name).toBe("Todo App");
      expect(state.architecture?.techStack.database).toBe("SQLite");
    });
  });

  describe("getProgress", () => {
    it("returns correct progress summary", () => {
      sm.init("test", tmpDir);
      sm.setSlices([
        makeSlice("s1", { status: "done" }),
        makeSlice("s2", { status: "green" }),
        makeSlice("s3"),
      ]);

      // Add test results to s1
      sm.addTestResult("s1", {
        timestamp: new Date().toISOString(),
        command: "test",
        exitCode: 0,
        passed: 10,
        failed: 2,
        skipped: 0,
        output: "",
      });

      // Add an open finding
      sm.addSASTFinding("s2", {
        id: "F1",
        tool: "semgrep",
        severity: "high",
        status: "open",
        title: "test",
        file: "a.py",
        line: 1,
        description: "",
        fix: "",
      });

      const progress = sm.getProgress();
      expect(progress.totalSlices).toBe(3);
      expect(progress.doneSlices).toBe(1);
      expect(progress.testsPassed).toBe(10);
      expect(progress.testsFailed).toBe(2);
      expect(progress.openFindings).toBe(1);
      expect(progress.currentSlice).toBe("Slice s1");
    });
  });

  describe("updateConfig", () => {
    it("merges partial config without overwriting existing fields", () => {
      sm.init("test", tmpDir);
      sm.updateConfig({ testCommand: "pytest" });
      sm.updateConfig({ lintCommand: "ruff check ." });

      const state = sm.read();
      expect(state.config.testCommand).toBe("pytest");
      expect(state.config.lintCommand).toBe("ruff check .");
    });

    it("overwrites a specific field", () => {
      sm.init("test", tmpDir);
      sm.updateConfig({ testCommand: "old" });
      sm.updateConfig({ testCommand: "new" });

      const state = sm.read();
      expect(state.config.testCommand).toBe("new");
    });
  });

  describe("addSASTFinding with null sliceId", () => {
    it("records event in buildHistory but NOT in any slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);

      const finding: SASTFinding = {
        id: "F001",
        tool: "semgrep",
        severity: "medium",
        status: "open",
        title: "Hardcoded secret",
        file: "src/config.py",
        line: 10,
        description: "Found hardcoded API key",
        fix: "Use environment variable",
      };

      const state = sm.addSASTFinding(null, finding);
      // Should NOT be in slice findings
      expect(state.slices[0].sastFindings.length).toBe(0);
      // Should be in build history
      const lastEvent = state.buildHistory[state.buildHistory.length - 1];
      expect(lastEvent.action).toBe("sast_finding");
    });
  });

  describe("read with corrupt state", () => {
    it("throws on invalid JSON", () => {
      sm.init("test", tmpDir);
      // Corrupt the state file
      const { writeFileSync } = require("node:fs");
      writeFileSync(join(tmpDir, ".a2p", "state.json"), "{{invalid json", "utf-8");

      expect(() => sm.read()).toThrow();
    });

    it("throws on valid JSON but invalid schema", () => {
      sm.init("test", tmpDir);
      const { writeFileSync } = require("node:fs");
      writeFileSync(
        join(tmpDir, ".a2p", "state.json"),
        JSON.stringify({ version: "not-a-number", projectName: "" }),
        "utf-8"
      );

      expect(() => sm.read()).toThrow();
    });
  });

  describe("getProgress without slices", () => {
    it("returns zeroes and null currentSlice", () => {
      sm.init("test", tmpDir);
      const progress = sm.getProgress();
      expect(progress.totalSlices).toBe(0);
      expect(progress.doneSlices).toBe(0);
      expect(progress.currentSlice).toBeNull();
      expect(progress.testsPassed).toBe(0);
      expect(progress.testsFailed).toBe(0);
    });
  });

  describe("setSliceStatus records event", () => {
    it("records slice_status event with correct action", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);
      sm.setSliceStatus("s1", "red");

      const state = sm.read();
      const lastEvent = state.buildHistory[state.buildHistory.length - 1];
      expect(lastEvent.action).toBe("slice_status");
      expect(lastEvent.details).toContain("s1");
      expect(lastEvent.details).toContain("red");
    });
  });

  describe("advanceSlice records event with slice name", () => {
    it("event details contain the name of the new current slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2", { name: "My Second Slice" })]);
      sm.advanceSlice();

      const state = sm.read();
      const lastEvent = state.buildHistory[state.buildHistory.length - 1];
      expect(lastEvent.action).toBe("slice_advance");
      expect(lastEvent.details).toContain("My Second Slice");
    });
  });

  describe("backup", () => {
    it("creates backup on write", () => {
      sm.init("test", tmpDir);
      // Second write triggers backup
      sm.setPhase("planning");

      const { existsSync } = require("node:fs");
      expect(existsSync(join(tmpDir, ".a2p", "state.json.bak"))).toBe(true);
    });
  });

  describe("addSlices", () => {
    it("appends slices to existing plan", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2")]);
      const state = sm.addSlices([makeSlice("s3"), makeSlice("s4")]);

      expect(state.slices.length).toBe(4);
      expect(state.slices[2].id).toBe("s3");
      expect(state.slices[3].id).toBe("s4");
    });

    it("sets currentSliceIndex to first new slice", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1"), makeSlice("s2")]);
      const state = sm.addSlices([makeSlice("s3")]);
      expect(state.currentSliceIndex).toBe(2);
    });
  });

  describe("completeProductPhase", () => {
    function setupWithPhases() {
      sm.init("test", tmpDir);
      sm.setArchitecture({
        name: "Test",
        description: "Test",
        techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
        features: ["A", "B"],
        dataModel: "x",
        apiDesign: "REST",
        raw: "",
        phases: [
          { id: "phase-0", name: "Spikes", description: "Evaluate", deliverables: ["A"], timeline: "W1" },
          { id: "phase-1", name: "MVP", description: "Build", deliverables: ["B"], timeline: "W2-4" },
        ],
      });
    }

    it("throws when no phases defined", () => {
      sm.init("test", tmpDir);
      sm.setArchitecture({
        name: "Test",
        description: "Test",
        techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
        features: ["A"],
        dataModel: "x",
        apiDesign: "REST",
        raw: "",
      });
      expect(() => sm.completeProductPhase()).toThrow("No product phases");
    });

    it("throws when slices not done", () => {
      setupWithPhases();
      sm.setSlices([makeSlice("s1", { productPhaseId: "phase-0" })]);
      expect(() => sm.completeProductPhase()).toThrow("not done");
    });

    it("advances to next phase when slices done", () => {
      setupWithPhases();
      sm.setSlices([makeSlice("s1", { productPhaseId: "phase-0", status: "done" })]);
      const state = sm.completeProductPhase();
      expect(state.currentProductPhase).toBe(1);
      expect(state.phase).toBe("planning");
    });

    it("completes project on last phase", () => {
      setupWithPhases();
      sm.setSlices([
        makeSlice("s1", { productPhaseId: "phase-0", status: "done" }),
        makeSlice("s2", { productPhaseId: "phase-1", status: "done" }),
      ]);
      // Complete phase 0
      sm.completeProductPhase();
      // Set SSL verification directly on state (setSslVerification requires deployment phase)
      const statePath = join(tmpDir, ".a2p", "state.json");
      const raw = JSON.parse(readFileSync(statePath, "utf-8"));
      raw.sslVerifiedAt = new Date().toISOString();
      raw.sslVerification = { domain: "test.com", verifiedAt: new Date().toISOString(), method: "caddy-auto", issuer: "Let's Encrypt", expiresAt: null, autoRenewal: true, httpsRedirect: true, hstsPresent: true };
      writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
      // Complete phase 1
      const state = sm.completeProductPhase();
      expect(state.phase).toBe("complete");
    });
  });

  describe("getCurrentProductPhase", () => {
    it("returns null when no phases", () => {
      sm.init("test", tmpDir);
      expect(sm.getCurrentProductPhase()).toBeNull();
    });

    it("returns current phase", () => {
      sm.init("test", tmpDir);
      sm.setArchitecture({
        name: "Test",
        description: "Test",
        techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
        features: ["A"],
        dataModel: "x",
        apiDesign: "REST",
        raw: "",
        phases: [
          { id: "phase-0", name: "Spikes", description: "Evaluate", deliverables: ["A"], timeline: "W1" },
        ],
      });
      const phase = sm.getCurrentProductPhase();
      expect(phase?.id).toBe("phase-0");
      expect(phase?.name).toBe("Spikes");
    });
  });

  describe("isLastProductPhase", () => {
    it("returns true when no phases", () => {
      sm.init("test", tmpDir);
      expect(sm.isLastProductPhase()).toBe(true);
    });

    it("returns false for first of two phases", () => {
      sm.init("test", tmpDir);
      sm.setArchitecture({
        name: "Test",
        description: "Test",
        techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
        features: ["A"],
        dataModel: "x",
        apiDesign: "REST",
        raw: "",
        phases: [
          { id: "phase-0", name: "Spikes", description: "Evaluate", deliverables: ["A"], timeline: "W1" },
          { id: "phase-1", name: "MVP", description: "Build", deliverables: ["B"], timeline: "W2" },
        ],
      });
      expect(sm.isLastProductPhase()).toBe(false);
    });
  });

  describe("backward compat: state without currentProductPhase", () => {
    it("reads old state file missing currentProductPhase field (defaults to 0)", () => {
      sm.init("test", tmpDir);
      // Simulate old state file by removing currentProductPhase
      const { readFileSync, writeFileSync } = require("node:fs");
      const statePath = join(tmpDir, ".a2p", "state.json");
      const raw = JSON.parse(readFileSync(statePath, "utf-8"));
      delete raw.currentProductPhase;
      writeFileSync(statePath, JSON.stringify(raw), "utf-8");

      const state = sm.read();
      expect(state.currentProductPhase).toBe(0);
    });
  });

  describe("backward compat: adversarialReviewCompletedAt migration", () => {
    it("migrates old string field to AdversarialReviewState object", () => {
      sm.init("test", tmpDir);
      const { readFileSync, writeFileSync } = require("node:fs");
      const statePath = join(tmpDir, ".a2p", "state.json");
      const raw = JSON.parse(readFileSync(statePath, "utf-8"));
      // Simulate old format
      delete raw.adversarialReviewState;
      raw.adversarialReviewCompletedAt = "2026-03-15T12:00:00.000Z";
      writeFileSync(statePath, JSON.stringify(raw), "utf-8");

      const state = sm.read();
      expect(state.adversarialReviewState).not.toBeNull();
      expect(state.adversarialReviewState!.completedAt).toBe("2026-03-15T12:00:00.000Z");
      expect(state.adversarialReviewState!.round).toBe(1);
      expect(state.adversarialReviewState!.totalFindingsRecorded).toBe(0);
      expect(state.adversarialReviewState!.roundHistory).toEqual([]);
    });

    it("migrates old null field to null", () => {
      sm.init("test", tmpDir);
      const { readFileSync, writeFileSync } = require("node:fs");
      const statePath = join(tmpDir, ".a2p", "state.json");
      const raw = JSON.parse(readFileSync(statePath, "utf-8"));
      delete raw.adversarialReviewState;
      raw.adversarialReviewCompletedAt = null;
      writeFileSync(statePath, JSON.stringify(raw), "utf-8");

      const state = sm.read();
      expect(state.adversarialReviewState).toBeNull();
    });
  });

  describe("addSASTFinding does not trigger stale SAST", () => {
    it("markFullSastRun → addSASTFinding → SAST not stale", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);
      sm.markFullSastRun(0);

      sm.addSASTFinding("s1", {
        id: "F1",
        tool: "semgrep",
        severity: "medium",
        status: "open",
        title: "test finding",
        file: "app.ts",
        line: 1,
        description: "test",
        fix: "",
      });

      const state = sm.read();
      // lastFullSastAt should still be >= lastSecurityRelevantChangeAt
      // (addSASTFinding should NOT call setLastSecurityRelevantChange)
      expect(state.lastFullSastAt).not.toBeNull();
      if (state.lastSecurityRelevantChangeAt) {
        expect(new Date(state.lastFullSastAt!).getTime())
          .toBeGreaterThanOrEqual(new Date(state.lastSecurityRelevantChangeAt).getTime());
      }
    });

    it("markFullSastRun → updateSASTFinding → SAST not stale", () => {
      sm.init("test", tmpDir);
      sm.setSlices([makeSlice("s1")]);

      sm.addSASTFinding("s1", {
        id: "F1",
        tool: "semgrep",
        severity: "medium",
        status: "open",
        title: "test finding",
        file: "app.ts",
        line: 1,
        description: "test",
        fix: "",
      });

      sm.markFullSastRun(1);

      sm.updateSASTFinding("s1", "F1", { status: "false_positive", justification: "not applicable" });

      const state = sm.read();
      expect(state.lastFullSastAt).not.toBeNull();
      if (state.lastSecurityRelevantChangeAt) {
        expect(new Date(state.lastFullSastAt!).getTime())
          .toBeGreaterThanOrEqual(new Date(state.lastSecurityRelevantChangeAt).getTime());
      }
    });
  });

  describe("deployment to planning transition", () => {
    it("allows deployment → planning for multi-phase", () => {
      sm.init("test", tmpDir);
      sm.setPhase("planning");
      sm.setPhase("building");
      sm.setBuildSignoff();
      sm.addAuditResult({ id: "AQ1", mode: "quality", timestamp: new Date().toISOString(), findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, buildPassed: true, testsPassed: true, aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 } });
      sm.setPhase("security");
      sm.markFullSastRun(0);
      sm.addWhiteboxResult({ id: "WBA-1", mode: "full", timestamp: new Date().toISOString(), candidates_evaluated: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0 });
      sm.completeAdversarialReview(0, "test");
      sm.clearPendingSecurityDecision();
      sm.addAuditResult({ id: "AR1", mode: "release", timestamp: new Date().toISOString(), findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, buildPassed: true, testsPassed: true, aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 0, slicesTotal: 0 } });
      sm.addActiveVerificationResult({ id: "AV1", timestamp: new Date().toISOString(), round: 1, tests_run: 1, tests_passed: 1, tests_failed: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0, requires_human_review: false });
      sm.setPhase("deployment");
      const state = sm.setPhase("planning");
      expect(state.phase).toBe("planning");
    });
  });
});
