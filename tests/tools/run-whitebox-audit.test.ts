import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { useLegacySliceFlow, makeTmpDir, cleanTmpDir, parse, initWithFindings, initWithStateManager, forcePhase } from "../helpers/setup.js";
import { handleRunWhiteboxAudit, isBlockingWhiteboxFinding, checkFileForGuards, hasReachabilityEvidence, hasMutationPatterns, runIndependentProbes } from "../../src/tools/run-whitebox-audit.js";
import { StateManager } from "../../src/state/state-manager.js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WhiteboxFinding } from "../../src/state/types.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { cleanTmpDir(dir); });

useLegacySliceFlow();

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

describe("independent security probes", () => {
  it("probe finds hardcoded secret in slice file", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    // Create a file with a hardcoded password
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/config.ts"), `
      export const dbConfig = {
        host: "localhost",
        password = "admin123",
        port: 5432,
      };
    `);
    sm.updateSliceFiles(sliceId, ["src/config.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    const secretFinding = result.findings.find((f: any) =>
      f.category === "Secrets" || f.root_cause.toLowerCase().includes("password")
    );
    expect(secretFinding).toBeDefined();
  });

  it("probe finds API route without auth", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/routes.ts"), `
      import express from 'express';
      const app = express();
      app.post("/api/items", (req, res) => {
        const data = req.body;
        res.json({ created: true });
      });
    `);
    sm.updateSliceFiles(sliceId, ["src/routes.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    // Should find missing auth or missing validation
    expect(result.totalFindings).toBeGreaterThan(0);
  });

  it("probe finds missing input validation", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/handler.ts"), `
      export async function handler(request: Request) {
        const body = await request.json();
        db.save(body);
        return new Response("ok");
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/handler.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    const validationFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("input validation") ||
      f.root_cause.toLowerCase().includes("request body")
    );
    expect(validationFinding).toBeDefined();
  });

  it("no probes when SAST findings are present", () => {
    initWithFindings(dir, 2);
    forcePhase(dir, "security");
    const sm = new StateManager(dir);
    const sliceId = sm.read().slices[0].id;
    // Add a file with a hardcoded secret — probes should NOT fire since SAST has findings
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/secret.ts"), `const password = "hunter2";`);
    sm.updateSliceFiles(sliceId, ["src/handler1.ts", "src/handler2.ts", "src/secret.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    // Candidates should only be from SAST, not from probes
    expect(result.candidatesEvaluated).toBe(2);
  });

  it("no probes when no full SAST has run", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    // Do NOT call markFullSastRun — no full SAST
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/secret.ts"), `const password = "hunter2";`);
    sm.updateSliceFiles(sliceId, ["src/secret.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    // Should get the "no full SAST" warning, not probe results
    expect(result.warning).toBeDefined();
    expect(result.candidatesEvaluated).toBe(0);
  });

  it("probe finds SQL injection via string interpolation", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/db.ts"), `
      export function getUser(id: string) {
        return db.query(\`SELECT * FROM users WHERE id = \${id}\`);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/db.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const sqlFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("sql injection")
    );
    expect(sqlFinding).toBeDefined();
    expect(sqlFinding.severity).toBe("critical");
  });

  it("probe finds command injection via user input", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/runner.ts"), `
      import { exec } from 'child_process';
      export function run(req: any) {
        exec(req.body.cmd);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/runner.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const cmdFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("command injection")
    );
    expect(cmdFinding).toBeDefined();
    expect(cmdFinding.severity).toBe("critical");
  });

  it("SQL injection suppressed when parameterized query is used", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-db.ts"), `
      export function getUser(id: string) {
        return db.query(\`SELECT * FROM users WHERE id = \${id}\`, [$1]);
        // parameterized query
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-db.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const sqlFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("sql injection")
    );
    expect(sqlFinding).toBeUndefined();
  });

  it("probe finds SSRF via user-controlled URL", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/proxy.ts"), `
      export async function proxy(req: any) {
        const response = await fetch(req.body.url);
        return response.json();
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/proxy.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const ssrfFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("ssrf")
    );
    expect(ssrfFinding).toBeDefined();
    expect(ssrfFinding.severity).toBe("high");
  });

  it("probe finds mass assignment via unvalidated req.body", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/users.ts"), `
      export async function createUser(req: any) {
        const user = await User.create(req.body);
        return user;
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/users.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const massFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("mass assignment")
    );
    expect(massFinding).toBeDefined();
    expect(massFinding.severity).toBe("high");
  });

  it("probe finds insecure crypto (MD5)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/hash.ts"), `
      import { createHash } from 'crypto';
      export function hashToken(token: string) {
        return createHash('md5').update(token).digest('hex');
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/hash.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const cryptoFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("crypto") || f.root_cause.toLowerCase().includes("insecure")
    );
    expect(cryptoFinding).toBeDefined();
    expect(cryptoFinding.severity).toBe("high");
  });

  it("probe finding goes through guard analysis (not auto-confirmed)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    // File has a secret BUT also has auth guards and validation
    writeFileSync(join(dir, "src/guarded-config.ts"), `
      import { authenticate } from './auth';
      import { z } from 'zod';
      export const config = {
        apiKey = "test-key-123",
      };
      export function handler(req, res) {
        authenticate(req);
        const data = z.string().parse(req.body);
        res.json(data);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/guarded-config.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    // Finding should exist but NOT be confirmed exploitable (guards present)
    const finding = result.findings.find((f: any) =>
      f.affected_files.includes("src/guarded-config.ts")
    );
    if (finding) {
      expect(finding.confirmed_exploitable).toBe(false);
    }
  });
});

describe("auto-discovery fallback", () => {
  it("discovers source files when slice.files is empty", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    // Do NOT set slice files — leave them empty
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/secret-config.ts"), `
      export const config = {
        password = "admin123",
      };
    `);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    // Auto-discovery should find the file and probes should detect the secret
    expect(result.candidatesEvaluated).toBeGreaterThan(0);
    const secretFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("password")
    );
    expect(secretFinding).toBeDefined();
  });

  it("prefers slice.files over auto-discovery", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    // File tracked in slice
    writeFileSync(join(dir, "src/tracked.ts"), `
      export const config = {
        password = "tracked123",
      };
    `);
    // File NOT tracked in slice but exists on disk
    writeFileSync(join(dir, "src/untracked.ts"), `
      export const other = {
        password = "untracked456",
      };
    `);
    sm.updateSliceFiles(sliceId, ["src/tracked.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    // Should only find the tracked file's finding, not untracked
    const trackedFinding = result.findings.find((f: any) =>
      f.affected_files.includes("src/tracked.ts")
    );
    const untrackedFinding = result.findings.find((f: any) =>
      f.affected_files.includes("src/untracked.ts")
    );
    expect(trackedFinding).toBeDefined();
    expect(untrackedFinding).toBeUndefined();
  });
});

describe("adversarial review enforcement", () => {
  it("adversarialReviewRequired=true when 0 findings", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.totalFindings).toBe(0);
    expect(result.adversarialReviewRequired).toBe(true);
    expect(result.hint).toContain("adversarial");
  });

  it("adversarialReviewRequired=true when findings exist (non-blocking)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/leaky.ts"), `
      export const config = {
        password = "admin123",
      };
    `);
    sm.updateSliceFiles(sliceId, ["src/leaky.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.totalFindings).toBeGreaterThan(0);
    expect(result.adversarialReviewRequired).toBe(true);
    expect(result.hint).toContain("adversarial");
  });

  it("adversarialReviewRequired=true when blocking findings exist", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/vuln.ts"), `
      export function handler(req, res) {
        const result = db.query(req.body.sql);
        res.send(result);
      }
    `);
    sm.addSASTFinding(sliceId, {
      id: "BLK-001", tool: "semgrep", severity: "critical", status: "open",
      title: "SQL injection in auth handler", file: "src/vuln.ts", line: 3,
      description: "Raw SQL", fix: "Parameterize",
    });
    sm.updateSliceFiles(sliceId, ["src/vuln.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.adversarialReviewRequired).toBe(true);
    expect(result.hint).toContain("adversarial");
  });

  it("adversarialReviewInstructions always present in output", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.adversarialReviewInstructions).toContain("MANDATORY");
    expect(result.adversarialReviewInstructions).toContain("a2p_record_finding");
    expect(result.adversarialReviewInstructions).toContain("adversarial-review");
  });
});

describe("PRIO-1 probes (Block B)", () => {
  it("XSS probe: innerHTML with user input → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/render.ts"), `
      export function render(userInput: string) {
        document.getElementById("output").innerHTML = userInput;
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/render.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const xssFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("xss")
    );
    expect(xssFinding).toBeDefined();
    expect(xssFinding.severity).toBe("high");
  });

  it("XSS probe: innerHTML with DOMPurify → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-render.ts"), `
      import DOMPurify from 'dompurify';
      export function render(userInput: string) {
        document.getElementById("output").innerHTML = DOMPurify.sanitize(userInput);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-render.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const xssFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("xss")
    );
    expect(xssFinding).toBeUndefined();
  });

  it("Deserialization probe: pickle.loads → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/loader.py"), `
import pickle

def load_data(raw_bytes):
    return pickle.loads(raw_bytes)
    `);
    sm.updateSliceFiles(sliceId, ["src/loader.py"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const deserialFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("deserialization")
    );
    expect(deserialFinding).toBeDefined();
    expect(deserialFinding.severity).toBe("critical");
  });

  it("Deserialization probe: yaml.safe_load → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-loader.py"), `
import yaml

def load_config(path):
    with open(path) as f:
        return yaml.safe_load(f)
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-loader.py"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const deserialFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("deserialization")
    );
    expect(deserialFinding).toBeUndefined();
  });

  it("NoSQL probe: find with $where from req.body → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/search.ts"), `
      export function search(req: any) {
        return db.collection("users").find(req.body);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/search.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const nosqlFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("nosql")
    );
    expect(nosqlFinding).toBeDefined();
    expect(nosqlFinding.severity).toBe("high");
  });

  it("Cookie probe: res.cookie without flags → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/session.ts"), `
      export function login(req: any, res: any) {
        res.cookie("session", token);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/session.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const cookieFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("cookie")
    );
    expect(cookieFinding).toBeDefined();
    expect(cookieFinding.severity).toBe("medium");
  });

  it("Cookie probe: res.cookie with httpOnly + secure → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-session.ts"), `
      export function login(req: any, res: any) {
        res.cookie("session", token, { httpOnly: true, secure: true, sameSite: "strict" });
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-session.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const cookieFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("cookie")
    );
    expect(cookieFinding).toBeUndefined();
  });

  it("eval probe: eval with user input → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/calculator.ts"), `
      export function calculate(req: any) {
        return eval(req.body.expression);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/calculator.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const evalFinding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("eval") || f.root_cause.toLowerCase().includes("code execution")
    );
    expect(evalFinding).toBeDefined();
    expect(evalFinding.severity).toBe("critical");
  });
});

describe("Block 2-5 probes", () => {
  it("mass assignment with spread operator → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/spread.ts"), `
      export function create(req: any) {
        const user = { ...req.body, role: "user" };
        return db.save(user);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/spread.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("mass assignment")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("high");
  });

  it("mass assignment with Object.assign + validation → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-assign.ts"), `
      import { z } from 'zod';
      export function create(req: any) {
        const validated = z.object({ name: z.string() }).parse(req.body);
        const user = Object.assign({}, validated, req.body);
        return db.save(user);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-assign.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("mass assignment")
    );
    expect(finding).toBeUndefined();
  });

  it("migration with DROP TABLE → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "migrations"), { recursive: true });
    writeFileSync(join(dir, "migrations/001_drop.ts"), `
      export async function up(db: any) {
        await db.query("DROP TABLE users");
      }
    `);
    sm.updateSliceFiles(sliceId, ["migrations/001_drop.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("destructive migration")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("high");
  });

  it("migration with DROP TABLE + rollback → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "migrations"), { recursive: true });
    writeFileSync(join(dir, "migrations/002_safe_drop.ts"), `
      export async function up(db: any) {
        await db.query("DROP TABLE old_users");
      }
      export async function down(db: any) {
        await db.query("CREATE TABLE old_users (id INT)");
      }
    `);
    sm.updateSliceFiles(sliceId, ["migrations/002_safe_drop.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("destructive migration")
    );
    expect(finding).toBeUndefined();
  });

  it("CORS wildcard → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/cors.ts"), `
      import cors from 'cors';
      app.use(cors());
    `);
    sm.updateSliceFiles(sliceId, ["src/cors.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("cors")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("medium");
  });

  it("JWT sign without expiry → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/token.ts"), `
      import jwt from 'jsonwebtoken';
      export function createToken(userId: string) {
        return jwt.sign({ sub: userId }, SECRET);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/token.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("jwt")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("medium");
  });

  it("JWT sign with expiresIn → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-token.ts"), `
      import jwt from 'jsonwebtoken';
      export function createToken(userId: string) {
        return jwt.sign({ sub: userId }, SECRET, { expiresIn: '1h' });
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-token.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("jwt")
    );
    expect(finding).toBeUndefined();
  });

  it("file upload without limits → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/upload.ts"), `
      import multer from 'multer';
      const upload = multer({ dest: 'uploads/' });
      app.post('/upload', upload.single('file'), handler);
    `);
    sm.updateSliceFiles(sliceId, ["src/upload.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("file upload")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("medium");
  });

  it("file upload with limits → suppressed", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/safe-upload.ts"), `
      import multer from 'multer';
      const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });
      app.post('/upload', upload.single('file'), handler);
    `);
    sm.updateSliceFiles(sliceId, ["src/safe-upload.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("file upload")
    );
    expect(finding).toBeUndefined();
  });

  it("PII in console.log → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/debug.ts"), `
      export function loginUser(user: any) {
        console.log("Login attempt:", user.password);
        return authenticate(user);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/debug.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("logged to console") || f.root_cause.toLowerCase().includes("pii")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("high");
  });

  it("ORM raw query with interpolation → detected", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    const sliceId = sm.read().slices[0].id;
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/orm-raw.ts"), `
      export function search(req: any) {
        return knex.raw(\`SELECT * FROM users WHERE name = \${req.body.name}\`);
      }
    `);
    sm.updateSliceFiles(sliceId, ["src/orm-raw.ts"]);
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const finding = result.findings.find((f: any) =>
      f.root_cause.toLowerCase().includes("sql injection")
    );
    expect(finding).toBeDefined();
    expect(finding.severity).toBe("critical");
  });
});

// ============================================================================
// Whitebox suppression of resolved SAST findings
// ============================================================================

describe("whitebox suppression of resolved findings", () => {
  function setFindingStatus(tmpDir: string, sliceId: string, findingId: string, status: string): void {
    const statePath = join(tmpDir, ".a2p", "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf-8"));
    const slice = state.slices.find((s: any) => s.id === sliceId);
    const finding = slice.sastFindings.find((f: any) => f.id === findingId);
    finding.status = status;
    finding.justification = "Test justification";
    writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  it("false_positive SAST finding → whitebox candidate suppressed", () => {
    const sm = initWithFindings(dir);
    forcePhase(dir, "security");
    const state = sm.read();
    const sliceId = state.slices[0].id;
    const finding = state.slices[0].sastFindings[0];
    setFindingStatus(dir, sliceId, finding.id, "false_positive");
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const rootCauses = result.findings.map((f: any) => f.root_cause);
    expect(rootCauses).not.toContain(finding.title);
  });

  it("open SAST finding → still evaluated", () => {
    initWithFindings(dir);
    forcePhase(dir, "security");
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    expect(result.totalFindings).toBeGreaterThan(0);
  });

  it("fixed SAST finding → suppressed", () => {
    const sm = initWithFindings(dir);
    forcePhase(dir, "security");
    const state = sm.read();
    const sliceId = state.slices[0].id;
    const finding = state.slices[0].sastFindings[0];
    setFindingStatus(dir, sliceId, finding.id, "fixed");
    const result = parse(handleRunWhiteboxAudit({ projectPath: dir, mode: "full" }));
    const rootCauses = result.findings.map((f: any) => f.root_cause);
    expect(rootCauses).not.toContain(finding.title);
  });
});

describe("whitebox duplicate event prevention", () => {
  it("produces exactly 1 whitebox_audit event per run (no duplicates)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.markFullSastRun(0);
    handleRunWhiteboxAudit({ projectPath: dir, mode: "full" });

    const state = new StateManager(dir).read();
    const whiteboxEvents = state.buildHistory.filter((e: any) => e.action === "whitebox_audit");
    expect(whiteboxEvents.length).toBe(1);
    expect(whiteboxEvents[0].metadata).toBeDefined();
    expect(whiteboxEvents[0].metadata.toolName).toBe("whitebox");
  });
});
