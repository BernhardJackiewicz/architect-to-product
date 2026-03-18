import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { handleSetupCompanions } from "../../src/tools/setup-companions.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";

describe("handleSetupCompanions", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-companions");
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
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
    cleanTmpDir(otherDir);
  });

  // ─── New companion types ────────────────────────────────────────────

  it("accepts github companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "github", name: "github-mcp", command: "github-mcp-server" },
        ],
      })
    );
    expect(result.success).toBe(true);
    expect(result.companions[0].type).toBe("github");
  });

  it("accepts git companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "git", name: "git-mcp", command: "uvx mcp-server-git" },
        ],
      })
    );
    expect(result.success).toBe(true);
    expect(result.companions[0].type).toBe("git");
  });

  it("accepts filesystem companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "filesystem", name: "fs-mcp", command: "npx @modelcontextprotocol/server-filesystem" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts semgrep companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "semgrep", name: "semgrep-mcp", command: "semgrep mcp" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts sequential_thinking companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "sequential_thinking", name: "seq-think", command: "npx @modelcontextprotocol/server-sequential-thinking" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts vercel companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "vercel", name: "vercel-mcp", command: "npx vercel" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts cloudflare companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "cloudflare", name: "cf-mcp", command: "npx @cloudflare/mcp-server-cloudflare" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts stripe companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "stripe", name: "stripe-mcp", command: "npx @stripe/mcp" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts atlassian companion type (remote)", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "atlassian", name: "atlassian-mcp", command: "https://atlassian.example.com/mcp" },
        ],
      })
    );
    expect(result.success).toBe(true);
    expect(result.companions[0].installed).toBe(true); // HTTP = always installed
  });

  it("accepts sentry companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "sentry", name: "sentry-mcp", command: "npx @sentry/mcp-server" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("accepts upstash companion type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "upstash", name: "upstash-mcp", command: "npx @upstash/mcp-server" },
        ],
      })
    );
    expect(result.success).toBe(true);
  });

  it("writes all new companion types to .mcp.json", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        { type: "git", name: "git-mcp", command: "uvx mcp-server-git" },
        { type: "filesystem", name: "fs-mcp", command: "npx @modelcontextprotocol/server-filesystem" },
        { type: "sequential_thinking", name: "seq-think", command: "npx @modelcontextprotocol/server-sequential-thinking" },
        { type: "semgrep", name: "semgrep-mcp", command: "semgrep mcp" },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(Object.keys(mcpJson.mcpServers)).toHaveLength(4);
    expect(mcpJson.mcpServers["git-mcp"].command).toBe("uvx");
    expect(mcpJson.mcpServers["fs-mcp"].command).toBe("npx");
    expect(mcpJson.mcpServers["seq-think"].command).toBe("npx");
    expect(mcpJson.mcpServers["semgrep-mcp"].command).toBe("semgrep");
  });

  // ─── Install hints for new types ──────────────────────────────────────

  it("provides install hint for git type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "git", name: "git-nonexistent-binary-xyz", command: "git-nonexistent-binary-xyz" },
        ],
      })
    );
    // Should not be installed (binary doesn't exist)
    const comp = result.companions[0];
    if (!comp.installed) {
      expect(comp.notes).toContain("mcp-server-git");
    }
  });

  it("provides install hint for semgrep type", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "semgrep", name: "semgrep-nonexistent-xyz", command: "semgrep-nonexistent-xyz" },
        ],
      })
    );
    const comp = result.companions[0];
    if (!comp.installed) {
      expect(comp.notes).toContain("semgrep");
    }
  });

  // ─── env block from config ───────────────────────────────────────────

  it("writes env block when companion has config", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        {
          type: "database",
          name: "supabase-local",
          command: "npx supabase-mcp",
          config: {
            SUPABASE_URL: "http://localhost:54321",
            SUPABASE_SERVICE_ROLE_KEY: "test-key-123",
          },
        },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["supabase-local"]).toEqual({
      command: "npx",
      args: ["supabase-mcp"],
      env: {
        SUPABASE_URL: "http://localhost:54321",
        SUPABASE_SERVICE_ROLE_KEY: "test-key-123",
      },
    });
  });

  it("does not write env block when companion has no config", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["codebase-memory"].env).toBeUndefined();
  });

  it("does not write env block when config is empty object", () => {
    handleSetupCompanions({
      projectPath: tmpDir,
      companions: [
        {
          type: "database",
          name: "postgres-mcp",
          command: "npx @modelcontextprotocol/server-postgres",
          config: {},
        },
      ],
    });

    const mcpJson = JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
    expect(mcpJson.mcpServers["postgres-mcp"].env).toBeUndefined();
  });

  // ─── warning for unavailable companions ─────────────────────────────

  it("includes warning when companion is not installed", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "codebase_memory", name: "nonexistent-binary-xyz", command: "nonexistent-binary-xyz" },
        ],
      })
    );

    // Binary doesn't exist, so should not be installed
    if (!result.companions[0].installed) {
      expect(result.warning).toContain("WARNING");
      expect(result.warning).toContain("nonexistent-binary-xyz");
      expect(result.nextStep).toContain("WARNING");
    }
  });

  it("has no warning when all companions are installed (HTTP)", () => {
    const result = parse(
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "database", name: "supabase", command: "https://mcp.supabase.com/mcp" },
        ],
      })
    );

    expect(result.warning).toBeUndefined();
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
