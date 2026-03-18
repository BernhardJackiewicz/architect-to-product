import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, initWithStateManager, forcePhase, forceField } from "../helpers/setup.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { handleCompleteAdversarialReview } from "../../src/tools/complete-adversarial-review.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-adv-output"); });
afterEach(() => { cleanTmpDir(dir); });

/** Set up a project in security phase with whitebox done, ready for adversarial review. */
function setupSecurityPhase(opts?: { database?: string; features?: string[] }): StateManager {
  const sm = new StateManager(dir);
  sm.init("test-project", dir);
  sm.setArchitecture({
    name: "Test",
    description: "Test project with auth and DB",
    techStack: {
      language: "TypeScript",
      framework: "Express",
      database: opts?.database ?? "PostgreSQL",
      frontend: "React",
      hosting: null,
      other: [],
    },
    features: opts?.features ?? ["User login", "REST API", "CRUD operations"],
    dataModel: "users, items",
    apiDesign: "REST",
    raw: "",
  });
  sm.setSlices([{
    id: "s1",
    name: "Auth",
    description: "Authentication with login and session",
    acceptanceCriteria: ["login works"],
    testStrategy: "unit",
    dependencies: [],
    status: "pending" as const,
    files: [],
    testResults: [],
    sastFindings: [],
  }]);
  forcePhase(dir, "security");
  // Add whitebox result so adversarial review can complete
  sm.addWhiteboxResult({
    id: "WBA-1",
    mode: "full",
    timestamp: new Date().toISOString(),
    candidates_evaluated: 0,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
  });
  return sm;
}

describe("adversarial review structured output", () => {
  it("round with relevant areas sets requiresUserChoice=true and 4 nextActions", () => {
    setupSecurityPhase();

    // Record a finding to make the round non-trivial
    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "ADV-001",
      tool: "adversarial-review",
      severity: "medium",
      status: "open",
      title: "Missing rate limit on login",
      file: "src/auth.ts",
      line: 10,
      description: "No rate limiting",
      fix: "Add rate limiter",
      confidence: "evidence-backed",
      evidence: "src/auth.ts:10 — no rate limit middleware",
      domains: ["auth-session"],
    });

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 1,
      note: "reviewed auth — 1 finding",
    }));

    expect(result.success).toBe(true);
    expect(result.requiresUserChoice).toBe(true);
    expect(result.nextActions).toHaveLength(4);
    expect(result.nextActions.map((a: { id: string }) => a.id)).toEqual([
      "focused-hardening",
      "full-round",
      "shake-break",
      "continue",
    ]);
    expect(result.recommendedAreas.length).toBeGreaterThan(0);
  });

  it("all areas at 100% coverage still sets requiresUserChoice=true with 4 actions", () => {
    // Minimal project: no DB, no frontend, no auth features
    // Only vuln-chaining is always relevant
    const sm = new StateManager(dir);
    sm.init("minimal-project", dir);
    sm.setArchitecture({
      name: "Minimal",
      description: "Minimal CLI tool",
      techStack: { language: "TypeScript", framework: "none", database: null, frontend: null, hosting: null, other: [] },
      features: ["CLI tool"],
      dataModel: "none",
      apiDesign: "none",
      raw: "",
    });
    sm.setSlices([{
      id: "s1", name: "CLI", description: "CLI command",
      acceptanceCriteria: ["runs"], testStrategy: "unit",
      dependencies: [], status: "pending" as const,
      files: [], testResults: [], sastFindings: [],
    }]);
    forcePhase(dir, "security");
    sm.addWhiteboxResult({
      id: "WBA-1", mode: "full", timestamp: new Date().toISOString(),
      candidates_evaluated: 0, findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 },
      blocking_count: 0,
    });

    // Record 5 findings with vuln-chaining domain → 5*20 = 100% coverage
    for (let i = 0; i < 5; i++) {
      handleRecordFinding({
        projectPath: dir, sliceId: null,
        id: `ADV-VC-${i}`, tool: "adversarial-review",
        severity: "low", status: "open",
        title: `Vuln chain finding ${i}`, file: "src/cli.ts", line: 10 + i,
        description: `Chain finding ${i}`, fix: "Review",
        confidence: "evidence-backed",
        evidence: `src/cli.ts:${10 + i} — chain path`,
        domains: ["vuln-chaining"],
      });
    }

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 5,
      note: "all areas covered",
    }));

    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    // Always true now — security is a never ending story
    expect(result.requiresUserChoice).toBe(true);
    expect(result.nextActions).toHaveLength(4);
    expect(result.nextActions.map((a: { id: string }) => a.id)).toEqual([
      "focused-hardening", "full-round", "shake-break", "continue",
    ]);
    expect(result.recommendedAreas).toEqual([]);
  });

  it("recommendedAreas sorted by lowest coverage first", () => {
    setupSecurityPhase({ features: ["User login", "REST API", "CRUD operations", "file upload", "webhooks"] });

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "initial scan",
    }));

    expect(result.success).toBe(true);
    // All recommended areas should start at 0 coverage (no findings, no focus)
    // so they're all equal — just verify they exist and have coverage numbers
    for (const area of result.recommendedAreas) {
      expect(area).toHaveProperty("id");
      expect(area).toHaveProperty("name");
      expect(area).toHaveProperty("coverageEstimate");
      expect(typeof area.coverageEstimate).toBe("number");
    }

    // Verify sorted: each coverage <= next coverage
    for (let i = 1; i < result.recommendedAreas.length; i++) {
      expect(result.recommendedAreas[i].coverageEstimate)
        .toBeGreaterThanOrEqual(result.recommendedAreas[i - 1].coverageEstimate);
    }
  });

  it("pendingSecurityDecision is set in state after completeAdversarialReview (no confirmationCode)", () => {
    setupSecurityPhase();

    handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "round 1",
    });

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.pendingSecurityDecision).not.toBeNull();
    expect(state.pendingSecurityDecision!.round).toBe(1);
    expect(state.pendingSecurityDecision!.availableActions).toEqual([
      "focused-hardening", "full-round", "shake-break", "continue",
    ]);
    expect(state.pendingSecurityDecision!.setAt).toBeTruthy();
    // confirmationCode no longer exists
    expect((state.pendingSecurityDecision as any).confirmationCode).toBeUndefined();
  });

  it("userActionRequired contains MANDATORY HARD STOP language", () => {
    setupSecurityPhase();

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "round 1",
    }));

    expect(result.userActionRequired).toBeDefined();
    expect(result.userActionRequired).toContain("MANDATORY HARD STOP");
    expect(result.userActionRequired).toContain("NOT disableable");
    expect(result.userActionRequired).toContain("NOT negotiable");
  });

  it("securityMessage is always present in output", () => {
    setupSecurityPhase();

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "round 1",
    }));

    expect(result.securityMessage).toBeDefined();
    expect(result.securityMessage).toContain("never ending story");
    expect(result.securityMessage).toContain("Round 1 complete");
  });

  it("nextActions always contains continue", () => {
    setupSecurityPhase();

    // With recommendations (relevant areas exist due to DB + API)
    const withRecs = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "round 1",
    }));
    const continueAction = withRecs.nextActions.find((a: { id: string }) => a.id === "continue");
    expect(continueAction).toBeDefined();
    expect(continueAction.label).toContain("Active Verification");
  });
});
