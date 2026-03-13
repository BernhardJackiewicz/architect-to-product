import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
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
      sm.setPhase("security");
      sm.setPhase("deployment");
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
      sm.setSliceStatus("s1", "green");
      sm.setSliceStatus("s1", "refactor");
      sm.setSliceStatus("s1", "sast");
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
      sm.setSliceStatus("s1", "green");
      sm.setSliceStatus("s1", "refactor");
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

  describe("backup", () => {
    it("creates backup on write", () => {
      sm.init("test", tmpDir);
      // Second write triggers backup
      sm.setPhase("planning");

      const { existsSync } = require("node:fs");
      expect(existsSync(join(tmpDir, ".a2p", "state.json.bak"))).toBe(true);
    });
  });
});
