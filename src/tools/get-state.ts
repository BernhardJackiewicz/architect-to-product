import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

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

  // Restart required: companions configured but still in onboarding (restart hasn't happened yet)
  const restartRequired = !!(state.companionsConfiguredAt && state.phase === "onboarding");

  return JSON.stringify({
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
