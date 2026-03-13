import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleInitProject } from "../../src/tools/init-project.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-init-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

describe("handleInitProject", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
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
