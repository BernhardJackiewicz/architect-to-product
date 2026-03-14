import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, parse, initWithArch } from "../helpers/setup.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { StateManager } from "../../src/state/state-manager.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ENGINEERING_LOOP } from "../../src/prompts/shared.js";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import { SECURITY_GATE_PROMPT } from "../../src/prompts/security-gate.js";
import { ONBOARDING_PROMPT } from "../../src/prompts/onboarding.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { cleanTmpDir(dir); });

describe("Documentation-first principle", () => {
  it("engineering loop includes documentation-first rule", () => {
    expect(ENGINEERING_LOOP).toContain("Documentation first");
    expect(ENGINEERING_LOOP).toContain("WebSearch");
    expect(ENGINEERING_LOOP).toContain("WebFetch");
    expect(ENGINEERING_LOOP).toContain("NIEMALS");
    expect(ENGINEERING_LOOP).toContain("halluzinieren");
  });

  it("build-slice prompt has mandatory doc-reading section", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Dokumentation LESEN, nicht raten");
    expect(BUILD_SLICE_PROMPT).toContain("PFLICHT");
    expect(BUILD_SLICE_PROMPT).toContain("WebSearch");
    expect(BUILD_SLICE_PROMPT).toContain("WebFetch");
    // Must mention concrete examples of when to read docs
    expect(BUILD_SLICE_PROMPT).toContain("Auth-Lösung");
    expect(BUILD_SLICE_PROMPT).toContain("Unbekannte DB/ORM");
    expect(BUILD_SLICE_PROMPT).toContain("Unbekannte API");
  });

  it("build-slice prompt requires doc reading before code", () => {
    // Doc section must come before TDD cycle
    const docPos = BUILD_SLICE_PROMPT.indexOf("Dokumentation LESEN");
    const tddPos = BUILD_SLICE_PROMPT.indexOf("TDD-Zyklus");
    expect(docPos).toBeGreaterThan(-1);
    expect(tddPos).toBeGreaterThan(-1);
    expect(docPos).toBeLessThan(tddPos);
  });

  it("build-slice prompt says to document URL in code", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Doku-URL als Kommentar");
  });

  it("security-gate prompt requires doc reading for unfamiliar security patterns", () => {
    expect(SECURITY_GATE_PROMPT).toContain("Dokumentation LESEN");
    expect(SECURITY_GATE_PROMPT).toContain("WebSearch");
    expect(SECURITY_GATE_PROMPT).toContain("WebFetch");
    // Must mention auth-specific examples
    expect(SECURITY_GATE_PROMPT).toContain("Clerk");
    expect(SECURITY_GATE_PROMPT).toContain("Lucia");
  });

  it("CLAUDE.md template includes documentation-first rule", () => {
    handleInitProject({ projectPath: dir, projectName: "test" });
    const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("Documentation first");
    expect(claudeMd).toContain("NEVER hallucinate");
    expect(claudeMd).toContain("WebSearch");
    expect(claudeMd).toContain("WebFetch");
  });

  it("doc-first rule is in engineering loop (shared across all prompts)", () => {
    // Verify the rule is in the shared loop, which means every prompt gets it
    const rule = ENGINEERING_LOOP.match(/Documentation first.*$/m);
    expect(rule).not.toBeNull();
  });
});

describe("Claude model preference", () => {
  it("default claudeModel is opus", () => {
    handleInitProject({ projectPath: dir, projectName: "test" });
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.config.claudeModel).toBe("opus");
  });

  it("claudeModel can be set via set_architecture", () => {
    initWithArch(dir);
    const result = parse(handleSetArchitecture({
      projectPath: dir,
      name: "Test",
      description: "Test",
      language: "TypeScript",
      framework: "Express",
      features: ["CRUD"],
      dataModel: "items",
      apiDesign: "REST",
      claudeModel: "sonnet",
    }));
    expect(result.success).toBe(true);
    expect(result.architecture.claudeModel).toBe("sonnet");

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.config.claudeModel).toBe("sonnet");
  });

  it("claudeModel defaults to opus when not specified", () => {
    initWithArch(dir);
    const result = parse(handleSetArchitecture({
      projectPath: dir,
      name: "Test",
      description: "Test",
      language: "TypeScript",
      framework: "Express",
      features: ["CRUD"],
      dataModel: "items",
      apiDesign: "REST",
    }));
    expect(result.architecture.claudeModel).toBe("opus");
  });

  it("claudeModel accepts all valid values", () => {
    for (const model of ["opus", "sonnet", "haiku"] as const) {
      const tmpDir = makeTmpDir();
      try {
        initWithArch(tmpDir);
        const result = parse(handleSetArchitecture({
          projectPath: tmpDir,
          name: "Test",
          description: "Test",
          language: "TypeScript",
          framework: "Express",
          features: ["CRUD"],
          dataModel: "items",
          apiDesign: "REST",
          claudeModel: model,
        }));
        expect(result.architecture.claudeModel).toBe(model);
        const sm = new StateManager(tmpDir);
        expect(sm.read().config.claudeModel).toBe(model);
      } finally {
        cleanTmpDir(tmpDir);
      }
    }
  });

  it("claudeModel persists across state read/write", () => {
    handleInitProject({ projectPath: dir, projectName: "test" });
    const sm = new StateManager(dir);
    sm.updateConfig({ claudeModel: "haiku" });
    const state = sm.read();
    expect(state.config.claudeModel).toBe("haiku");
    // Read again to confirm persistence
    const state2 = sm.read();
    expect(state2.config.claudeModel).toBe("haiku");
  });

  it("build-slice prompt references model preference", () => {
    expect(BUILD_SLICE_PROMPT).toContain("claudeModel");
    expect(BUILD_SLICE_PROMPT).toContain("config.claudeModel");
  });

  it("onboarding prompt mentions model configuration", () => {
    expect(ONBOARDING_PROMPT).toContain("claudeModel");
    expect(ONBOARDING_PROMPT).toContain("opus");
    expect(ONBOARDING_PROMPT).toContain("sonnet");
    expect(ONBOARDING_PROMPT).toContain("haiku");
  });

  it("CLAUDE.md template includes model preference reference", () => {
    handleInitProject({ projectPath: dir, projectName: "test" });
    const claudeMd = readFileSync(join(dir, "CLAUDE.md"), "utf-8");
    expect(claudeMd).toContain("config.claudeModel");
    expect(claudeMd).toContain("Model preference");
  });
});
