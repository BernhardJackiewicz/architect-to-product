import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../../src/state/state-manager.js";
import {
  buildRelevanceContext,
  computeHardeningRecommendations,
  computeCoverageEstimate,
  handleCompleteAdversarialReview,
} from "../../src/tools/complete-adversarial-review.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import type { ProjectState, SASTFinding, HardeningAreaId, Architecture, WhiteboxFinding } from "../../src/state/types.js";

function makeWhiteboxFinding(overrides: Partial<WhiteboxFinding> & { id: string; category: WhiteboxFinding["category"]; severity: WhiteboxFinding["severity"] }): WhiteboxFinding {
  return {
    confirmed_exploitable: false,
    evidence_type: "code_verified",
    enforcement_type: "code",
    runtime_path_reachable: false,
    state_change_provable: false,
    boundary_actually_bypassed: false,
    root_cause: "test",
    affected_files: ["test.ts"],
    minimal_fix: "fix",
    required_regression_tests: ["test"],
    blocking: false,
    ...overrides,
  };
}

let dir: string;

function makeDir(): string {
  const d = join(tmpdir(), `a2p-guided-hardening-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function initProject(d: string): StateManager {
  const sm = new StateManager(d);
  sm.init("test-project", d);
  return sm;
}

function setArchitecture(sm: StateManager, overrides: Partial<Architecture> = {}): void {
  sm.setArchitecture({
    name: "TestApp",
    description: "A test application",
    techStack: {
      language: "TypeScript",
      framework: "Express",
      database: "PostgreSQL",
      frontend: "React",
      hosting: "Hetzner",
      other: [],
    },
    features: ["User authentication with JWT", "REST API endpoints", "Payment processing with Stripe"],
    dataModel: "Users, Orders, Products",
    apiDesign: "REST",
    raw: "test",
    ...overrides,
  });
}

/** Force the project to a specific phase by directly writing state */
function forcePhase(d: string, phase: string): void {
  const statePath = join(d, ".a2p", "state.json");
  const raw = JSON.parse(require("node:fs").readFileSync(statePath, "utf-8"));
  raw.phase = phase;
  writeFileSync(statePath, JSON.stringify(raw, null, 2));
}

/** Add a minimal whitebox result so adversarial review can complete */
function addWhitebox(sm: StateManager): void {
  sm.addWhiteboxResult({
    id: "WBA-001",
    mode: "full",
    timestamp: new Date().toISOString(),
    candidates_evaluated: 1,
    findings: [],
    summary: { critical: 0, high: 0, medium: 0, low: 0 },
    blocking_count: 0,
  });
}

/** Walk a slice through red→green→refactor→sast→done */
function walkSliceToDone(sm: StateManager, sliceId: string): void {
  sm.setSliceStatus(sliceId, "red");
  sm.addTestResult(sliceId, {
    timestamp: new Date().toISOString(), command: "npm test",
    exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "ok",
  });
  sm.setSliceStatus(sliceId, "green");
  sm.setSliceStatus(sliceId, "refactor");
  sm.markSastRun(sliceId);
  sm.setSliceStatus(sliceId, "sast");
  sm.addTestResult(sliceId, {
    timestamp: new Date().toISOString(), command: "npm test",
    exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "ok",
  });
  sm.setSliceStatus(sliceId, "done");
}

function setupSecurityPhase(d: string): StateManager {
  const sm = initProject(d);
  setArchitecture(sm);
  sm.setSlices([{
    id: "s1", name: "Slice 1", description: "Auth endpoint",
    acceptanceCriteria: ["Login works"], testStrategy: "unit",
    dependencies: [], status: "pending", files: [], testResults: [],
    sastFindings: [],
  }]);
  sm.setPhase("planning");
  sm.setPhase("building");
  walkSliceToDone(sm, "s1");
  sm.setBuildSignoff();
  sm.addAuditResult({
    id: "AUD-001", mode: "quality", timestamp: new Date().toISOString(),
    findings: [], summary: { critical: 0, high: 0, medium: 0, low: 0 },
    buildPassed: true, testsPassed: true,
    aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 1, slicesTotal: 1 },
  });
  sm.setPhase("security");
  sm.markFullSastRun(0);
  addWhitebox(sm);
  return sm;
}

beforeEach(() => { dir = makeDir(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

// --- buildRelevanceContext ---

describe("buildRelevanceContext", () => {
  it("detects auth from features", () => {
    const sm = initProject(dir);
    setArchitecture(sm, { features: ["User login with JWT", "Dashboard"] });
    const state = sm.read();
    const ctx = buildRelevanceContext(state);
    expect(ctx.hasAuth).toBe(true);
    expect(ctx.hasPayments).toBe(false);
  });

  it("detects payments from slice descriptions", () => {
    const sm = initProject(dir);
    setArchitecture(sm, { features: ["Product catalog"] });
    sm.setSlices([{
      id: "s1", name: "Checkout", description: "Stripe payment integration",
      acceptanceCriteria: ["Can pay with credit card"], testStrategy: "e2e",
      dependencies: [], status: "pending", files: [], testResults: [], sastFindings: [],
    }]);
    const state = sm.read();
    const ctx = buildRelevanceContext(state);
    expect(ctx.hasPayments).toBe(true);
  });

  it("detects upload and webhooks", () => {
    const sm = initProject(dir);
    setArchitecture(sm, { features: ["File upload for avatars", "Stripe webhook handling"] });
    const state = sm.read();
    const ctx = buildRelevanceContext(state);
    expect(ctx.hasUpload).toBe(true);
    expect(ctx.hasWebhooks).toBe(true);
  });

  it("returns empty context without architecture", () => {
    const sm = initProject(dir);
    const state = sm.read();
    const ctx = buildRelevanceContext(state);
    expect(ctx.hasAuth).toBe(false);
    expect(ctx.hasPayments).toBe(false);
    expect(ctx.techStack.language).toBe("");
  });
});

// --- computeHardeningRecommendations ---

describe("computeHardeningRecommendations", () => {
  it("SQL app recommends data-access, not external-integration without webhooks", () => {
    const sm = initProject(dir);
    setArchitecture(sm, {
      features: ["User auth", "CRUD API"],
      techStack: {
        language: "TypeScript", framework: "Express",
        database: "PostgreSQL", frontend: null, hosting: null, other: [],
      },
    });
    const state = sm.read();
    const recs = computeHardeningRecommendations(state);
    const ids = recs.map(r => r.id);
    expect(ids).toContain("data-access");
    expect(ids).not.toContain("external-integration");
  });

  it("frontend app recommends input-output", () => {
    const sm = initProject(dir);
    setArchitecture(sm, {
      features: ["Dashboard"],
      techStack: {
        language: "TypeScript", framework: "Next.js",
        database: null, frontend: "React", hosting: null, other: [],
      },
    });
    const state = sm.read();
    const recs = computeHardeningRecommendations(state);
    const ids = recs.map(r => r.id);
    expect(ids).toContain("input-output");
  });

  it("returns empty with no architecture", () => {
    const sm = initProject(dir);
    const state = sm.read();
    const recs = computeHardeningRecommendations(state);
    expect(recs).toHaveLength(0);
  });

  it("vuln-chaining is always recommended", () => {
    const sm = initProject(dir);
    setArchitecture(sm, { features: ["Simple static site"] });
    const state = sm.read();
    const recs = computeHardeningRecommendations(state);
    const ids = recs.map(r => r.id);
    expect(ids).toContain("vuln-chaining");
  });
});

// --- Coverage computation ---

describe("computeCoverageEstimate", () => {
  it("returns 0 for area with no findings and no focus", () => {
    const coverage = computeCoverageEstimate("auth-session", [], []);
    expect(coverage).toBe(0);
  });

  it("findings increase coverage by 20 each", () => {
    const findings: SASTFinding[] = [
      { id: "f1", tool: "manual", severity: "medium", status: "open", title: "T", file: "f", line: 1, description: "", fix: "", domains: ["auth-session"] },
      { id: "f2", tool: "manual", severity: "medium", status: "open", title: "T2", file: "f", line: 2, description: "", fix: "", domains: ["auth-session"] },
    ];
    const coverage = computeCoverageEstimate("auth-session", findings, []);
    expect(coverage).toBe(40);
  });

  it("focus area adds 40% bonus", () => {
    const coverage = computeCoverageEstimate("auth-session", [], ["auth-session"]);
    expect(coverage).toBe(40);
  });

  it("caps at 100", () => {
    const findings: SASTFinding[] = Array.from({ length: 10 }, (_, i) => ({
      id: `f${i}`, tool: "manual", severity: "medium" as const, status: "open" as const,
      title: `T${i}`, file: "f", line: i, description: "", fix: "", domains: ["auth-session" as const],
    }));
    const coverage = computeCoverageEstimate("auth-session", findings, ["auth-session"]);
    expect(coverage).toBe(100);
  });

  it("ignores findings without matching domain", () => {
    const findings: SASTFinding[] = [
      { id: "f1", tool: "manual", severity: "medium", status: "open", title: "T", file: "f", line: 1, description: "", fix: "", domains: ["data-access"] },
    ];
    const coverage = computeCoverageEstimate("auth-session", findings, []);
    expect(coverage).toBe(0);
  });
});

// --- focusArea round-trip ---

describe("focusArea round-trip", () => {
  it("focusArea is stored in roundHistory and affects coverage", () => {
    const sm = setupSecurityPhase(dir);

    // Complete round 1 with focusArea
    sm.completeAdversarialReview(0, "focused on auth", "auth-session");
    const state = sm.read();

    expect(state.adversarialReviewState!.roundHistory[0].focusArea).toBe("auth-session");
    expect(state.securityOverview).not.toBeNull();
    expect(state.securityOverview!.areasExplicitlyHardened).toContain("auth-session");

    // Coverage should be 40 (focus bonus)
    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.coverageEstimate).toBe(40);
  });

  it("next recommendation skips already-covered areas", () => {
    const sm = setupSecurityPhase(dir);

    // Add 5 findings for auth-session to push coverage to 100 via findings alone
    for (let i = 0; i < 5; i++) {
      sm.addSASTFinding(null, {
        id: `auth-f${i}`, tool: "adversarial-review", severity: "medium", status: "open",
        title: `Auth issue ${i}`, file: "src/auth.ts", line: i + 1, description: "", fix: "",
        domains: ["auth-session"],
      });
    }

    sm.completeAdversarialReview(5, "r1", "auth-session");
    const state = sm.read();

    // auth-session should be at 100% (5 findings * 20 = 100, capped)
    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.coverageEstimate).toBe(100);

    // Recommendations should not include auth-session
    expect(state.securityOverview!.recommendedNextAreas).not.toContain("auth-session");
  });
});

// --- domains round-trip ---

describe("domains round-trip", () => {
  it("record-finding with domains stores them on the finding", () => {
    const sm = setupSecurityPhase(dir);

    const result = JSON.parse(handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "DOM-001",
      tool: "adversarial-review",
      severity: "medium",
      status: "open",
      title: "Test finding with domains",
      file: "src/test.ts",
      line: 1,
      description: "Test",
      domains: ["auth-session", "api-surface"],
    }));

    expect(result.success).toBe(true);

    const state = sm.read();
    const finding = state.projectFindings.find(f => f.id === "DOM-001");
    expect(finding).toBeDefined();
    expect(finding!.domains).toEqual(["auth-session", "api-surface"]);
  });

  it("domains affect coverage computation", () => {
    const sm = setupSecurityPhase(dir);

    sm.addSASTFinding(null, {
      id: "cov-1", tool: "adversarial-review", severity: "high", status: "open",
      title: "Data leak", file: "src/db.ts", line: 5, description: "", fix: "",
      domains: ["data-access"],
    });

    sm.completeAdversarialReview(1, "r1");
    const state = sm.read();

    const dataCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "data-access");
    expect(dataCoverage!.coverageEstimate).toBe(20); // 1 finding * 20
    expect(dataCoverage!.findingCount).toBe(1);
  });
});

// --- Hint format ---

describe("hint format", () => {
  it("contains recommendations and 3 modes when gaps exist", () => {
    const sm = setupSecurityPhase(dir);
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "r1",
    }));

    expect(result.hint).toContain("Recommended hardening areas");
    expect(result.hint).toContain("Options");
    expect(result.hint).toContain("focused hardening");
    expect(result.hint).toContain("full round");
    expect(result.hint).toContain("shake-break");
  });

  it("shows securityOverview and recommendations in output", () => {
    const sm = setupSecurityPhase(dir);
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "r1",
    }));

    expect(result.securityOverview).toBeDefined();
    expect(result.securityOverview.totalSecurityRounds).toBe(1);
    expect(result.recommendations).toBeInstanceOf(Array);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it("focusArea is included in output when provided", () => {
    const sm = setupSecurityPhase(dir);
    const result = JSON.parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 0, note: "focused", focusArea: "auth-session",
    }));

    expect(result.focusArea).toBe("auth-session");
  });
});

// --- Whitebox findings → coverage integration ---

describe("whitebox findings contribute to coverage", () => {
  it("whitebox AuthAuthz findings increase auth-session coverage", () => {
    const sm = setupSecurityPhase(dir);

    // Add whitebox result with AuthAuthz findings
    sm.addWhiteboxResult({
      id: "WBA-002",
      mode: "full",
      timestamp: new Date().toISOString(),
      candidates_evaluated: 3,
      findings: [
        makeWhiteboxFinding({ id: "WB-001", category: "AuthAuthz", severity: "high" }),
        makeWhiteboxFinding({ id: "WB-002", category: "AuthAuthz", severity: "medium" }),
      ],
      summary: { critical: 0, high: 1, medium: 1, low: 0 },
      blocking_count: 0,
    });

    sm.completeAdversarialReview(0, "r1");
    const state = sm.read();

    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.findingCount).toBe(2);
    expect(authCoverage!.coverageEstimate).toBe(40); // 2 * 20
  });

  it("whitebox StateRecoverySafety maps to both business-logic and data-access", () => {
    const sm = setupSecurityPhase(dir);

    sm.addWhiteboxResult({
      id: "WBA-003",
      mode: "full",
      timestamp: new Date().toISOString(),
      candidates_evaluated: 1,
      findings: [
        makeWhiteboxFinding({ id: "WB-010", category: "StateRecoverySafety", severity: "medium" }),
      ],
      summary: { critical: 0, high: 0, medium: 1, low: 0 },
      blocking_count: 0,
    });

    sm.completeAdversarialReview(0, "r1");
    const state = sm.read();

    const bizCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "business-logic");
    const dataCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "data-access");
    expect(bizCoverage!.findingCount).toBe(1);
    expect(dataCoverage!.findingCount).toBe(1);
  });

  it("whitebox result with 0 findings does not crash and adds 0 coverage", () => {
    const sm = setupSecurityPhase(dir);
    // setupSecurityPhase already adds WBA-001 with 0 findings
    sm.completeAdversarialReview(0, "r1");
    const state = sm.read();

    // All areas should have 0 findingCount (no SAST findings either)
    for (const area of state.securityOverview!.coverageByArea) {
      expect(area.findingCount).toBe(0);
    }
  });

  it("recommendations use persisted coverage including whitebox findings", () => {
    const sm = setupSecurityPhase(dir);

    // Add 5 AuthAuthz whitebox findings → auth-session should reach 100%
    sm.addWhiteboxResult({
      id: "WBA-004",
      mode: "full",
      timestamp: new Date().toISOString(),
      candidates_evaluated: 5,
      findings: Array.from({ length: 5 }, (_, i) =>
        makeWhiteboxFinding({ id: `WB-${i + 20}`, category: "AuthAuthz", severity: "high" }),
      ),
      summary: { critical: 0, high: 5, medium: 0, low: 0 },
      blocking_count: 0,
    });

    sm.completeAdversarialReview(0, "r1");
    const state = sm.read();

    // auth-session should be at 100% (5 * 20 = 100)
    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.coverageEstimate).toBe(100);

    // Recommendations should not include auth-session
    const recs = computeHardeningRecommendations(state);
    expect(recs.map(r => r.id)).not.toContain("auth-session");
  });
});

// --- Backward compatibility ---

describe("backward compatibility", () => {
  it("old findings without domains have coverage 0", () => {
    const findings: SASTFinding[] = [
      { id: "old-1", tool: "manual", severity: "high", status: "open", title: "Old finding", file: "f.ts", line: 1, description: "", fix: "" },
    ];
    const coverage = computeCoverageEstimate("auth-session", findings, []);
    expect(coverage).toBe(0);
  });

  it("mixed state: some findings with domains, some without", () => {
    const findings: SASTFinding[] = [
      { id: "old-1", tool: "manual", severity: "high", status: "open", title: "Old", file: "f.ts", line: 1, description: "", fix: "" },
      { id: "new-1", tool: "manual", severity: "high", status: "open", title: "New", file: "f.ts", line: 2, description: "", fix: "", domains: ["auth-session"] },
    ];
    const coverage = computeCoverageEstimate("auth-session", findings, []);
    expect(coverage).toBe(20); // only new-1 counts
  });

  it("old state without securityOverview loads as null", () => {
    const sm = initProject(dir);
    const state = sm.read();
    expect(state.securityOverview).toBeNull();
  });

  it("old AdversarialReviewRound without focusArea works", () => {
    const sm = setupSecurityPhase(dir);
    sm.completeAdversarialReview(0, "no focus");
    const state = sm.read();
    const round = state.adversarialReviewState!.roundHistory[0];
    expect(round.focusArea).toBeUndefined();
    expect(state.securityOverview).not.toBeNull();
  });

  it("refreshSecurityOverview with mixed old+new findings computes partial coverage", () => {
    const sm = setupSecurityPhase(dir);

    // Add old finding without domains
    sm.addSASTFinding(null, {
      id: "old-1", tool: "manual", severity: "high", status: "open",
      title: "Old", file: "f.ts", line: 1, description: "", fix: "",
    });

    // Add new finding with domains
    sm.addSASTFinding(null, {
      id: "new-1", tool: "manual", severity: "high", status: "open",
      title: "New", file: "f.ts", line: 2, description: "", fix: "",
      domains: ["data-access"],
    });

    sm.completeAdversarialReview(2, "mixed");
    const state = sm.read();

    const dataCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "data-access");
    expect(dataCoverage!.coverageEstimate).toBe(20);
    expect(dataCoverage!.findingCount).toBe(1);

    // auth-session has 0 coverage (no findings with that domain)
    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.coverageEstimate).toBe(0);
  });
});
