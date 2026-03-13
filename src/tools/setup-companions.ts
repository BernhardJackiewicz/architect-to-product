import { z } from "zod";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../state/state-manager.js";
import type { CompanionServer } from "../state/types.js";

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
      })
    )
    .min(1)
    .describe("Companion MCP servers to set up"),
});

export type SetupCompanionsInput = z.infer<typeof setupCompanionsSchema>;

export function handleSetupCompanions(input: SetupCompanionsInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found. Run a2p_init_project first." });
  }

  const results: Array<{
    name: string;
    type: string;
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

    results.push({
      name: comp.name,
      type: comp.type,
      installed: isAvailable,
      notes: isAvailable
        ? "Available and configured in .mcp.json."
        : getInstallHint(comp.type, comp.name),
    });

    sm.addCompanion(companion);
  }

  // Auto-generate .mcp.json
  const mcpJsonPath = writeMcpJson(input.projectPath, input.companions);

  return JSON.stringify({
    success: true,
    companions: results,
    mcpJsonWritten: true,
    mcpJsonPath,
    nextStep:
      ".mcp.json wurde geschrieben. Starte Claude Code neu — danach sind alle Companion-MCPs automatisch verfügbar. Dann weiter mit a2p_create_build_plan.",
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
      newServers[comp.name] = {
        command: parts[0],
        args: parts.slice(1),
      };
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
