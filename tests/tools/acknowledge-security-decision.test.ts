import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";
import { handleAcknowledgeSecurityDecision } from "../../src/tools/acknowledge-security-decision.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-ack-sec"); });
afterEach(() => { cleanTmpDir(dir); });

function setupWithPendingDecision(): StateManager {
  const sm = new StateManager(dir);
  sm.init("test-project", dir);
  sm.setArchitecture({
    name: "Test",
    description: "Test project",
    techStack: { language: "TypeScript", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
    features: ["CRUD"],
    dataModel: "none",
    apiDesign: "REST",
    raw: "",
  });
  sm.setSlices([{
    id: "s1", name: "Slice 1", description: "Test slice",
    acceptanceCriteria: ["works"], testStrategy: "unit",
    dependencies: [], status: "pending" as const,
    files: [], testResults: [], sastFindings: [],
  }]);
  forcePhase(dir, "security");
  sm.addWhiteboxResult({
    id: "WBA-1", mode: "full", timestamp: new Date().toISOString(),
    candidates_evaluated: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
  });
  sm.completeAdversarialReview(0, "test round");
  return sm;
}

describe("acknowledge security decision tool", () => {
  it("clears pending decision with action=continue", () => {
    setupWithPendingDecision();

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "continue",
    }));

    expect(result.success).toBe(true);
    expect(result.action).toBe("continue");
    expect(result.round).toBe(1);
    expect(result.userActionRequired).toContain("MANDATORY HARD STOP");

    // Decision should be cleared in state
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.pendingSecurityDecision).toBeNull();
  });

  it("clears pending decision with action=focused-hardening", () => {
    setupWithPendingDecision();

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "focused-hardening",
    }));

    expect(result.success).toBe(true);
    expect(result.action).toBe("focused-hardening");
    expect(result.description).toContain("focused hardening");
  });

  it("clears pending decision with action=full-round", () => {
    setupWithPendingDecision();

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "full-round",
    }));

    expect(result.success).toBe(true);
    expect(result.action).toBe("full-round");
  });

  it("clears pending decision with action=shake-break", () => {
    setupWithPendingDecision();

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "shake-break",
    }));

    expect(result.success).toBe(true);
    expect(result.action).toBe("shake-break");
  });

  it("errors when no pending decision exists", () => {
    const sm = new StateManager(dir);
    sm.init("test-project", dir);
    sm.setArchitecture({
      name: "Test", description: "Test",
      techStack: { language: "TypeScript", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
      features: ["CRUD"], dataModel: "none", apiDesign: "REST", raw: "",
    });
    forcePhase(dir, "security");

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "continue",
    }));

    expect(result.error).toContain("No pending security decision");
  });

  it("errors when not in security phase", () => {
    const sm = new StateManager(dir);
    sm.init("test-project", dir);

    const result = parse(handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "continue",
    }));

    expect(result.error).toBeDefined();
  });

  it("logs event when decision is acknowledged", () => {
    setupWithPendingDecision();

    handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "continue",
    });

    const sm = new StateManager(dir);
    const state = sm.read();
    const events = state.buildHistory.filter(e => e.action === "security_decision_acknowledged");
    expect(events.length).toBe(1);
    expect(events[0].details).toContain("continue");
    expect(events[0].details).toContain("round 1");
  });

  it("phase gate blocks security→deployment when decision is pending", () => {
    const sm = setupWithPendingDecision();
    // Set up other required gates so we hit the pendingSecurityDecision gate specifically
    sm.markFullSastRun(0);
    sm.addActiveVerificationResult({
      id: "AVR-1", timestamp: new Date().toISOString(), round: 1,
      tests_run: 1, tests_passed: 1, tests_failed: 0,
      findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 },
      blocking_count: 0, requires_human_review: false,
    }, { durationMs: 100, runId: "test" });

    expect(() => sm.setPhase("deployment")).toThrow(/[Ss]ecurity decision pending/);
  });

  it("phase gate allows security→deployment after decision is acknowledged", () => {
    setupWithPendingDecision();

    // Acknowledge
    handleAcknowledgeSecurityDecision({
      projectPath: dir,
      action: "continue",
    });

    // Now set up remaining gates for security→deployment
    const sm = new StateManager(dir);
    const state = sm.read();
    // Will still fail on other gates (SAST, release audit, etc.) — that's expected
    // We just verify the pendingSecurityDecision gate is no longer the blocker
    try {
      sm.setPhase("deployment");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Should NOT fail on security decision anymore
      expect(msg).not.toContain("Security decision pending");
    }
  });
});
