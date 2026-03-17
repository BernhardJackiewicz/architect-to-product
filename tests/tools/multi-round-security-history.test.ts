import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";
import { handleCompleteAdversarialReview } from "../../src/tools/complete-adversarial-review.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-multi-round"); });
afterEach(() => { cleanTmpDir(dir); });

/**
 * Set up a project in security phase with a rich tech stack
 * (Express, PostgreSQL, React) so multiple hardening areas are relevant.
 */
function setupRichProject(): StateManager {
  const sm = new StateManager(dir);
  sm.init("multi-round-test", dir);
  sm.setArchitecture({
    name: "RichApp",
    description: "Full-stack app with auth, payments, and file uploads",
    techStack: {
      language: "TypeScript",
      framework: "Express",
      database: "PostgreSQL",
      frontend: "React",
      hosting: null,
      other: [],
    },
    features: ["User login", "REST API", "CRUD operations", "order checkout", "file upload"],
    dataModel: "users, orders, items",
    apiDesign: "REST",
    raw: "",
  });
  sm.setSlices([{
    id: "s1",
    name: "Auth & Orders",
    description: "Authentication with login, session management, and order workflows",
    acceptanceCriteria: ["login works", "checkout completes"],
    testStrategy: "unit",
    dependencies: [],
    status: "pending" as const,
    files: [],
    testResults: [],
    sastFindings: [],
  }]);
  forcePhase(dir, "security");
  // Add whitebox result (required before adversarial review)
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

describe("multi-round security history accumulation", () => {
  it("3 rounds of adversarial review accumulate findings and coverage correctly", () => {
    const sm = setupRichProject();

    // ── Round 1: 2 findings in "auth-session" domain ──

    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "ADV-R1-001",
      tool: "adversarial-review",
      severity: "medium",
      status: "open",
      title: "Missing rate limit on login endpoint",
      file: "src/auth.ts",
      line: 10,
      description: "No rate limiting on /login",
      fix: "Add express-rate-limit middleware",
      confidence: "evidence-backed",
      evidence: "src/auth.ts:10 — no rate limit middleware in route chain",
      domains: ["auth-session"],
    });

    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "ADV-R1-002",
      tool: "adversarial-review",
      severity: "high",
      status: "open",
      title: "Session token not rotated after login",
      file: "src/session.ts",
      line: 25,
      description: "Session fixation vulnerability",
      fix: "Regenerate session ID after successful authentication",
      confidence: "evidence-backed",
      evidence: "src/session.ts:25 — session.id unchanged after req.login()",
      domains: ["auth-session"],
    });

    const r1Result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 2,
      note: "reviewed auth — 2 findings",
    }));

    // Verify round 1 state
    expect(r1Result.success).toBe(true);
    const stateAfterR1 = sm.read();
    expect(stateAfterR1.adversarialReviewState).not.toBeNull();
    expect(stateAfterR1.adversarialReviewState!.round).toBe(1);
    expect(stateAfterR1.adversarialReviewState!.totalFindingsRecorded).toBe(2);
    expect(stateAfterR1.adversarialReviewState!.roundHistory).toHaveLength(1);
    expect(stateAfterR1.securityOverview).not.toBeNull();
    expect(stateAfterR1.securityOverview!.coverageByArea).toHaveLength(8);
    // auth-session should have coverage > 0 (2 findings * 20 = 40%)
    const authCoverageR1 = stateAfterR1.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverageR1).toBeDefined();
    expect(authCoverageR1!.coverageEstimate).toBeGreaterThan(0);
    expect(stateAfterR1.pendingSecurityDecision).not.toBeNull();

    // Clear pending decision before next round
    sm.clearPendingSecurityDecision();

    // ── Round 2: 1 finding in "data-access" domain (focused round) ──

    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "ADV-R2-001",
      tool: "adversarial-review",
      severity: "medium",
      status: "open",
      title: "Missing ownership check on order query",
      file: "src/orders.ts",
      line: 44,
      description: "User can query other users orders via direct ID",
      fix: "Add WHERE user_id = $current_user to query",
      confidence: "evidence-backed",
      evidence: "src/orders.ts:44 — SELECT * FROM orders WHERE id = $1 (no user_id filter)",
      domains: ["data-access"],
    });

    const r2Result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 1,
      note: "focused on data-access — 1 finding",
      focusArea: "data-access",
    }));

    // Verify round 2 state
    expect(r2Result.success).toBe(true);
    const stateAfterR2 = sm.read();
    expect(stateAfterR2.adversarialReviewState!.round).toBe(2);
    expect(stateAfterR2.adversarialReviewState!.totalFindingsRecorded).toBe(3);
    expect(stateAfterR2.adversarialReviewState!.roundHistory).toHaveLength(2);
    expect(stateAfterR2.securityOverview).not.toBeNull();
    expect(stateAfterR2.securityOverview!.coverageByArea).toHaveLength(8);
    // data-access coverage should be > 0 after focused round
    const dataCoverageR2 = stateAfterR2.securityOverview!.coverageByArea.find(c => c.id === "data-access");
    expect(dataCoverageR2).toBeDefined();
    expect(dataCoverageR2!.coverageEstimate).toBeGreaterThan(0);
    expect(stateAfterR2.pendingSecurityDecision).not.toBeNull();

    // Clear pending decision before next round
    sm.clearPendingSecurityDecision();

    // ── Round 3: 1 finding in "business-logic" domain ──

    handleRecordFinding({
      projectPath: dir,
      sliceId: null,
      id: "ADV-R3-001",
      tool: "adversarial-review",
      severity: "high",
      status: "open",
      title: "Price manipulation via negative quantity",
      file: "src/checkout.ts",
      line: 88,
      description: "Negative item quantity allows negative total price",
      fix: "Validate quantity > 0 before computing total",
      confidence: "evidence-backed",
      evidence: "src/checkout.ts:88 — total = price * quantity (no min check)",
      domains: ["business-logic"],
    });

    const r3Result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 1,
      note: "reviewed business logic — 1 finding",
    }));

    // Verify round 3 state
    expect(r3Result.success).toBe(true);
    const stateAfterR3 = sm.read();
    expect(stateAfterR3.adversarialReviewState!.round).toBe(3);
    expect(stateAfterR3.adversarialReviewState!.totalFindingsRecorded).toBe(4);
    expect(stateAfterR3.adversarialReviewState!.roundHistory).toHaveLength(3);
    expect(stateAfterR3.securityOverview).not.toBeNull();
    expect(stateAfterR3.securityOverview!.coverageByArea).toHaveLength(8);
    // business-logic coverage should be > 0
    const bizCoverageR3 = stateAfterR3.securityOverview!.coverageByArea.find(c => c.id === "business-logic");
    expect(bizCoverageR3).toBeDefined();
    expect(bizCoverageR3!.coverageEstimate).toBeGreaterThan(0);
    expect(stateAfterR3.pendingSecurityDecision).not.toBeNull();
  });

  it("cumulative state after 3 rounds reflects all findings and coverage correctly", () => {
    setupRichProject();

    // Record round 1 findings (auth-session)
    handleRecordFinding({
      projectPath: dir, sliceId: null, id: "ADV-R1-001",
      tool: "adversarial-review", severity: "medium", status: "open",
      title: "Missing rate limit on login", file: "src/auth.ts", line: 10,
      description: "No rate limit", fix: "Add limiter",
      confidence: "evidence-backed", evidence: "src/auth.ts:10", domains: ["auth-session"],
    });
    handleRecordFinding({
      projectPath: dir, sliceId: null, id: "ADV-R1-002",
      tool: "adversarial-review", severity: "high", status: "open",
      title: "Session fixation", file: "src/session.ts", line: 25,
      description: "No rotation", fix: "Rotate session",
      confidence: "evidence-backed", evidence: "src/session.ts:25", domains: ["auth-session"],
    });
    handleCompleteAdversarialReview({ projectPath: dir, findingsRecorded: 2, note: "round 1" });
    const sm1 = new StateManager(dir);
    sm1.clearPendingSecurityDecision();

    // Record round 2 finding (data-access, focused)
    handleRecordFinding({
      projectPath: dir, sliceId: null, id: "ADV-R2-001",
      tool: "adversarial-review", severity: "medium", status: "open",
      title: "Missing ownership check", file: "src/orders.ts", line: 44,
      description: "IDOR on orders", fix: "Add user_id filter",
      confidence: "evidence-backed", evidence: "src/orders.ts:44", domains: ["data-access"],
    });
    handleCompleteAdversarialReview({ projectPath: dir, findingsRecorded: 1, note: "round 2", focusArea: "data-access" });
    const sm2 = new StateManager(dir);
    sm2.clearPendingSecurityDecision();

    // Record round 3 finding (business-logic)
    handleRecordFinding({
      projectPath: dir, sliceId: null, id: "ADV-R3-001",
      tool: "adversarial-review", severity: "high", status: "open",
      title: "Price manipulation", file: "src/checkout.ts", line: 88,
      description: "Negative qty", fix: "Validate qty > 0",
      confidence: "evidence-backed", evidence: "src/checkout.ts:88", domains: ["business-logic"],
    });
    const r3Output = parse(handleCompleteAdversarialReview({
      projectPath: dir, findingsRecorded: 1, note: "round 3",
    }));

    // ── Cumulative state verification ──
    const sm = new StateManager(dir);
    const state = sm.read();

    // totalSecurityRounds === 3
    expect(state.securityOverview!.totalSecurityRounds).toBe(3);

    // areasExplicitlyHardened includes "data-access" (from focused round 2)
    expect(state.securityOverview!.areasExplicitlyHardened).toContain("data-access");

    // Coverage: auth-session = 2 findings * 20 = 40%
    const authCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "auth-session");
    expect(authCoverage!.coverageEstimate).toBe(40);

    // Coverage: data-access = 1 finding * 20 + 40 (focus bonus) = 60%
    const dataCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "data-access");
    expect(dataCoverage!.coverageEstimate).toBe(60);

    // Coverage: business-logic = 1 finding * 20 = 20%
    const bizCoverage = state.securityOverview!.coverageByArea.find(c => c.id === "business-logic");
    expect(bizCoverage!.coverageEstimate).toBe(20);

    // Output structure verification
    expect(r3Output.securityMessage).toBeDefined();
    expect(r3Output.securityMessage).toContain("never ending story");
    expect(r3Output.requiresUserChoice).toBe(true);
    expect(r3Output.nextActions).toHaveLength(4);

    // Recommendations should NOT include areas with 100% coverage
    for (const rec of r3Output.recommendations) {
      expect(rec.coverageEstimate).toBeLessThan(100);
    }

    // roundHistory in output contains all 3 rounds
    expect(r3Output.roundHistory).toHaveLength(3);
    expect(r3Output.roundHistory[0].findingsRecorded).toBe(2);
    expect(r3Output.roundHistory[1].findingsRecorded).toBe(1);
    expect(r3Output.roundHistory[2].findingsRecorded).toBe(1);
  });

  it("clearPendingSecurityDecision sets pendingSecurityDecision to null", () => {
    const sm = setupRichProject();

    handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 0,
      note: "quick scan",
    });

    // Verify it was set
    const stateBeforeClear = sm.read();
    expect(stateBeforeClear.pendingSecurityDecision).not.toBeNull();

    // Clear it
    sm.clearPendingSecurityDecision();

    // Verify it is now null
    const stateAfterClear = sm.read();
    expect(stateAfterClear.pendingSecurityDecision).toBeNull();
  });
});
