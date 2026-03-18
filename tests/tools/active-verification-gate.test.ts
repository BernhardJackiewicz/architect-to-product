import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-av-gate"); });
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
  // This sets pendingSecurityDecision
  sm.completeAdversarialReview(0, "test round");
  return sm;
}

describe("active verification security decision gate", () => {
  it("blocks when pendingSecurityDecision is set and no code provided", () => {
    setupWithPendingDecision();

    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
    }));

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("pending_security_decision");
    expect(result.pendingDecision).toBeDefined();
    expect(result.pendingDecision.round).toBe(1);
    expect(result.securityMessage).toContain("never ending story");
    expect(result.userActionRequired).toContain("STOP");
    // confirmationCode must NOT be in pendingDecision (prevents agent auto-bypass)
    expect(result.pendingDecision.confirmationCode).toBeUndefined();
  });

  it("blocks when wrong confirmation code provided", () => {
    setupWithPendingDecision();

    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      acknowledgeSecurityDecision: "wrong-code",
    }));

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("pending_security_decision");
  });

  it("blocks when string 'true' is provided instead of confirmation code", () => {
    setupWithPendingDecision();

    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      acknowledgeSecurityDecision: "true",
    }));

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("pending_security_decision");
  });

  it("proceeds when correct confirmation code is provided and clears pending decision", () => {
    const sm = setupWithPendingDecision();
    const state = sm.read();
    const code = state.pendingSecurityDecision!.confirmationCode;

    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
      acknowledgeSecurityDecision: code,
    }));

    // Should not be blocked
    expect(result.blocked).toBeUndefined();
    expect(result.success).toBe(true);

    // Pending decision should be cleared
    const freshSm = new StateManager(dir);
    const freshState = freshSm.read();
    expect(freshState.pendingSecurityDecision).toBeNull();
  });

  it("runs normally when no pending security decision exists", () => {
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

    const result = parse(handleRunActiveVerification({
      projectPath: dir,
      round: 1,
    }));

    // No blocking
    expect(result.blocked).toBeUndefined();
    expect(result.success).toBe(true);
  });
});
