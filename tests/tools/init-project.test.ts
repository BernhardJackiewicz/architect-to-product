import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handleInitProject } from "../../src/tools/init-project.js";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";

describe("handleInitProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-init");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("creates all 6 required files", () => {
    const result = parse(handleInitProject({ projectPath: tmpDir, projectName: "test-app" }));

    expect(result.success).toBe(true);
    expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
    expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
    expect(existsSync(join(tmpDir, ".claude", "agents", "test-writer.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".claude", "agents", "security-reviewer.md"))).toBe(true);
    expect(existsSync(join(tmpDir, ".a2p", "state.json"))).toBe(true);
  });

  it("CLAUDE.md contains project name in at least 2 places", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "my-project" });
    const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    const matches = content.match(/my-project/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it(".gitignore contains standard patterns", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = readFileSync(join(tmpDir, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules");
    expect(content).toContain(".env");
    expect(content).toContain("__pycache__");
    expect(content).toContain(".a2p/state.json.bak");
  });

  it("settings.json is valid JSON", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("CLAUDE.md contains A2P v2.0.2 Exploration preference section referencing codebase-memory", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    // The section must exist so that every agent (including built-in
    // Claude Code subagents like Explore) sees the codebase-memory
    // preference — regression guard for v2.0.2 Finding/Explore-bypass.
    expect(content).toContain("Exploration preference");
    expect(content).toMatch(/mcp__codebase-memory__search_graph/);
    expect(content).toMatch(/mcp__codebase-memory__search_code/);
    expect(content).toMatch(/mcp__codebase-memory__index_repository/);
    expect(content).toMatch(/Do NOT spawn the Explore subagent/);
  });

  it("test-writer agent has correct role keywords", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = readFileSync(
      join(tmpDir, ".claude", "agents", "test-writer.md"),
      "utf-8"
    );
    expect(content.toLowerCase()).toContain("test");
    // Should mention not writing implementation
    expect(content.toLowerCase()).toContain("not");
  });

  it("security-reviewer agent has correct role keywords", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = readFileSync(
      join(tmpDir, ".claude", "agents", "security-reviewer.md"),
      "utf-8"
    );
    expect(content.toLowerCase()).toContain("security");
    // Should mention SAST-related concepts
    expect(content.toLowerCase()).toContain("injection");
  });

  it("settings.json includes PreToolUse hook blocking .a2p/state.json edits", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8")
    );
    expect(content.hooks.PreToolUse).toBeDefined();
    expect(content.hooks.PreToolUse.length).toBeGreaterThan(0);
    const hook = content.hooks.PreToolUse[0];
    expect(hook.matcher).toContain("Write");
    expect(hook.hooks[0].command).toContain(".a2p/state");
    expect(hook.hooks[0].command).toContain("exit 2");
  });

  it("PreToolUse hook matcher includes Bash to prevent shell bypass", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const content = JSON.parse(
      readFileSync(join(tmpDir, ".claude", "settings.json"), "utf-8")
    );
    const hook = content.hooks.PreToolUse[0];
    expect(hook.matcher).toContain("Bash");
  });

  it("rejects double init", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    const result = parse(handleInitProject({ projectPath: tmpDir, projectName: "test" }));
    expect(result.error).toContain("already initialized");
  });

  it("handles project name with special characters", () => {
    const result = parse(
      handleInitProject({ projectPath: tmpDir, projectName: "my app (v2)" })
    );
    expect(result.success).toBe(true);
    const content = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
    expect(content).toContain("my app (v2)");
  });

  it("response lists all created files", () => {
    const result = parse(handleInitProject({ projectPath: tmpDir, projectName: "test" }));
    expect(result.filesCreated).toBeInstanceOf(Array);
    expect(result.filesCreated.length).toBeGreaterThanOrEqual(6);
  });
});
