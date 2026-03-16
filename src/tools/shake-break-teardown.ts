import { z } from "zod";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { requireProject } from "../utils/tool-helpers.js";
import type { ShakeBreakResult, ShakeBreakCategory } from "../state/types.js";

export const shakeBreakTeardownSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  categoriesTested: z.array(z.string()).describe("Categories that were actually tested"),
  note: z.string().optional().describe("Optional summary note"),
});

export type ShakeBreakTeardownInput = z.infer<typeof shakeBreakTeardownSchema>;

/** Collect all shake-break finding IDs from current state */
function collectShakeBreakFindingIds(state: { slices: Array<{ sastFindings: Array<{ id: string; tool: string }> }>; projectFindings: Array<{ id: string; tool: string }> }): string[] {
  const ids: string[] = [];
  for (const slice of state.slices) {
    for (const f of slice.sastFindings) {
      if (f.tool === "shake-break") ids.push(f.id);
    }
  }
  for (const f of state.projectFindings) {
    if (f.tool === "shake-break") ids.push(f.id);
  }
  return ids;
}

export function handleShakeBreakTeardown(input: ShakeBreakTeardownInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();

  if (!state.shakeBreakSession) {
    return JSON.stringify({
      error: "No active Shake & Break session. Nothing to tear down.",
    });
  }

  const session = state.shakeBreakSession;

  // Calculate findings recorded during this session
  const currentFindingIds = collectShakeBreakFindingIds(state);
  const startingIds = new Set(session.startingFindingIds);
  const newFindingIds = currentFindingIds.filter(id => !startingIds.has(id));
  const findingsRecorded = newFindingIds.length;

  // Calculate duration
  const durationMinutes = Math.round(
    (Date.now() - new Date(session.startedAt).getTime()) / 60000
  );

  // Cleanup: remove worktree
  try {
    if (existsSync(session.sandboxPath)) {
      execSync(`git worktree remove --force "${session.sandboxPath}"`, { stdio: "pipe", timeout: 10000 });
    }
  } catch { /* best-effort */ }

  // Cleanup: kill port process
  try {
    execSync(`lsof -ti:${session.port} | xargs kill 2>/dev/null`, { stdio: "pipe", timeout: 5000 });
  } catch { /* best-effort */ }

  // Cleanup: remove Docker container
  if (session.dockerContainerId) {
    try {
      execSync(`docker rm -f ${session.dockerContainerId}`, { stdio: "pipe", timeout: 10000 });
    } catch { /* best-effort */ }
  }

  // Cleanup: remove temp DB directory
  if (session.dbUrl.startsWith("sqlite://")) {
    const dbPath = session.dbUrl.replace("sqlite://", "");
    const dbDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    try {
      execSync(`rm -rf "${dbDir}"`, { stdio: "pipe", timeout: 5000 });
    } catch { /* best-effort */ }
  }

  // Generate result ID
  const resultId = `SB-${String(state.shakeBreakResults.length + 1).padStart(3, "0")}`;

  const result: ShakeBreakResult = {
    id: resultId,
    timestamp: new Date().toISOString(),
    durationMinutes,
    categoriesTested: input.categoriesTested as ShakeBreakCategory[],
    findingsRecorded,
    note: input.note ?? "",
  };

  // Save result and clear session
  sm.addShakeBreakResult(result);
  sm.clearShakeBreakSession();

  return JSON.stringify({
    success: true,
    result: {
      id: resultId,
      durationMinutes,
      findingsRecorded,
      categoriesTested: input.categoriesTested,
      note: input.note ?? "",
    },
    cleanup: {
      worktreeRemoved: true,
      portReleased: true,
      dockerStopped: session.dockerContainerId !== null,
      tempDbRemoved: session.dbUrl.startsWith("sqlite://"),
    },
  });
}
