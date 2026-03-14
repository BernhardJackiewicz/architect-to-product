import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, initWithFindings, initWithStateManager, forcePhase } from "../helpers/setup.js";
import { handleRunWhiteboxAudit, isBlockingWhiteboxFinding, checkFileForGuards, hasReachabilityEvidence, hasMutationPatterns } from "../../src/tools/run-whitebox-audit.js";
import { StateManager } from "../../src/state/state-manager.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WhiteboxFinding } from "../../src/state/types.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { cleanTmpDir(dir); });

describe("run-whitebox-audit", () => {
  it("returns error for non-existent project", () => {
    const result = parse(handleRunWhiteboxAudit({ projectPath: "/nonexistent", mode: "full" }));
    expect(result.error).toBeDefined();
  });

  it("returns empty findings when no candidates", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.success).toBe(true);
    expect(result.totalFindings).toBe(0);
    expect(result.findings).toHaveLength(0);
  });

  it("evaluates SAST findings to WhiteboxFindings", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.success).toBe(true);
    expect(result.totalFindings).toBeGreaterThan(0);
    expect(result.findings[0]).toHaveProperty("confirmed_exploitable");
    expect(result.findings[0]).toHaveProperty("evidence_type");
    expect(result.findings[0]).toHaveProperty("enforcement_type");
  });

  it("incremental filters to specified files", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunWhiteboxAudit({
      projectPath: dir,
      mode: "incremental",
      files: ["handler1.ts"],
    }));
    expect(result.success).toBe(true);
    // Should only have findings for handler1.ts
    for (const f of result.findings) {
      expect(f.affected_files.some((af: string) => af.includes("handler1"))).toBe(true);
    }
  });

  it("full evaluates all candidates", () => {
    initWithFindings(dir, 3);
    forcePhase(dir, "security");
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.candidatesEvaluated).toBe(3);
  });

  it("classifies categories correctly", () => {
    const sm = initWithFindings(dir, 0);
    forcePhase(dir, "security");
    const sliceId = sm.read().slices[0].id;
    sm.addSASTFinding(sliceId, {
      id: "AUTH-001",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "Missing auth check on admin route",
      file: "src/auth.ts",
      line: 10,
      description: "No auth",
      fix: "Add auth",
    });
    sm.updateSliceFiles(sliceId, ["src/auth.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const authFinding = result.findings.find((f: any) => f.affected_files.includes("src/auth.ts"));
    expect(authFinding?.category).toBe("AuthAuthz");
  });

  it("confirmed_exploitable=false when guards are present", () => {
    const sm = initWithFindings(dir, 0);
    forcePhase(dir, "security");
    const sliceId = sm.read().slices[0].id;
    // Create a file WITH guards
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/guarded.ts"), `
      import { authenticate } from './auth';
      export function handler(req, res) {
        authenticate(req);
        const data = z.string().parse(req.body.input);
        res.json({ data });
      }
    `);
    sm.addSASTFinding(sliceId, {
      id: "G-001", tool: "semgrep", severity: "high", status: "open",
      title: "Input handling", file: "src/guarded.ts", line: 5,
      description: "Input", fix: "Validate",
    });
    sm.updateSliceFiles(sliceId, ["src/guarded.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) => f.affected_files.includes("src/guarded.ts"));
    expect(finding?.confirmed_exploitable).toBe(false);
  });

  it("confirmed_exploitable=true when no guards and reachable", () => {
    const sm = initWithFindings(dir, 0);
    forcePhase(dir, "security");
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/unguarded.ts"), `
      export function handler(req, res) {
        const result = db.query(req.body.sql);
        res.send(result);
      }
    `);
    sm.addSASTFinding(sliceId, {
      id: "U-001", tool: "semgrep", severity: "critical", status: "open",
      title: "SQL injection", file: "src/unguarded.ts", line: 3,
      description: "Raw SQL", fix: "Parameterize",
    });
    sm.updateSliceFiles(sliceId, ["src/unguarded.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) => f.affected_files.includes("src/unguarded.ts"));
    expect(finding?.confirmed_exploitable).toBe(true);
    expect(finding?.runtime_path_reachable).toBe(true);
  });

  it("enforcement_type=prompt-only when no code guard", () => {
    const sm = initWithFindings(dir, 0);
    forcePhase(dir, "security");
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/noguard.ts"), `
      // This handler has no validation
      export function process(input: string) {
        return input;
      }
    `);
    sm.addSASTFinding(sliceId, {
      id: "NG-001", tool: "semgrep", severity: "medium", status: "open",
      title: "Unvalidated input", file: "src/noguard.ts", line: 3,
      description: "No validation", fix: "Add validation",
    });
    sm.updateSliceFiles(sliceId, ["src/noguard.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) => f.affected_files.includes("src/noguard.ts"));
    expect(finding?.enforcement_type).toBe("prompt-only");
  });

  it("blocking=true for confirmed exploitable Auth findings", () => {
    const finding: WhiteboxFinding = {
      id: "WB-001",
      category: "AuthAuthz",
      severity: "critical",
      confirmed_exploitable: true,
      evidence_type: "code_verified",
      enforcement_type: "code",
      runtime_path_reachable: true,
      state_change_provable: true,
      boundary_actually_bypassed: true,
      root_cause: "test",
      affected_files: [],
      minimal_fix: "test",
      required_regression_tests: [],
      blocking: false,
    };
    expect(isBlockingWhiteboxFinding(finding)).toBe(true);
  });

  it("blocking=false for non-exploitable findings", () => {
    const finding: WhiteboxFinding = {
      id: "WB-002",
      category: "AuthAuthz",
      severity: "high",
      confirmed_exploitable: false,
      evidence_type: "speculative",
      enforcement_type: "code",
      runtime_path_reachable: false,
      state_change_provable: false,
      boundary_actually_bypassed: false,
      root_cause: "test",
      affected_files: [],
      minimal_fix: "test",
      required_regression_tests: [],
      blocking: false,
    };
    expect(isBlockingWhiteboxFinding(finding)).toBe(false);
  });

  it("stores WhiteboxAuditResult in state", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    handleRunWhiteboxAudit({ projectPath: dir, mode: "full" });
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.whiteboxResults).toHaveLength(1);
    expect(state.whiteboxResults[0].id).toBe("WBA-001");
  });

  it("increments IDs (WBA-001, WBA-002)", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    handleRunWhiteboxAudit({ projectPath: dir, mode: "full" });
    handleRunWhiteboxAudit({ projectPath: dir, mode: "full" });
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.whiteboxResults).toHaveLength(2);
    expect(state.whiteboxResults[0].id).toBe("WBA-001");
    expect(state.whiteboxResults[1].id).toBe("WBA-002");
  });

  it("records build event in history", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    handleRunWhiteboxAudit({ projectPath: dir, mode: "full" });
    const sm = new StateManager(dir);
    const state = sm.read();
    const events = state.buildHistory.filter((e) => e.action === "whitebox_audit");
    expect(events.length).toBeGreaterThan(0);
  });

  it("speculative finding does NOT block", () => {
    const finding: WhiteboxFinding = {
      id: "WB-003",
      category: "Secrets",
      severity: "high",
      confirmed_exploitable: false,
      evidence_type: "speculative",
      enforcement_type: "prompt-only",
      runtime_path_reachable: false,
      state_change_provable: true,
      boundary_actually_bypassed: true,
      root_cause: "test",
      affected_files: [],
      minimal_fix: "test",
      required_regression_tests: [],
      blocking: false,
    };
    expect(isBlockingWhiteboxFinding(finding)).toBe(false);
  });
});
