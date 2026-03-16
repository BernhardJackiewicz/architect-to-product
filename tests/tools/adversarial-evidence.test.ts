import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, initWithStateManager, forcePhase } from "../helpers/setup.js";
import { handleRecordFinding } from "../../src/tools/record-finding.js";
import { handleCompleteAdversarialReview } from "../../src/tools/complete-adversarial-review.js";
import { StateManager } from "../../src/state/state-manager.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-adv-evidence"); });
afterEach(() => { cleanTmpDir(dir); });

function baseFinding(overrides: Record<string, unknown> = {}) {
  return {
    projectPath: dir,
    sliceId: null,
    id: `ADV-${Date.now()}`,
    tool: "adversarial-review",
    severity: "high" as const,
    status: "open" as const,
    title: "Missing ownership check",
    file: "src/api/users.ts",
    line: 42,
    description: "DELETE /users/:id without ownership check",
    fix: "Add WHERE user_id = current_user.id",
    confidence: "evidence-backed" as const,
    evidence: "src/api/users.ts:42 — no ownership check on DELETE",
    ...overrides,
  };
}

describe("adversarial evidence gate", () => {
  it("rejects adversarial high without confidence", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      confidence: undefined,
      evidence: "src/api/users.ts:42 — no check",
    })));
    expect(result.error).toContain("confidence");
  });

  it("rejects adversarial critical without evidence", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      severity: "critical",
      confidence: "evidence-backed",
      evidence: undefined,
    })));
    expect(result.error).toContain("evidence");
  });

  it("rejects adversarial high with evidence missing file:line", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      confidence: "evidence-backed",
      evidence: "I think there might be a problem here",
    })));
    expect(result.error).toContain("file:line");
  });

  it("auto-downgrades adversarial high hypothesis to medium", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      id: "ADV-hypo-001",
      confidence: "hypothesis",
      evidence: "src/api/users.ts:42 — suspected missing check",
    })));
    expect(result.success).toBe(true);
    expect(result.finding.severity).toBe("medium");
    expect(result.finding.autoDowngraded).toBe(true);
    expect(result.finding.originalSeverity).toBe("high");
  });

  it("accepts adversarial medium without confidence (optional for medium/low)", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      id: "ADV-med-001",
      severity: "medium",
      confidence: undefined,
      evidence: undefined,
    })));
    expect(result.success).toBe(true);
    expect(result.finding.severity).toBe("medium");
  });

  it("accepts adversarial high with evidence-backed and valid evidence", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      id: "ADV-ok-001",
      confidence: "evidence-backed",
      evidence: "src/api/users.ts:42 — no ownership check on DELETE",
    })));
    expect(result.success).toBe(true);
    expect(result.finding.severity).toBe("high");
    expect(result.finding.autoDowngraded).toBeUndefined();
  });

  it("accepts adversarial critical with hard-to-verify and valid evidence", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      id: "ADV-htv-001",
      severity: "critical",
      confidence: "hard-to-verify",
      evidence: "src/payments.ts:15 — race condition on concurrent charge requests",
    })));
    expect(result.success).toBe(true);
    expect(result.finding.severity).toBe("critical");
  });

  it("accepts semgrep critical without confidence (gate only for adversarial-review)", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");
    const result = parse(handleRecordFinding(baseFinding({
      id: "SEM-001",
      tool: "semgrep",
      severity: "critical",
      confidence: undefined,
      evidence: undefined,
    })));
    expect(result.success).toBe(true);
    expect(result.finding.severity).toBe("critical");
  });
});

describe("confidence stats in complete-adversarial-review", () => {
  it("includes confidenceStats in output", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    // Add whitebox result first (required for adversarial review)
    sm.addWhiteboxResult({
      id: "WBA-001", mode: "full", timestamp: new Date().toISOString(),
      candidates_evaluated: 0, findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0,
    });

    // Record a finding with confidence
    handleRecordFinding(baseFinding({
      id: "ADV-stats-001",
      confidence: "evidence-backed",
      evidence: "src/api/users.ts:42 — no ownership check",
    }));

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 1,
      note: "test round",
    }));

    expect(result.success).toBe(true);
    expect(result.confidenceStats).toBeDefined();
    expect(result.confidenceStats.evidenceBacked).toBe(1);
    expect(result.confidenceStats.hypothesis).toBe(0);
    expect(result.confidenceStats.hardToVerify).toBe(0);
  });

  it("previousFindings include confidence field", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.addWhiteboxResult({
      id: "WBA-001", mode: "full", timestamp: new Date().toISOString(),
      candidates_evaluated: 0, findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 }, blocking_count: 0,
    });

    handleRecordFinding(baseFinding({
      id: "ADV-prev-001",
      confidence: "hard-to-verify",
      evidence: "src/auth.ts:10 — timing window during token refresh",
    }));

    const result = parse(handleCompleteAdversarialReview({
      projectPath: dir,
      findingsRecorded: 1,
      note: "test round",
    }));

    expect(result.previousFindings).toBeDefined();
    expect(result.previousFindings.length).toBeGreaterThan(0);
    expect(result.previousFindings[0].confidence).toBe("hard-to-verify");
  });
});
