import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import { handleAddSlice } from "../../src/tools/add-slice.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleCompletePhase } from "../../src/tools/complete-phase.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { handleGetState } from "../../src/tools/get-state.js";
import { useLegacySliceFlow, makeTmpDir, initWithStateManager, addPassingTests, addSastEvidence, walkSliceToStatus, forcePhase, addQualityAudit, addReleaseAudit, addPassingVerification, addPassingWhitebox } from "../helpers/setup.js";

// ─── StateManager new methods ───────────────────────────────────────────────

useLegacySliceFlow();

describe("StateManager: addBuildEvents", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    const sm = new StateManager(dir);
    sm.init("test", dir);
  });

  it("persists build events to state", () => {
    const sm = new StateManager(dir);
    sm.addBuildEvents([
      { phase: "onboarding", sliceId: null, action: "e2e_test", details: "PASS: smoke" },
      { phase: "onboarding", sliceId: null, action: "e2e_test", details: "FAIL: auth" },
    ]);

    const state = sm.read();
    const e2eEvents = state.buildHistory.filter((e) => e.action === "e2e_test");
    expect(e2eEvents).toHaveLength(2);
    expect(e2eEvents[0].details).toBe("PASS: smoke");
    expect(e2eEvents[1].details).toBe("FAIL: auth");
    // Timestamps should be set
    expect(e2eEvents[0].timestamp).toBeTruthy();
  });
});

describe("StateManager: updateSliceFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    initWithStateManager(dir, 2);
  });

  it("merges files into slice", () => {
    const sm = new StateManager(dir);
    sm.updateSliceFiles("s1", ["a.ts", "b.ts"]);
    sm.updateSliceFiles("s1", ["b.ts", "c.ts"]); // b.ts deduplicated

    const state = sm.read();
    const s1 = state.slices.find((s) => s.id === "s1")!;
    expect(s1.files).toHaveLength(3);
    expect(s1.files).toContain("a.ts");
    expect(s1.files).toContain("b.ts");
    expect(s1.files).toContain("c.ts");
  });

  it("throws for unknown slice", () => {
    const sm = new StateManager(dir);
    expect(() => sm.updateSliceFiles("nonexistent", ["a.ts"])).toThrow("not found");
  });
});

describe("StateManager: setCurrentSliceIndex", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    initWithStateManager(dir, 3);
  });

  it("sets index correctly", () => {
    const sm = new StateManager(dir);
    sm.setCurrentSliceIndex(2);
    const state = sm.read();
    expect(state.currentSliceIndex).toBe(2);
  });

  it("allows -1 (no current slice)", () => {
    const sm = new StateManager(dir);
    sm.setCurrentSliceIndex(-1);
    expect(sm.read().currentSliceIndex).toBe(-1);
  });

  it("rejects out-of-bounds index", () => {
    const sm = new StateManager(dir);
    expect(() => sm.setCurrentSliceIndex(10)).toThrow("Invalid slice index");
  });
});

// ─── add-slice: index preservation ──────────────────────────────────────────

describe("add-slice: currentSliceIndex preservation", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    initWithStateManager(dir, 3);
  });

  it("preserves index when appending to end", () => {
    const sm = new StateManager(dir);
    // Set to slice 1 (index 1)
    sm.setCurrentSliceIndex(1);

    handleAddSlice({
      projectPath: dir,
      slice: {
        id: "s-new",
        name: "New Slice",
        description: "appended",
        acceptanceCriteria: ["AC"],
        testStrategy: "unit",
        dependencies: [],
      },
    });

    const state = sm.read();
    expect(state.currentSliceIndex).toBe(1); // preserved
    expect(state.slices).toHaveLength(4);
  });

  it("shifts index when inserting before current slice", () => {
    const sm = new StateManager(dir);
    // Currently working on slice 2 (index 2)
    sm.setCurrentSliceIndex(2);

    handleAddSlice({
      projectPath: dir,
      slice: {
        id: "s-insert",
        name: "Inserted",
        description: "inserted before current",
        acceptanceCriteria: ["AC"],
        testStrategy: "unit",
        dependencies: [],
      },
      insertAfterSliceId: "s1", // insert at position 2, pushing s3 to position 3
    });

    const state = sm.read();
    // s3 was at index 2, now should be at index 3
    expect(state.currentSliceIndex).toBe(3);
    expect(state.slices[3].id).toBe("s3");
  });

  it("preserves index when inserting after current slice", () => {
    const sm = new StateManager(dir);
    sm.setCurrentSliceIndex(0); // working on s1

    handleAddSlice({
      projectPath: dir,
      slice: {
        id: "s-after",
        name: "After",
        description: "after current",
        acceptanceCriteria: ["AC"],
        testStrategy: "unit",
        dependencies: [],
      },
      insertAfterSliceId: "s2",
    });

    const state = sm.read();
    expect(state.currentSliceIndex).toBe(0); // unchanged
  });

  it("rejects self-dependency", () => {
    const result = JSON.parse(
      handleAddSlice({
        projectPath: dir,
        slice: {
          id: "s-self",
          name: "Self",
          description: "self dep",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: ["s-self"],
        },
      })
    );
    expect(result.error).toContain("cannot depend on itself");
  });
});

// ─── create-build-plan: combined graph cycle detection ──────────────────────

describe("create-build-plan: combined graph cycle detection", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "Test",
      description: "Test",
      techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f1"],
      dataModel: "none",
      apiDesign: "REST",
      raw: "",
    });
  });

  it("detects cycles within appended batch that reference existing slices", () => {
    // First plan: A → B (A depends on B)
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "b",
          name: "B",
          description: "base",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: [],
        },
        {
          id: "a",
          name: "A",
          description: "depends on b",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: ["b"],
        },
      ],
    });

    // Append: C → D → C (cycle within new batch)
    const result = JSON.parse(
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "c",
            name: "C",
            description: "cycle part 1",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: ["d", "a"], // depends on existing A + new D
          },
          {
            id: "d",
            name: "D",
            description: "cycle part 2",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: ["c"], // cycle: C → D → C
          },
        ],
        append: true,
      })
    );

    expect(result.error).toContain("Circular dependency");
  });

  it("allows valid append without cycles", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "base",
          name: "Base",
          description: "base",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: [],
        },
      ],
    });

    const result = JSON.parse(
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "ext",
            name: "Extension",
            description: "extends base",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: ["base"],
          },
        ],
        append: true,
      })
    );

    expect(result.success).toBe(true);
    expect(result.totalSlices).toBe(2);
  });

  it("rejects duplicate IDs in input", () => {
    const result = JSON.parse(
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "dup",
            name: "First",
            description: "first",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: [],
          },
          {
            id: "dup",
            name: "Second",
            description: "second",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: [],
          },
        ],
      })
    );
    expect(result.error).toContain("Duplicate slice ID");
  });

  it("rejects IDs that collide with existing plan", () => {
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "existing",
          name: "Existing",
          description: "existing",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: [],
        },
      ],
    });

    const result = JSON.parse(
      handleCreateBuildPlan({
        projectPath: dir,
        slices: [
          {
            id: "existing",
            name: "Collision",
            description: "collision",
            acceptanceCriteria: ["AC"],
            testStrategy: "unit",
            dependencies: [],
          },
        ],
        append: true,
      })
    );
    expect(result.error).toContain("already exists");
  });
});

// ─── complete-phase: precondition checks ────────────────────────────────────

describe("complete-phase: blocks on open high/critical findings", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    const sm = new StateManager(dir);
    sm.init("test", dir);
    sm.setArchitecture({
      name: "Test",
      description: "Test",
      techStack: { language: "TS", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["f1"],
      dataModel: "none",
      apiDesign: "REST",
      raw: "",
      phases: [
        { id: "p0", name: "Phase 0", description: "first", deliverables: ["d1"], timeline: "w1" },
        { id: "p1", name: "Phase 1", description: "second", deliverables: ["d2"], timeline: "w2" },
      ],
    });

    // Create and complete a slice in phase 0
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s1",
          name: "S1",
          description: "slice",
          acceptanceCriteria: ["AC"],
          testStrategy: "unit",
          dependencies: [],
          productPhaseId: "p0",
        },
      ],
    });

    walkSliceToStatus(sm, "s1", "done");
  });

  it("blocks when open critical findings exist", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F001",
      tool: "manual",
      severity: "critical",
      status: "open",
      title: "SQL Injection",
      file: "app.ts",
      line: 42,
      description: "Unparameterized query",
      fix: "",
    });

    const result = JSON.parse(handleCompletePhase({ projectPath: dir }));
    expect(result.error).toContain("CRITICAL/HIGH");
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].severity).toBe("critical");
  });

  it("allows completion when findings are fixed", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F002",
      tool: "manual",
      severity: "high",
      status: "fixed",
      title: "XSS",
      file: "app.ts",
      line: 10,
      description: "Reflected XSS",
      fix: "escape output",
    });

    const result = JSON.parse(handleCompletePhase({ projectPath: dir }));
    expect(result.success).toBe(true);
  });
});

// ─── Security gate: block deployment with open findings ─────────────────────

describe("Security gate: setPhase(deployment) blocks on open CRITICAL/HIGH", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    const sm = initWithStateManager(dir, 1);
    // Move through phases to security
    sm.setPhase("planning");
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    addQualityAudit(sm);
    sm.setPhase("security");
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
  });

  it("throws when open CRITICAL finding exists", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F-crit",
      tool: "semgrep",
      severity: "critical",
      status: "open",
      title: "SQL Injection",
      file: "db.ts",
      line: 42,
      description: "unparameterized query",
      fix: "use params",
    });
    // Re-run SAST so it's not stale after adding finding
    sm.markFullSastRun(1);
    addReleaseAudit(sm);
    addPassingVerification(sm);

    expect(() => sm.setPhase("deployment")).toThrow("CRITICAL/HIGH");
  });

  it("throws when open HIGH finding exists", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F-high",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "XSS",
      file: "view.ts",
      line: 10,
      description: "reflected xss",
      fix: "escape",
    });
    // Re-run SAST so it's not stale after adding finding
    sm.markFullSastRun(1);
    addReleaseAudit(sm);
    addPassingVerification(sm);

    expect(() => sm.setPhase("deployment")).toThrow("CRITICAL/HIGH");
  });

  it("allows deployment when findings are fixed", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F-fixed",
      tool: "semgrep",
      severity: "critical",
      status: "fixed",
      title: "SQL Injection",
      file: "db.ts",
      line: 42,
      description: "was unparameterized",
      fix: "used params",
    });
    // Re-run full SAST after the change so it's not stale
    sm.markFullSastRun(0);
    addReleaseAudit(sm);
    addPassingVerification(sm);

    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });

  it("allows deployment with no findings", () => {
    const sm = new StateManager(dir);
    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });

  it("allows deployment when only MEDIUM/LOW findings are open", () => {
    const sm = new StateManager(dir);
    sm.addSASTFinding("s1", {
      id: "F-med",
      tool: "semgrep",
      severity: "medium",
      status: "open",
      title: "Info leak",
      file: "app.ts",
      line: 5,
      description: "verbose error",
      fix: "sanitize",
    });
    // Re-run full SAST after the change so it's not stale
    sm.markFullSastRun(1);
    addReleaseAudit(sm);
    addPassingVerification(sm);

    const state = sm.setPhase("deployment");
    expect(state.phase).toBe("deployment");
  });
});

// ─── update-slice: proper file persistence ──────────────────────────────────

describe("update-slice: file tracking persistence", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    initWithStateManager(dir, 1);
    forcePhase(dir, "building");
  });

  it("persists files across multiple updates", () => {
    const sm = new StateManager(dir);

    // Move through phases with files (with proper evidence)
    handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "red", files: ["test.ts"] });
    addPassingTests(sm, "s1");
    handleUpdateSlice({ projectPath: dir, sliceId: "s1", status: "green", files: ["src.ts", "test.ts"] });

    const state = sm.read();
    const s1 = state.slices.find((s) => s.id === "s1")!;
    expect(s1.files).toContain("test.ts");
    expect(s1.files).toContain("src.ts");
    expect(s1.files).toHaveLength(2); // deduplicated
  });
});

// ─── record-finding: ID collision + optional fix ────────────────────────────

describe("record-finding: hardening", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-hardening");
    initWithStateManager(dir, 1);
    forcePhase(dir, "building");
  });

  it("updates existing finding on same ID (upsert)", () => {
    const base = {
      projectPath: dir,
      sliceId: "s1",
      id: "F001",
      tool: "manual",
      severity: "high" as const,
      status: "open" as const,
      title: "Bug",
      file: "a.ts",
      line: 1,
      description: "desc",
    };

    const first = JSON.parse(handleRecordFinding(base));
    expect(first.success).toBe(true);

    const second = JSON.parse(handleRecordFinding({ ...base, status: "fixed", justification: "patched in commit abc" }));
    expect(second.success).toBe(true);
    expect(second.updated).toBe(true);

    // Verify state has updated status
    const sm = new StateManager(dir);
    const state = sm.read();
    const finding = state.slices[0].sastFindings.find((f: any) => f.id === "F001");
    expect(finding).toBeDefined();
    expect(finding!.status).toBe("fixed");
    expect(finding!.justification).toBe("patched in commit abc");
  });

  it("updates justification on same ID", () => {
    handleRecordFinding({
      projectPath: dir,
      sliceId: "s1",
      id: "F002",
      tool: "manual",
      severity: "medium",
      status: "open",
      title: "Weak hash",
      file: "b.ts",
      line: 10,
      description: "md5 usage",
    });

    const result = JSON.parse(handleRecordFinding({
      projectPath: dir,
      sliceId: "s1",
      id: "F002",
      tool: "manual",
      severity: "medium",
      status: "accepted",
      title: "Weak hash",
      file: "b.ts",
      line: 10,
      description: "md5 usage",
      justification: "non-security context, used for cache keys only",
    }));
    expect(result.success).toBe(true);
    expect(result.updated).toBe(true);
  });

  it("still rejects different ID with same fingerprint (dedup)", () => {
    handleRecordFinding({
      projectPath: dir,
      sliceId: "s1",
      id: "F003",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "SQLi",
      file: "c.ts",
      line: 5,
      description: "injection",
    });

    const dup = JSON.parse(handleRecordFinding({
      projectPath: dir,
      sliceId: "s1",
      id: "F003-alt",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "SQLi",
      file: "c.ts",
      line: 5,
      description: "injection",
    }));
    expect(dup.error).toContain("Duplicate finding");
  });

  it("rejects accepted status without justification", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-nojust-1",
        tool: "manual",
        severity: "high",
        status: "accepted",
        title: "SQL Injection",
        file: "a.ts",
        line: 1,
        description: "possible sqli",
      })
    );
    expect(result.error).toContain("justification");
  });

  it("rejects false_positive status without justification", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-nojust-2",
        tool: "manual",
        severity: "high",
        status: "false_positive",
        title: "SQL Injection",
        file: "a.ts",
        line: 1,
        description: "possible sqli",
      })
    );
    expect(result.error).toContain("justification");
  });

  it("rejects fixed status without justification", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-nojust-3",
        tool: "manual",
        severity: "high",
        status: "fixed",
        title: "SQL Injection",
        file: "a.ts",
        line: 1,
        description: "possible sqli",
      })
    );
    expect(result.error).toContain("justification");
  });

  it("rejects empty justification string", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-nojust-4",
        tool: "manual",
        severity: "high",
        status: "accepted",
        title: "SQL Injection",
        file: "a.ts",
        line: 1,
        description: "possible sqli",
        justification: "   ",
      })
    );
    expect(result.error).toContain("justification");
  });

  it("accepts non-open status with justification", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-just-1",
        tool: "manual",
        severity: "high",
        status: "accepted",
        title: "SQL Injection",
        file: "a.ts",
        line: 1,
        description: "possible sqli",
        justification: "Input is validated upstream via allowlist, not user-controlled",
      })
    );
    expect(result.success).toBe(true);
  });

  it("allows open status without justification", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-open-1",
        tool: "manual",
        severity: "high",
        status: "open",
        title: "XSS",
        file: "b.ts",
        line: 2,
        description: "possible xss",
      })
    );
    expect(result.success).toBe(true);
  });

  it("stores justification in finding when provided", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-with-just",
        tool: "manual",
        severity: "medium",
        status: "fixed",
        title: "Minor fix",
        file: "c.ts",
        line: 3,
        description: "fixed issue",
        justification: "Replaced raw SQL with parameterized query",
      })
    );
    expect(result.success).toBe(true);
    const sm = new StateManager(dir);
    const state = sm.read();
    const finding = state.slices.flatMap(s => s.sastFindings).find(f => f.id === "F-with-just");
    expect(finding?.justification).toBe("Replaced raw SQL with parameterized query");
  });

  it("get-state always returns restartRequired=false (restart detection removed)", () => {
    // restartRequired was removed because there's no reliable way to detect
    // whether a restart happened. The onboarding prompt handles the restart message.
    const onboardDir = makeTmpDir("a2p-restart");
    const onboardSm = new StateManager(onboardDir);
    onboardSm.init("test-restart", onboardDir);
    onboardSm.addCompanion({
      name: "codebase-memory-mcp",
      type: "codebase_memory",
      command: "codebase-memory-mcp",
      installed: true,
      config: {},
    });
    const result = JSON.parse(handleGetState({ projectPath: onboardDir }));
    expect(result.restartRequired).toBe(false);
  });

  it("get-state includes restartRequired=false when no companions configured", () => {
    const result = JSON.parse(handleGetState({ projectPath: dir }));
    expect(result.restartRequired).toBe(false);
  });

  it("companionsConfiguredAt is set when companion is added", () => {
    const sm = new StateManager(dir);
    const stateBefore = sm.read();
    // companionsConfiguredAt may already be set from initWithStateManager, check after fresh add
    sm.addCompanion({
      name: "test-mcp",
      type: "git",
      command: "test",
      installed: true,
      config: {},
    });
    expect(sm.read().companionsConfiguredAt).toBeTruthy();
  });

  it("get-state includes companionReadiness", () => {
    const sm = new StateManager(dir);
    sm.addCompanion({
      name: "codebase-memory-mcp",
      type: "codebase_memory",
      command: "codebase-memory-mcp",
      installed: true,
      config: {},
    });
    sm.addCompanion({
      name: "mcp-server-git",
      type: "git",
      command: "uvx mcp-server-git",
      installed: false,
      config: {},
    });
    const result = JSON.parse(handleGetState({ projectPath: dir }));
    expect(result.companionReadiness).toBeDefined();
    expect(result.companionReadiness.codebaseMemory).toBe(true);
    expect(result.companionReadiness.git).toBe(false);
    expect(result.companionReadiness.database).toBe(false);
  });

  it("accepts finding without fix field", () => {
    const result = JSON.parse(
      handleRecordFinding({
        projectPath: dir,
        sliceId: "s1",
        id: "F-nofix",
        tool: "manual",
        severity: "medium",
        status: "open",
        title: "Minor issue",
        file: "b.ts",
        line: 5,
        description: "something",
        // no fix field
      })
    );
    expect(result.success).toBe(true);
  });
});
