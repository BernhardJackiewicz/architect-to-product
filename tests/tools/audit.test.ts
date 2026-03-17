import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleRunAudit } from "../../src/tools/run-audit.js";
import { makeTmpDir, cleanTmpDir, initWithStateManager, forcePhase, walkSliceToStatus, addQualityAudit } from "../helpers/setup.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir("a2p-audit"); });
afterEach(() => { cleanTmpDir(dir); });

describe("Audit: buildNote/testNote clarity", () => {
  it("no build/test commands configured → output contains buildNote and testNote", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");

    const result = JSON.parse(handleRunAudit({ projectPath: dir, mode: "release" }));
    expect(result.success).toBe(true);
    expect(result.buildPassed).toBeNull();
    expect(result.testsPassed).toBeNull();
    expect(result.buildNote).toBeDefined();
    expect(result.buildNote).toContain("No build command configured");
    expect(result.testNote).toBeDefined();
    expect(result.testNote).toContain("No test command configured");
  });

  it("build/test commands configured → no buildNote/testNote in output", () => {
    const sm = initWithStateManager(dir);
    sm.updateConfig({ buildCommand: "echo ok", testCommand: "echo ok" });
    forcePhase(dir, "security");

    const result = JSON.parse(handleRunAudit({
      projectPath: dir, mode: "release", runBuild: true, runTests: true,
    }));
    expect(result.success).toBe(true);
    // Commands are configured so they run (may pass or fail), but no "not configured" note
    expect(result.buildNote).toBeUndefined();
    expect(result.testNote).toBeUndefined();
  });

  it("runBuild=false, runTests=false → no buildNote/testNote (skipped by user choice)", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "security");

    const result = JSON.parse(handleRunAudit({
      projectPath: dir, mode: "release", runBuild: false, runTests: false,
    }));
    expect(result.success).toBe(true);
    // User explicitly skipped — no note needed
    expect(result.buildNote).toBeUndefined();
    expect(result.testNote).toBeUndefined();
  });
});
