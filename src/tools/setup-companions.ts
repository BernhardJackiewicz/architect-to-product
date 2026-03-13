import { z } from "zod";
import { execSync } from "node:child_process";
import { StateManager } from "../state/state-manager.js";
import type { CompanionServer } from "../state/types.js";

export const setupCompanionsSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  companions: z
    .array(
      z.object({
        type: z
          .enum(["codebase_memory", "database", "playwright"])
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
    registrationCommand: string;
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

    // Build registration command for Claude Code
    const registrationCommand = buildRegistrationCommand(comp);

    results.push({
      name: comp.name,
      type: comp.type,
      installed: isAvailable,
      registrationCommand,
      notes: isAvailable
        ? "Available. Register with the command below."
        : getInstallHint(comp.type, comp.name),
    });

    sm.addCompanion(companion);
  }

  return JSON.stringify({
    success: true,
    companions: results,
    nextStep:
      "Register companions in Claude Code with the provided commands, then run a2p_create_build_plan.",
  });
}

function checkCommandAvailable(command: string): boolean {
  // Extract the binary name from the command
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

function buildRegistrationCommand(comp: {
  type: string;
  name: string;
  command: string;
  config?: Record<string, string>;
}): string {
  // For HTTP-based MCP servers (like Supabase)
  if (comp.command.startsWith("http")) {
    return `claude mcp add ${comp.name} --transport http ${comp.command}`;
  }
  // For stdio-based MCP servers
  return `claude mcp add ${comp.name} -- ${comp.command}`;
}

function getInstallHint(type: string, name: string): string {
  switch (type) {
    case "codebase_memory":
      return "Install: curl -L https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-darwin-arm64 -o /usr/local/bin/codebase-memory-mcp && chmod +x /usr/local/bin/codebase-memory-mcp";
    case "database":
      if (name.includes("supabase"))
        return "Supabase MCP is remote — no local install needed. Use URL: https://mcp.supabase.com/mcp";
      return `Install: npm install -g ${name}`;
    case "playwright":
      return "Install: npm install -g @anthropic/mcp-playwright";
    default:
      return `Install ${name} manually.`;
  }
}
