import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import { SERVER_VERSION } from "../utils/constants.js";

export const getStateSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GetStateInput = z.infer<typeof getStateSchema>;

export function handleGetState(input: GetStateInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  const progress = sm.getProgress();
  const phases = state.architecture?.phases;
  const currentProductPhase = sm.getCurrentProductPhase();

  // Companion readiness: structured signal for core MCPs
  const companionReadiness = {
    codebaseMemory: state.companions.some(c => c.type === "codebase_memory" && c.installed),
    git: state.companions.some(c => c.type === "git" && c.installed),
    filesystem: state.companions.some(c => c.type === "filesystem" && c.installed),
    database: state.companions.some(c => c.type === "database" && c.installed),
    playwright: state.companions.some(c => c.type === "playwright" && c.installed),
  };

  // Restart hint: companions configured but architecture setup just completed
  // This is a soft hint, not a hard block — prompts should not block on this
  // because there's no reliable way to detect whether the restart already happened.
  const restartRequired = false;

  // Companion health note: warn if companions are configured but some may be unavailable
  let companionHealthNote: string | undefined;
  if (state.companions.length > 0) {
    const notInstalled = state.companions.filter(c => !c.installed);
    if (notInstalled.length > 0) {
      companionHealthNote = `⚠️  COMPANION HEALTH: ${notInstalled.length} of ${state.companions.length} companion MCP server(s) were not available at setup time: ${notInstalled.map(c => c.name).join(", ")}. If tools from these servers are unavailable, the server may have crashed or is not installed. The user should check /mcp and restart failed servers. This does NOT block the build but reduces code quality and database tooling.`;
    }
  }

  return JSON.stringify({
    a2pVersion: SERVER_VERSION,
    projectName: state.projectName,
    phase: state.phase,
    progress,
    architecture: state.architecture
      ? { name: state.architecture.name, techStack: state.architecture.techStack }
      : null,
    currentSlice: sm.getCurrentSlice(),
    companions: state.companions.map((c) => ({
      name: c.name,
      type: c.type,
      installed: c.installed,
    })),
    companionReadiness,
    companionHealthNote,
    restartRequired,
    config: state.config,
    ...(phases && phases.length > 0
      ? {
          productPhase: currentProductPhase,
          totalProductPhases: phases.length,
          currentProductPhaseIndex: state.currentProductPhase,
          phasesCompleted: phases.slice(0, state.currentProductPhase).map((p) => p.name),
        }
      : {}),
  });
}
