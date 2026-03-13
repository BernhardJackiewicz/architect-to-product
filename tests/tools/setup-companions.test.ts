import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSetupCompanions } from "../../src/tools/setup-companions.js";
import { handleInitProject } from "../../src/tools/init-project.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-companions-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

describe("handleSetupCompanions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes .mcp.json with stdio companion", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.mcpJsonWritten).toBe(true);

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["codebase-memory"]).toEqual({
      command: "codebase-memory-mcp",
      args: [],
    });
  });

  it("writes .mcp.json with HTTP companion (Supabase)", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "database", name: "supabase", command: "https://mcp.supabase.com/mcp" },
        ],
      })
    );

    expect(result.success).toBe(true);

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["supabase"]).toEqual({
      type: "http",
      url: "https://mcp.supabase.com/mcp",
    });
  });

  it("writes .mcp.json with command that has args", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        { type: "playwright", name: "playwright", command: "npx @playwright/mcp" },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["playwright"]).toEqual({
      command: "npx",
      args: ["@playwright/mcp"],
    });
  });

  it("merges with existing .mcp.json instead of overwriting", () => {
    // Pre-existing .mcp.json with architect-to-product already configured
    const mcpJsonPath = join(tmpDir, ".mcp.json");
    writeFileSync(
      mcpJsonPath,
      JSON.stringify({
        mcpServers: {
          "architect-to-product": {
            command: "npx",
            args: ["architect-to-product"],
          },
        },
      }),
      "utf-8"
    );

    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    // Original entry preserved
    expect(mcpJson.mcpServers["architect-to-product"]).toEqual({
      command: "npx",
      args: ["architect-to-product"],
    });
    // New entry added
    expect(mcpJson.mcpServers["codebase-memory"]).toEqual({
      command: "codebase-memory-mcp",
      args: [],
    });
  });

  it("writes multiple companions in one call", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        { type: "database", name: "supabase", command: "https://mcp.supabase.com/mcp" },
        { type: "playwright", name: "playwright", command: "npx @playwright/mcp" },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(Object.keys(mcpJson.mcpServers)).toHaveLength(3);
    expect(mcpJson.mcpServers["codebase-memory"].command).toBe("codebase-memory-mcp");
    expect(mcpJson.mcpServers["supabase"].type).toBe("http");
    expect(mcpJson.mcpServers["playwright"].command).toBe("npx");
  });

  it("response contains mcpJsonWritten and mcpJsonPath", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        ],
      })
    );

    expect(result.mcpJsonWritten).toBe(true);
    expect(result.mcpJsonPath).toBe(join(tmpDir, ".mcp.json"));
    expect(result.nextStep).toContain(".mcp.json");
    expect(result.nextStep).toContain("neu");
  });

  it("response does not contain registrationCommand", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        ],
      })
    );

    // No companion result should have registrationCommand
    for (const comp of result.companions) {
      expect(comp.registrationCommand).toBeUndefined();
    }
  });

  it("HTTP companions are marked as installed", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "database", name: "supabase", command: "https://mcp.supabase.com/mcp" },
        ],
      })
    );

    expect(result.companions[0].installed).toBe(true);
  });

  it("returns error without init", () => {
    const otherDir = makeTmpDir();
    const result = parse(
      handleSetupCompanions({
        projectPath: otherDir,
        companions: [
          { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        ],
      })
    );
    expect(result.error).toContain("No project");
    rmSync(otherDir, { recursive: true, force: true });
  });

  it("handles corrupted existing .mcp.json gracefully", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "not json at all{{{", "utf-8");

    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
        ],
      })
    );

    expect(result.success).toBe(true);
    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["codebase-memory"]).toBeDefined();
  });
});
