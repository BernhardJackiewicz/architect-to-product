import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { StateManager } from "../../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-arch-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

const baseInput = {
  name: "Test App",
  description: "A test application",
  language: "Python",
  framework: "FastAPI",
  features: ["CRUD", "Auth"],
  dataModel: "users, items",
  apiDesign: "REST",
};

describe("handleSetArchitecture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores architecture correctly in state", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.name).toBe("Test App");
    expect(result.architecture.techStack.language).toBe("Python");
    expect(result.architecture.techStack.framework).toBe("FastAPI");

    // Verify persisted in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.name).toBe("Test App");
    expect(state.architecture?.description).toBe("A test application");
  });

  it("optional fields can be omitted without crash", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    // database, frontend, hosting are all undefined
    expect(result.success).toBe(true);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.techStack.database).toBeNull();
    expect(state.architecture?.techStack.frontend).toBeNull();
    expect(state.architecture?.techStack.hosting).toBeNull();
  });

  it("detects Supabase -> supabase-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "Supabase",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("supabase"))).toBe(true);
  });

  it("detects PostgreSQL -> postgres-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "PostgreSQL",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("postgres"))).toBe(true);
  });

  it("detects SQLite -> sqlite-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "SQLite",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("sqlite"))).toBe(true);
  });

  it("suggests supabase as default when no database specified", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(
      result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("supabase"))
    ).toBe(true);
  });

  it("detects frontend -> playwright-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "React",
      })
    );
    expect(
      result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("playwright"))
    ).toBe(true);
  });

  it("always suggests codebase-memory-mcp", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions).toContain("codebase-memory-mcp");
  });

  it("returns error without init", () => {
    const otherDir = makeTmpDir();
    const result = parse(
      handleSetArchitecture({ projectPath: otherDir, ...baseInput })
    );
    expect(result.error).toContain("No project");
    rmSync(otherDir, { recursive: true, force: true });
  });

  it("counts features correctly", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["A", "B", "C"],
      })
    );
    expect(result.architecture.featureCount).toBe(3);
  });
});
