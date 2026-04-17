import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { requireProject } from "../utils/tool-helpers.js";
import type { CompanionServer } from "../state/types.js";

/**
 * Companion types whose absence silently degrades A2P workflows. These are
 * REQUIRED by default in v2.0.2 — a caller must either install them or pass
 * `allowMissingRequired: true` with a rationale logged to the audit trail.
 *
 * Only `codebase_memory` is required in v2.0.2. `git` and `filesystem` are
 * effectively mandatory too but have broader fallbacks (Bash + Read) in
 * Claude Code, so leaving them as non-gated avoids breaking existing
 * projects on upgrade.
 */
const REQUIRED_BY_DEFAULT = new Set(["codebase_memory"]);

export const setupCompanionsSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  companions: z
    .array(
      z.object({
        type: z
          .enum([
            "codebase_memory",
            "database",
            "playwright",
            "github",
            "git",
            "filesystem",
            "semgrep",
            "sequential_thinking",
            "vercel",
            "cloudflare",
            "stripe",
            "atlassian",
            "sentry",
            "upstash",
          ])
          .describe("Type of companion"),
        name: z.string().describe("Display name (e.g. supabase-mcp)"),
        command: z
          .string()
          .describe("Command to run the MCP server (e.g. npx supabase-mcp)"),
        config: z
          .record(z.string(), z.string())
          .optional()
          .describe("Additional config (e.g. database URL, project ref)"),
        required: z
          .boolean()
          .optional()
          .describe(
            "Mark this companion as required. Defaults to true for codebase_memory (v2.0.2) and false for everything else. Required companions must be installed or the call fails — unless allowMissingRequired:true is passed with a rationale.",
          ),
      })
    )
    .min(1)
    .describe("Companion MCP servers to set up"),
  allowMissingRequired: z
    .boolean()
    .optional()
    .describe(
      "Explicit escape from the required-companion gate. When true, the call succeeds even if a required companion's binary is unavailable, and the bypass is logged to state.config.companionBypasses[] for audit. Pair with a non-empty bypassRationale.",
    ),
  bypassRationale: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Human-readable reason for allowMissingRequired. Required when allowMissingRequired=true; stored with the bypass record.",
    ),
});

export type SetupCompanionsInput = z.infer<typeof setupCompanionsSchema>;

export function handleSetupCompanions(input: SetupCompanionsInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const results: Array<{
    name: string;
    type: string;
    required: boolean;
    installed: boolean;
    notes: string;
  }> = [];

  for (const comp of input.companions) {
    const companion: CompanionServer = {
      name: comp.name,
      type: comp.type,
      command: comp.command,
      installed: false,
      config: comp.config ?? {},
    };

    // Check if the binary/command is available
    const isAvailable = checkCommandAvailable(comp.command);
    companion.installed = isAvailable;

    const required = comp.required ?? REQUIRED_BY_DEFAULT.has(comp.type);

    results.push({
      name: comp.name,
      type: comp.type,
      required,
      installed: isAvailable,
      notes: isAvailable
        ? "Available and configured in .mcp.json."
        : getInstallHint(comp.type, comp.name),
    });

    sm.addCompanion(companion);
  }

  // Required-companion gate (v2.0.2): any required companion that failed to
  // install blocks the call unless the caller explicitly opted out.
  const missingRequired = results.filter((r) => r.required && !r.installed);
  if (missingRequired.length > 0 && input.allowMissingRequired !== true) {
    return JSON.stringify({
      error:
        `${missingRequired.length} required companion(s) unavailable: ${missingRequired
          .map((c) => `${c.name} (${c.type})`)
          .join("; ")}. ` +
        `Install each one, or re-run with allowMissingRequired:true and a bypassRationale explaining why this project does not need codebase-memory.`,
      missingRequired,
      installHints: missingRequired.map((c) => ({
        name: c.name,
        type: c.type,
        hint: c.notes,
      })),
    });
  }

  if (input.allowMissingRequired === true) {
    if (!input.bypassRationale || input.bypassRationale.trim().length === 0) {
      return JSON.stringify({
        error:
          "allowMissingRequired=true requires a non-empty bypassRationale explaining why the project can proceed without the required companion(s). This rationale is persisted to state.config.companionBypasses[] for audit.",
      });
    }
    if (missingRequired.length > 0) {
      sm.recordCompanionBypass({
        missing: missingRequired.map((c) => ({ name: c.name, type: c.type })),
        rationale: input.bypassRationale,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Auto-generate .mcp.json
  const mcpJsonPath = writeMcpJson(input.projectPath, input.companions);

  const optionalMissing = results.filter((r) => !r.required && !r.installed);
  const warning =
    optionalMissing.length > 0
      ? `\n⚠️  WARNING: ${optionalMissing.length} optional companion(s) not available: ${optionalMissing.map((c) => c.name).join(", ")}. After restarting, check /mcp to verify which servers are connected. If a server keeps failing, check its configuration in .mcp.json.`
      : "";

  return JSON.stringify({
    success: true,
    companions: results,
    mcpJsonWritten: true,
    mcpJsonPath,
    restartRequired: true,
    warning: warning || undefined,
    bypassedRequired: input.allowMissingRequired === true && missingRequired.length > 0
      ? missingRequired.map((c) => ({ name: c.name, type: c.type }))
      : undefined,
    nextStep:
      ".mcp.json wurde geschrieben. Starte Claude Code neu — danach sind alle Companion-MCPs automatisch verfügbar. Dann weiter mit a2p_create_build_plan." + warning,
  });
}

function writeMcpJson(
  projectPath: string,
  companions: SetupCompanionsInput["companions"]
): string {
  const mcpJsonPath = join(projectPath, ".mcp.json");

  // Read existing .mcp.json if present (merge, don't overwrite)
  let existing: Record<string, unknown> = {};
  if (existsSync(mcpJsonPath)) {
    try {
      existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    } catch {
      // Corrupted file — overwrite
    }
  }

  const existingServers = (existing.mcpServers as Record<string, unknown>) ?? {};
  const newServers: Record<string, unknown> = {};

  for (const comp of companions) {
    if (comp.command.startsWith("http")) {
      // Remote/HTTP-based MCP (e.g. Supabase)
      newServers[comp.name] = {
        type: "http",
        url: comp.command,
      };
    } else {
      // stdio-based MCP — split command into binary + args
      const parts = comp.command.split(" ");
      const entry: Record<string, unknown> = {
        command: parts[0],
        args: parts.slice(1),
      };
      if (comp.config && Object.keys(comp.config).length > 0) {
        entry.env = comp.config;
      }
      newServers[comp.name] = entry;
    }
  }

  const merged = {
    mcpServers: {
      ...existingServers,
      ...newServers,
    },
  };

  writeFileSync(mcpJsonPath, JSON.stringify(merged, null, 2) + "\n", "utf-8");
  return mcpJsonPath;
}

function checkCommandAvailable(command: string): boolean {
  // HTTP-based MCPs are always "available"
  if (command.startsWith("http")) return true;

  const binary = command.split(" ")[0];
  try {
    execSync(`which ${binary} 2>/dev/null || where ${binary} 2>/dev/null`, {
      stdio: "pipe",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function getInstallHint(type: string, name: string): string {
  switch (type) {
    case "codebase_memory":
      return "Not installed locally. Install: curl -L https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-darwin-arm64 -o /usr/local/bin/codebase-memory-mcp && chmod +x /usr/local/bin/codebase-memory-mcp";
    case "database":
      if (name.includes("supabase"))
        return "Supabase MCP is remote — no local install needed. Configured in .mcp.json.";
      return `Not installed locally. Install: npm install -g ${name}. Configured in .mcp.json.`;
    case "playwright":
      return "Not installed locally. Install: npm install -g @playwright/mcp. Configured in .mcp.json.";
    case "github":
      return "Not installed locally. Install: go install github.com/github/github-mcp-server@latest or download from https://github.com/github/github-mcp-server/releases. Configured in .mcp.json.";
    case "git":
      return "Not installed locally. Install: pip install mcp-server-git (or use uvx mcp-server-git). Configured in .mcp.json.";
    case "filesystem":
      return "Not installed locally. Install: npm install -g @modelcontextprotocol/server-filesystem. Configured in .mcp.json.";
    case "semgrep":
      return "Not installed locally. Semgrep MCP is built into semgrep CLI. Install: pip install semgrep, then run: semgrep mcp. Configured in .mcp.json.";
    case "sequential_thinking":
      return "Not installed locally. Install: npm install -g @modelcontextprotocol/server-sequential-thinking. Configured in .mcp.json.";
    case "vercel":
      return "Not installed locally. Install: npm install -g vercel. Configured in .mcp.json.";
    case "cloudflare":
      return "Not installed locally. Install: npm install -g @cloudflare/mcp-server-cloudflare. Configured in .mcp.json.";
    case "stripe":
      return "Not installed locally. Install: npm install -g @stripe/mcp. Configured in .mcp.json.";
    case "atlassian":
      return "Atlassian MCP uses OAuth — configure via remote MCP URL. See https://developer.atlassian.com/cloud/jira/platform/mcp/. Configured in .mcp.json.";
    case "sentry":
      return "Not installed locally. Install: npm install -g @sentry/mcp-server. Configured in .mcp.json.";
    case "upstash":
      return "Not installed locally. Install: npm install -g @upstash/mcp-server. Configured in .mcp.json.";
    default:
      return `Install ${name} manually. Configured in .mcp.json.`;
  }
}
