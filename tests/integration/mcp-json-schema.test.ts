import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSetupCompanions } from "../../src/tools/setup-companions.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import type { SetupCompanionsInput } from "../../src/tools/setup-companions.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-mcp-schema-"));
}

function readMcpJson(projectPath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(projectPath, ".mcp.json"), "utf-8"));
}

/** Valid keys for a stdio server entry */
const STDIO_KEYS = new Set(["command", "args"]);
/** Valid keys for an HTTP server entry */
const HTTP_KEYS = new Set(["type", "url"]);
/** Valid characters for server names (alphanumeric, hyphens, underscores, dots) */
const SERVER_NAME_RE = /^[a-zA-Z0-9._-]+$/;

type StdioEntry = { command: string; args: string[] };
type HttpEntry = { type: "http"; url: string };
type ServerEntry = StdioEntry | HttpEntry;

function isHttpEntry(entry: Record<string, unknown>): entry is HttpEntry {
  return entry.type === "http";
}

/**
 * Validates a single server entry conforms to the MCP spec.
 * Throws descriptive assertion errors on violation.
 */
function assertValidServerEntry(name: string, entry: Record<string, unknown>): void {
  expect(SERVER_NAME_RE.test(name), `Server name "${name}" contains invalid characters`).toBe(true);

  const keys = Object.keys(entry);

  if (isHttpEntry(entry)) {
    // HTTP entry
    for (const key of keys) {
      expect(HTTP_KEYS.has(key), `Unexpected key "${key}" in HTTP server "${name}"`).toBe(true);
    }
    expect(typeof entry.url).toBe("string");
    expect((entry.url as string).startsWith("https://"), `HTTP url for "${name}" must start with https://`).toBe(true);
  } else {
    // stdio entry
    for (const key of keys) {
      expect(STDIO_KEYS.has(key), `Unexpected key "${key}" in stdio server "${name}"`).toBe(true);
    }
    expect(typeof entry.command).toBe("string");
    expect((entry.command as string).length > 0, `command for "${name}" must not be empty`).toBe(true);
    expect(Array.isArray(entry.args), `args for "${name}" must be an array`).toBe(true);
    for (const arg of entry.args as unknown[]) {
      expect(typeof arg).toBe("string");
    }
  }
}

/**
 * Validates the full .mcp.json structure.
 */
function assertValidMcpJson(mcpJson: Record<string, unknown>): void {
  expect(mcpJson).toHaveProperty("mcpServers");
  expect(typeof mcpJson.mcpServers).toBe("object");
  expect(mcpJson.mcpServers).not.toBeNull();
  expect(Array.isArray(mcpJson.mcpServers)).toBe(false);

  // No extra top-level keys
  expect(Object.keys(mcpJson)).toEqual(["mcpServers"]);

  const servers = mcpJson.mcpServers as Record<string, Record<string, unknown>>;
  for (const [name, entry] of Object.entries(servers)) {
    assertValidServerEntry(name, entry);
  }
}

// ── All companion configs used across tests ──────────────────────────────────

type CompanionDef = SetupCompanionsInput["companions"][number];

const ALL_COMPANIONS: CompanionDef[] = [
  { type: "codebase_memory", name: "codebase-memory", command: "codebase-memory-mcp" },
  { type: "database", name: "supabase", command: "https://mcp.supabase.com/mcp" },
  { type: "playwright", name: "playwright", command: "npx @playwright/mcp" },
  { type: "github", name: "github-mcp", command: "github-mcp-server" },
  { type: "git", name: "git-mcp", command: "uvx mcp-server-git" },
  { type: "filesystem", name: "fs-mcp", command: "npx @modelcontextprotocol/server-filesystem /path/to/project" },
  { type: "semgrep", name: "semgrep-mcp", command: "semgrep mcp" },
  { type: "sequential_thinking", name: "seq-think", command: "npx @modelcontextprotocol/server-sequential-thinking" },
  { type: "vercel", name: "vercel-mcp", command: "npx vercel" },
  { type: "cloudflare", name: "cf-mcp", command: "npx @cloudflare/mcp-server-cloudflare" },
  { type: "stripe", name: "stripe-mcp", command: "npx @stripe/mcp" },
  { type: "atlassian", name: "atlassian-mcp", command: "https://atlassian.example.com/mcp" },
  { type: "sentry", name: "sentry-mcp", command: "npx @sentry/mcp-server" },
  { type: "upstash", name: "upstash-mcp", command: "npx @upstash/mcp-server" },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("MCP JSON schema validation", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    handleInitProject({ projectPath: tmpDir, projectName: "schema-test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── 1) Per-companion-type schema validation ─────────────────────────────

  describe("generates valid .mcp.json for every companion type", () => {
    for (const companion of ALL_COMPANIONS) {
      it(`${companion.type} (${companion.name})`, () => {
        handleSetupCompanions({
          projectPath: tmpDir,
          companions: [companion],
        });

        const mcpJson = readMcpJson(tmpDir);
        assertValidMcpJson(mcpJson);

        // Verify this specific server exists
        const servers = mcpJson.mcpServers as Record<string, Record<string, unknown>>;
        expect(servers[companion.name]).toBeDefined();
      });
    }
  });

  // ── 2) Detailed structural assertions per entry type ────────────────────

  describe("stdio entries have correct structure", () => {
    const stdioCompanions = ALL_COMPANIONS.filter((c) => !c.command.startsWith("http"));

    for (const companion of stdioCompanions) {
      it(`${companion.name}: command is non-empty string, args is string[]`, () => {
        handleSetupCompanions({
          projectPath: tmpDir,
          companions: [companion],
        });

        const mcpJson = readMcpJson(tmpDir);
        const servers = mcpJson.mcpServers as Record<string, StdioEntry>;
        const entry = servers[companion.name];

        expect(typeof entry.command).toBe("string");
        expect(entry.command.length).toBeGreaterThan(0);
        expect(Array.isArray(entry.args)).toBe(true);
        entry.args.forEach((arg) => expect(typeof arg).toBe("string"));

        // No unexpected keys
        const keys = Object.keys(entry);
        expect(keys.every((k) => STDIO_KEYS.has(k))).toBe(true);
      });
    }
  });

  describe("HTTP entries have correct structure", () => {
    const httpCompanions = ALL_COMPANIONS.filter((c) => c.command.startsWith("http"));

    for (const companion of httpCompanions) {
      it(`${companion.name}: type is "http", url starts with https://`, () => {
        handleSetupCompanions({
          projectPath: tmpDir,
          companions: [companion],
        });

        const mcpJson = readMcpJson(tmpDir);
        const servers = mcpJson.mcpServers as Record<string, HttpEntry>;
        const entry = servers[companion.name];

        expect(entry.type).toBe("http");
        expect(typeof entry.url).toBe("string");
        expect(entry.url.startsWith("https://")).toBe(true);

        // No unexpected keys
        const keys = Object.keys(entry);
        expect(keys.every((k) => HTTP_KEYS.has(k))).toBe(true);
      });
    }
  });

  // ── 3) Realistic command parsing for each companion type ────────────────

  describe("realistic command parsing", () => {
    it("git: uvx mcp-server-git", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "git", name: "git-mcp", command: "uvx mcp-server-git" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["git-mcp"]).toEqual({ command: "uvx", args: ["mcp-server-git"] });
    });

    it("filesystem: npx @modelcontextprotocol/server-filesystem /path/to/project", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "filesystem", name: "fs-mcp", command: "npx @modelcontextprotocol/server-filesystem /path/to/project" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["fs-mcp"]).toEqual({ command: "npx", args: ["@modelcontextprotocol/server-filesystem", "/path/to/project"] });
    });

    it("sequential_thinking: npx @modelcontextprotocol/server-sequential-thinking", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "sequential_thinking", name: "seq-think", command: "npx @modelcontextprotocol/server-sequential-thinking" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["seq-think"]).toEqual({ command: "npx", args: ["@modelcontextprotocol/server-sequential-thinking"] });
    });

    it("semgrep: semgrep mcp", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "semgrep", name: "semgrep-mcp", command: "semgrep mcp" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["semgrep-mcp"]).toEqual({ command: "semgrep", args: ["mcp"] });
    });

    it("github: github-mcp-server (no args)", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "github", name: "github-mcp", command: "github-mcp-server" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["github-mcp"]).toEqual({ command: "github-mcp-server", args: [] });
    });

    it("vercel: npx vercel", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "vercel", name: "vercel-mcp", command: "npx vercel" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["vercel-mcp"]).toEqual({ command: "npx", args: ["vercel"] });
    });

    it("cloudflare: npx @cloudflare/mcp-server-cloudflare", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "cloudflare", name: "cf-mcp", command: "npx @cloudflare/mcp-server-cloudflare" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["cf-mcp"]).toEqual({ command: "npx", args: ["@cloudflare/mcp-server-cloudflare"] });
    });

    it("stripe: npx @stripe/mcp", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "stripe", name: "stripe-mcp", command: "npx @stripe/mcp" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["stripe-mcp"]).toEqual({ command: "npx", args: ["@stripe/mcp"] });
    });

    it("atlassian: https://atlassian.example.com/mcp (HTTP)", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "atlassian", name: "atlassian-mcp", command: "https://atlassian.example.com/mcp" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, HttpEntry>);
      expect(servers["atlassian-mcp"]).toEqual({ type: "http", url: "https://atlassian.example.com/mcp" });
    });

    it("sentry: npx @sentry/mcp-server", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "sentry", name: "sentry-mcp", command: "npx @sentry/mcp-server" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["sentry-mcp"]).toEqual({ command: "npx", args: ["@sentry/mcp-server"] });
    });

    it("upstash: npx @upstash/mcp-server", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "upstash", name: "upstash-mcp", command: "npx @upstash/mcp-server" }],
      });
      const servers = (readMcpJson(tmpDir).mcpServers as Record<string, StdioEntry>);
      expect(servers["upstash-mcp"]).toEqual({ command: "npx", args: ["@upstash/mcp-server"] });
    });
  });

  // ── 4) Merging: multiple companions in one call + across calls ──────────

  describe("merging", () => {
    it("all companions appear when generated in a single call", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: ALL_COMPANIONS,
      });

      const mcpJson = readMcpJson(tmpDir);
      assertValidMcpJson(mcpJson);

      const servers = mcpJson.mcpServers as Record<string, ServerEntry>;
      expect(Object.keys(servers)).toHaveLength(ALL_COMPANIONS.length);

      for (const companion of ALL_COMPANIONS) {
        expect(servers[companion.name], `Missing server: ${companion.name}`).toBeDefined();
      }
    });

    it("companions from separate calls are merged", () => {
      // First call: stdio companions
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "git", name: "git-mcp", command: "uvx mcp-server-git" },
          { type: "semgrep", name: "semgrep-mcp", command: "semgrep mcp" },
        ],
      });

      // Second call: HTTP + more stdio
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [
          { type: "atlassian", name: "atlassian-mcp", command: "https://atlassian.example.com/mcp" },
          { type: "sentry", name: "sentry-mcp", command: "npx @sentry/mcp-server" },
        ],
      });

      const mcpJson = readMcpJson(tmpDir);
      assertValidMcpJson(mcpJson);

      const servers = mcpJson.mcpServers as Record<string, ServerEntry>;
      expect(Object.keys(servers)).toHaveLength(4);
      expect(servers["git-mcp"]).toBeDefined();
      expect(servers["semgrep-mcp"]).toBeDefined();
      expect(servers["atlassian-mcp"]).toBeDefined();
      expect(servers["sentry-mcp"]).toBeDefined();
    });

    it("merges with pre-existing .mcp.json entries", () => {
      // Pre-seed an existing .mcp.json
      writeFileSync(
        join(tmpDir, ".mcp.json"),
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
        companions: ALL_COMPANIONS,
      });

      const mcpJson = readMcpJson(tmpDir);
      assertValidMcpJson(mcpJson);

      const servers = mcpJson.mcpServers as Record<string, ServerEntry>;
      // All companions + the pre-existing one
      expect(Object.keys(servers)).toHaveLength(ALL_COMPANIONS.length + 1);
      expect(servers["architect-to-product"]).toBeDefined();

      for (const companion of ALL_COMPANIONS) {
        expect(servers[companion.name], `Missing server: ${companion.name}`).toBeDefined();
      }
    });
  });

  // ── 5) Snapshot test: full config with all companions ───────────────────

  describe("snapshot", () => {
    it("full config with all companions matches snapshot", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: ALL_COMPANIONS,
      });

      const mcpJson = readMcpJson(tmpDir);
      expect(mcpJson).toMatchSnapshot();
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("server names in generated config contain no spaces or special chars", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: ALL_COMPANIONS,
      });

      const mcpJson = readMcpJson(tmpDir);
      const servers = mcpJson.mcpServers as Record<string, unknown>;

      for (const name of Object.keys(servers)) {
        expect(
          SERVER_NAME_RE.test(name),
          `Server name "${name}" contains invalid characters (spaces or special chars)`
        ).toBe(true);
      }
    });

    it("generated .mcp.json is valid JSON (parseable)", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: ALL_COMPANIONS,
      });

      const raw = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
      expect(() => JSON.parse(raw)).not.toThrow();
    });

    it("generated .mcp.json has trailing newline", () => {
      handleSetupCompanions({
        projectPath: tmpDir,
        companions: [{ type: "git", name: "git-mcp", command: "uvx mcp-server-git" }],
      });

      const raw = readFileSync(join(tmpDir, ".mcp.json"), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
    });
  });
});
