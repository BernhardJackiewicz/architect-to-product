import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

export const getStateSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GetStateInput = z.infer<typeof getStateSchema>;

export function handleGetState(input: GetStateInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({
      error: "No project found",
      hint: "Use a2p_init_project to initialize a new project first.",
    });
  }

  const state = sm.read();
  const progress = sm.getProgress();
  const phases = state.architecture?.phases;
  const currentProductPhase = sm.getCurrentProductPhase();

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
