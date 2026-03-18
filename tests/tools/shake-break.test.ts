import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, initWithStateManager, forcePhase, forceField, addPassingWhitebox, walkSliceToStatus } from "../helpers/setup.js";
import { handleShakeBreakSetup } from "../../src/tools/shake-break-setup.js";
import { handleShakeBreakTeardown } from "../../src/tools/shake-break-teardown.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { StateManager } from "../../src/state/state-manager.js";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

let dir: string;

/** Set up a project in security phase with adversarial review completed */
function setupForShakeBreak(sliceCount = 3): StateManager {
  const sm = initWithStateManager(dir, sliceCount);
  forcePhase(dir, "security");
  addPassingWhitebox(sm);
  return sm;
}

beforeEach(() => {
  dir = makeTmpDir();
  // Ensure dir is a git repo for worktree support
  try {
    execSync(`git -C "${dir}" rev-parse --git-dir`, { stdio: "pipe" });
  } catch {
    execSync(`git -C "${dir}" init && git -C "${dir}" add -A && git -C "${dir}" commit --allow-empty -m "init"`, { stdio: "pipe" });
  }
});

afterEach(() => {
  // Cleanup any leftover worktrees
  try {
    const state = new StateManager(dir);
    if (state.exists()) {
      const s = state.read();
      if (s.shakeBreakSession?.sandboxPath && existsSync(s.shakeBreakSession.sandboxPath)) {
        execSync(`git worktree remove --force "${s.shakeBreakSession.sandboxPath}"`, { stdio: "pipe" });
      }
    }
  } catch { /* best-effort */ }
  cleanTmpDir(dir);
});

describe("shake-break-setup", () => {
  it("rejects in wrong phase (building)", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(result.error).toContain("security");
  });

  it("rejects without adversarial review", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(result.error).toContain("adversarial review");
  });

  it("rejects with active session (force=false)", () => {
    const sm = setupForShakeBreak();
    // First setup succeeds
    const r1 = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(r1.userMustConfirm).toBe(true);

    // Second setup fails
    const r2 = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["business_logic"],
    }));
    expect(r2.error).toContain("session");
  });

  it("rejects stale session with hint for force=true", () => {
    const sm = setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    // Make session stale by manipulating startedAt
    const state = sm.read();
    state.shakeBreakSession!.startedAt = new Date(Date.now() - 20 * 60000).toISOString();
    state.shakeBreakSession!.timeoutMinutes = 15;
    forceField(dir, "shakeBreakSession", state.shakeBreakSession);

    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
      force: false,
    }));
    expect(result.error).toContain("force: true");
  });

  it("cleans up stale session with force=true", () => {
    const sm = setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    // Make session stale
    const state = sm.read();
    state.shakeBreakSession!.startedAt = new Date(Date.now() - 20 * 60000).toISOString();
    forceField(dir, "shakeBreakSession", state.shakeBreakSession);

    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["business_logic"],
      force: true,
    }));
    expect(result.userMustConfirm).toBe(true);
    expect(result.categories).toContain("business_logic");
  });

  it("returns terminalWarningAnsi and userMustConfirm", () => {
    setupForShakeBreak();
    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(result.terminalWarningAnsi).toContain("STOP");
    expect(result.terminalWarningAnsi).toContain("\x1b[31;1m");
    expect(result.userMustConfirm).toBe(true);
  });

  it("generates .env with neutralized services", () => {
    setupForShakeBreak();
    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(result.neutralizedServices).toBeDefined();
    expect(result.neutralizedServices.length).toBeGreaterThan(0);
    expect(result.neutralizedServices).toContain("SMTP/MAIL");
  });

  it("stores startingFindingIds in session", () => {
    const sm = setupForShakeBreak();

    // Add a pre-existing shake-break finding
    sm.addSASTFinding(null, {
      id: "SB-PRE-001",
      tool: "shake-break",
      severity: "medium",
      status: "open",
      title: "Pre-existing finding",
      file: "test.ts",
      line: 1,
      description: "old",
      fix: "",
    });

    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    const state = sm.read();
    expect(state.shakeBreakSession).not.toBeNull();
    expect(state.shakeBreakSession!.startingFindingIds).toContain("SB-PRE-001");
  });

  it("returns dbFallback=true when SQLite fallback used", { timeout: 15_000 }, () => {
    const sm = initWithStateManager(dir);
    // Set architecture with PostgreSQL
    sm.setArchitecture({
      name: "Test",
      description: "Test",
      techStack: { language: "TypeScript", framework: "Express", database: "PostgreSQL", frontend: null, hosting: null, other: [] },
      features: ["f1"],
      dataModel: "none",
      apiDesign: "REST",
      raw: "",
    });
    forcePhase(dir, "security");
    addPassingWhitebox(sm);

    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["race_conditions"],
    }));

    // Will be true if Docker is not available, false if Docker starts PostgreSQL
    if (result.dbFallback) {
      expect(result.dbFallbackWarning).toContain("race_conditions");
    } else {
      expect(result.dbType).toBe("postgres");
    }
  });

  it("allocates port in ephemeral range", () => {
    setupForShakeBreak();
    const result = parse(handleShakeBreakSetup({
      projectPath: dir,
      categories: ["auth_idor"],
    }));
    expect(result.port).toBeGreaterThanOrEqual(49152);
    expect(result.port).toBeLessThanOrEqual(65535);
  });
});

describe("shake-break-teardown", () => {
  it("rejects without active session", () => {
    initWithStateManager(dir);
    const result = parse(handleShakeBreakTeardown({
      projectPath: dir,
      categoriesTested: ["auth_idor"],
    }));
    expect(result.error).toContain("No active");
  });

  it("calculates findingsRecorded automatically", () => {
    const sm = setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    // Record a finding during the session
    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "SB-NEW-001",
      tool: "shake-break",
      severity: "high",
      status: "open",
      title: "IDOR found",
      file: "src/api.ts",
      line: 42,
      description: "DELETE /api/items/42 returns 200 with wrong user token",
      fix: "Add ownership check",
      confidence: "evidence-backed",
      evidence: "src/api.ts:42 — DELETE /api/items/:id without ownership check",
    });

    const result = parse(handleShakeBreakTeardown({
      projectPath: dir,
      categoriesTested: ["auth_idor"],
      note: "tested auth endpoints",
    }));

    expect(result.success).toBe(true);
    expect(result.result.findingsRecorded).toBe(1);
    expect(result.result.id).toBe("SB-001");
  });

  it("saves result in shakeBreakResults", () => {
    const sm = setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    handleShakeBreakTeardown({
      projectPath: dir,
      categoriesTested: ["auth_idor"],
      note: "test note",
    });

    const state = sm.read();
    expect(state.shakeBreakResults).toHaveLength(1);
    expect(state.shakeBreakResults[0].id).toBe("SB-001");
    expect(state.shakeBreakResults[0].note).toBe("test note");
  });

  it("clears shakeBreakSession after teardown", () => {
    const sm = setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    handleShakeBreakTeardown({
      projectPath: dir,
      categoriesTested: ["auth_idor"],
    });

    const state = sm.read();
    expect(state.shakeBreakSession).toBeNull();
  });

  it("counts only findings since setup (ignores pre-existing)", () => {
    const sm = setupForShakeBreak();

    // Add a pre-existing shake-break finding BEFORE setup
    sm.addSASTFinding(null, {
      id: "SB-OLD-001",
      tool: "shake-break",
      severity: "medium",
      status: "open",
      title: "Old finding",
      file: "test.ts",
      line: 1,
      description: "old",
      fix: "",
    });

    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    // Add a NEW finding during this session
    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "SB-NEW-002",
      tool: "shake-break",
      severity: "medium",
      status: "open",
      title: "New finding",
      file: "src/api.ts",
      line: 10,
      description: "new finding",
      fix: "",
    });

    const result = parse(handleShakeBreakTeardown({
      projectPath: dir,
      categoriesTested: ["auth_idor"],
    }));

    // Should only count the NEW finding, not the pre-existing one
    expect(result.result.findingsRecorded).toBe(1);
  });
});

describe("record_finding with tool=shake-break", () => {
  it("records finding with tool=shake-break successfully", () => {
    setupForShakeBreak();
    handleShakeBreakSetup({ projectPath: dir, categories: ["auth_idor"] });

    const result = parse(handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "SB-TEST-001",
      tool: "shake-break",
      severity: "high",
      status: "open",
      title: "IDOR on delete endpoint",
      file: "src/routes/items.ts",
      line: 55,
      description: "DELETE /api/items/42 with user_b_token returns 200 (expected 403)",
      fix: "Add ownership check",
    }));

    expect(result.success).toBe(true);
    expect(result.finding.id).toBe("SB-TEST-001");
  });
});
