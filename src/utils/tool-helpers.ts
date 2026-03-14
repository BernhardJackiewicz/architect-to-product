import { StateManager } from "../state/state-manager.js";

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

/** Truncate a string to maxLen characters, appending a truncation notice. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + "\n... (truncated)";
}
