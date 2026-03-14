import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../../src/state/state-manager.js";
import { handleRunAudit } from "../../src/tools/run-audit.js";
import { makeTmpDir, parse, initWithStateManager, walkSliceToStatus, forcePhase } from "../helpers/setup.js";
import type { AuditResult } from "../../src/state/types.js";

describe("a2p_run_audit", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-audit");
  });

  // 1. Returns error for non-existent project
  it("returns error for non-existent project", () => {
    const result = parse(handleRunAudit({ projectPath: "/nonexistent", mode: "quality", runBuild: false, runTests: false }));
    expect(result.error).toBeTruthy();
  });

  // 2. Quality: detects TODO in source files
  it("detects TODO comments as LOW findings", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/app.ts"), "// TODO: fix this later\nconst x = 1;\n");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    expect(result.success).toBe(true);
    const todoFindings = result.findings.filter((f: any) => f.category === "todo");
    expect(todoFindings.length).toBeGreaterThanOrEqual(1);
    expect(todoFindings[0].severity).toBe("low");
  });

  // 3. Quality: detects console.log
  it("detects console.log as MEDIUM finding", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/debug.ts"), "console.log('debug output');\n");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const debugFindings = result.findings.filter((f: any) => f.category === "debug_artifact");
    expect(debugFindings.length).toBeGreaterThanOrEqual(1);
    expect(debugFindings[0].severity).toBe("medium");
  });

  // 4. Quality: detects missing .gitignore entries
  it("detects missing .gitignore entries as MEDIUM", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    writeFileSync(join(dir, ".gitignore"), "# empty\n");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const gitignoreFindings = result.findings.filter((f: any) => f.category === "gitignore_missing_entry");
    expect(gitignoreFindings.length).toBeGreaterThanOrEqual(1);
    expect(gitignoreFindings[0].severity).toBe("medium");
  });

  // 5. Quality: detects committed .env
  it("detects committed .env as HIGH finding", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    writeFileSync(join(dir, ".env"), "SECRET=abc123\n");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const envFindings = result.findings.filter((f: any) => f.category === "env_committed");
    expect(envFindings).toHaveLength(1);
    expect(envFindings[0].severity).toBe("high");
  });

  // 6. Release: detects missing README
  it("detects missing README in release mode as HIGH", () => {
    initWithStateManager(dir);
    forcePhase(dir, "security");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "release", runBuild: false, runTests: false }));
    const readmeFindings = result.findings.filter((f: any) => f.category === "missing_readme");
    expect(readmeFindings).toHaveLength(1);
    expect(readmeFindings[0].severity).toBe("high");
  });

  // 7. Release: aggregates open SAST findings from state
  it("aggregates open SAST findings in release mode", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");
    sm.addSASTFinding("s1", {
      id: "SG-001",
      tool: "semgrep",
      severity: "high",
      status: "open",
      title: "SQL Injection",
      file: "app.ts",
      line: 10,
      description: "test",
      fix: "parameterize",
    });

    const result = parse(handleRunAudit({ projectPath: dir, mode: "release", runBuild: false, runTests: false }));
    const sastAgg = result.findings.filter((f: any) => f.category === "open_sast_findings");
    expect(sastAgg).toHaveLength(1);
    expect(sastAgg[0].severity).toBe("critical");
    expect(result.aggregated.openSastFindings).toBe(1);
  });

  // 8. Release: reports low test coverage ratio
  it("reports low test-to-source ratio", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    // Create 5 source files, 0 test files
    mkdirSync(join(dir, "src"), { recursive: true });
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(dir, `src/file${i}.ts`), `const x${i} = ${i};\n`);
    }

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const coverageFindings = result.findings.filter((f: any) => f.category === "low_test_coverage");
    expect(coverageFindings).toHaveLength(1);
    expect(coverageFindings[0].severity).toBe("medium");
  });

  // 9. Build/test: buildPassed/testsPassed correct when disabled
  it("reports null for build/test when disabled", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    expect(result.buildPassed).toBeNull();
    expect(result.testsPassed).toBeNull();
  });

  // 10. Skips build/test when no command configured
  it("skips build/test when no command configured", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: true, runTests: true }));
    // No build/test command configured → null
    expect(result.buildPassed).toBeNull();
    expect(result.testsPassed).toBeNull();
  });

  // 11. Records audit in state
  it("records audit result in state", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");

    handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false });

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.auditResults).toHaveLength(1);
    expect(state.auditResults[0].id).toBe("AUD-001");
    expect(state.auditResults[0].mode).toBe("quality");
    // Build event should be recorded
    const auditEvents = state.buildHistory.filter((e) => e.action === "audit_run");
    expect(auditEvents.length).toBeGreaterThanOrEqual(1);
  });

  // 12. Audit ID increments
  it("increments audit IDs", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");

    handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false });
    forcePhase(dir, "security");
    handleRunAudit({ projectPath: dir, mode: "release", runBuild: false, runTests: false });

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.auditResults).toHaveLength(2);
    expect(state.auditResults[0].id).toBe("AUD-001");
    expect(state.auditResults[1].id).toBe("AUD-002");
  });

  // 13. Does NOT flag console.error/console.warn as debug artifacts
  it("does not flag console.error or console.warn", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/handler.ts"), "console.error('fatal');\nconsole.warn('warning');\n");

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const debugFindings = result.findings.filter(
      (f: any) => f.category === "debug_artifact" && f.file === "src/handler.ts"
    );
    expect(debugFindings).toHaveLength(0);
  });

  // 14. Returns all findings (no truncation)
  it("returns all findings without truncation", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    mkdirSync(join(dir, "src"), { recursive: true });
    // Create file with 40 TODO lines
    const lines = Array.from({ length: 40 }, (_, i) => `// TODO: item ${i}`).join("\n");
    writeFileSync(join(dir, "src/many-todos.ts"), lines);

    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    const todoFindings = result.findings.filter((f: any) => f.category === "todo");
    expect(todoFindings.length).toBe(40);
    expect(result.totalFindings).toBeGreaterThanOrEqual(40);
  });

  // 15. Skips symlinks in file collection
  it("skips symlinks during file collection", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src/real.ts"), "const x = 1;\n");
    try {
      symlinkSync(join(dir, "src"), join(dir, "src-link"));
    } catch {
      // symlink may fail on some systems, skip test
      return;
    }

    // Should not crash from symlink loop and should not double-count
    const result = parse(handleRunAudit({ projectPath: dir, mode: "quality", runBuild: false, runTests: false }));
    expect(result.success).toBe(true);
  });
});

describe("Deployment gate: audit critical findings block deploy", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-audit-gate");
  });

  it("blocks deployment when last release audit has critical findings", () => {
    const sm = initWithStateManager(dir, 1);

    // Walk slice to done
    sm.setPhase("planning");
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");

    // Transition to security phase
    sm.setBuildSignoff();
    sm.setPhase("security");
    sm.markFullSastRun(0);

    // Add a release audit with critical findings
    const auditResult: AuditResult = {
      id: "AUD-001",
      mode: "release",
      timestamp: new Date().toISOString(),
      findings: [
        { category: "build_failure", severity: "critical", file: "project", line: 0, message: "Build failed", fix: "Fix" },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      buildPassed: false,
      testsPassed: null,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 1, slicesTotal: 1 },
    };
    sm.addAuditResult(auditResult);

    // Attempt to deploy — should be blocked
    expect(() => sm.setPhase("deployment")).toThrow("Cannot deploy: last release audit");
  });

  it("allows deployment when last release audit has no critical findings", () => {
    const sm = initWithStateManager(dir, 1);

    sm.setPhase("planning");
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    sm.setPhase("security");
    sm.markFullSastRun(0);

    // Add a clean release audit
    const auditResult: AuditResult = {
      id: "AUD-001",
      mode: "release",
      timestamp: new Date().toISOString(),
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      buildPassed: true,
      testsPassed: true,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 1, slicesTotal: 1 },
    };
    sm.addAuditResult(auditResult);

    // Should succeed
    expect(() => sm.setPhase("deployment")).not.toThrow();
  });

  it("ignores quality-mode audits for deployment gate", () => {
    const sm = initWithStateManager(dir, 1);

    sm.setPhase("planning");
    sm.setPhase("building");
    walkSliceToStatus(sm, "s1", "done");
    sm.setBuildSignoff();
    sm.setPhase("security");
    sm.markFullSastRun(0);

    // Add a quality audit with critical findings — should NOT block deployment
    const auditResult: AuditResult = {
      id: "AUD-001",
      mode: "quality",
      timestamp: new Date().toISOString(),
      findings: [
        { category: "build_failure", severity: "critical", file: "project", line: 0, message: "Build failed", fix: "Fix" },
      ],
      summary: { critical: 1, high: 0, medium: 0, low: 0 },
      buildPassed: false,
      testsPassed: null,
      aggregated: { openSastFindings: 0, openQualityIssues: 0, slicesDone: 1, slicesTotal: 1 },
    };
    sm.addAuditResult(auditResult);

    // Should succeed — quality audits don't block deployment
    expect(() => sm.setPhase("deployment")).not.toThrow();
  });
});
