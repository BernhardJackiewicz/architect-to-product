import { StateManager } from "../state/state-manager.js";
import type { Phase } from "../state/types.js";

const NO_PROJECT_ERROR = JSON.stringify({
  error: "No project found. Run a2p_init_project first.",
});

/**
 * Validate that a project exists and return its StateManager.
 * Returns null and sets `error` if no project found.
 */
export function requireProject(projectPath: string): { sm: StateManager; error?: undefined } | { sm?: undefined; error: string } {
  const sm = new StateManager(projectPath);
  if (!sm.exists()) {
    return { error: NO_PROJECT_ERROR };
  }
  return { sm };
}

/** Throw if the current phase is not in the allowed list */
export function requirePhase(
  currentPhase: Phase,
  allowedPhases: Phase[],
  toolName: string,
): void {
  if (!allowedPhases.includes(currentPhase)) {
    throw new Error(
      `${toolName} can only be used in phases: ${allowedPhases.join(", ")}. Current phase: ${currentPhase}`
    );
  }
}

/** Phase + mode guard: validates that the current phase is allowed for a given tool mode */
export function requirePhaseAndMode(
  currentPhase: Phase,
  allowedPhases: Phase[],
  toolName: string,
  mode?: string,
  modePhaseMap?: Record<string, Phase[]>,
): void {
  if (modePhaseMap && mode) {
    const modeAllowed = modePhaseMap[mode];
    if (modeAllowed && !modeAllowed.includes(currentPhase)) {
      throw new Error(
        `${toolName} ${mode} can only be used in phases: ${modeAllowed.join(", ")}. Current phase: ${currentPhase}`
      );
    }
    return;
  }
  requirePhase(currentPhase, allowedPhases, toolName);
}

/** Truncate a string to maxLen characters, appending a truncation notice. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n... (truncated)";
}
