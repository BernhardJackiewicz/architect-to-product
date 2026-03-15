import type { ProjectState } from "../state/types.js";

/**
 * Global quality-audit cadence check.
 *
 * Determines whether a quality audit is due based on how many slices
 * have been completed since the last quality audit. Uses only existing
 * state — no new fields needed.
 *
 * Advisory only (hint in update-slice response), not a hard gate.
 * The hard gate remains at building → security transition.
 */

const DEFAULT_CADENCE_SLICES = 3;

export interface CadenceStatus {
  due: boolean;
  slicesSinceAudit: number;
  threshold: number;
}

export function qualityAuditCadence(
  state: ProjectState,
  cadenceSlices: number = DEFAULT_CADENCE_SLICES,
): CadenceStatus {
  const currentDone = state.slices.filter(s => s.status === "done").length;

  const qualityAudits = state.auditResults.filter(a => a.mode === "quality");
  const lastAudit = qualityAudits.length > 0
    ? qualityAudits[qualityAudits.length - 1]
    : null;

  const slicesDoneAtLastAudit = lastAudit?.aggregated.slicesDone ?? 0;
  const slicesSinceAudit = currentDone - slicesDoneAtLastAudit;

  return {
    due: slicesSinceAudit >= cadenceSlices,
    slicesSinceAudit,
    threshold: cadenceSlices,
  };
}
