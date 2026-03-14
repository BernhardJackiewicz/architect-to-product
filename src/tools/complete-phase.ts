import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const completePhaseSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type CompletePhaseInput = z.infer<typeof completePhaseSchema>;

export function handleCompletePhase(input: CompletePhaseInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const stateBefore = sm.read();
  const phases = stateBefore.architecture?.phases;

  if (!phases || phases.length === 0) {
    return JSON.stringify({
      error: "No product phases defined. This tool is only for multi-phase projects.",
    });
  }

  // Check for open high/critical findings in current phase
  const currentPhaseObj = phases[stateBefore.currentProductPhase];
  const phaseSlices = stateBefore.slices.filter((s) => s.productPhaseId === currentPhaseObj.id);
  const openHighFindings = phaseSlices
    .flatMap((s) => s.sastFindings)
    .filter((f) => f.status === "open" && (f.severity === "critical" || f.severity === "high"));

  if (openHighFindings.length > 0) {
    return JSON.stringify({
      error: `Cannot complete phase "${currentPhaseObj.name}": ${openHighFindings.length} open CRITICAL/HIGH finding(s).`,
      blockers: openHighFindings.map((f) => ({
        type: "open_finding",
        severity: f.severity,
        title: f.title,
        file: f.file,
      })),
    });
  }

  try {
    const stateAfter = sm.completeProductPhase();
    const completedPhase = phases[stateBefore.currentProductPhase];
    const isComplete = stateAfter.phase === "complete";

    if (isComplete) {
      return JSON.stringify({
        success: true,
        completedPhase: completedPhase.name,
        projectComplete: true,
        message: `Final phase "${completedPhase.name}" completed. Project is done!`,
      });
    }

    const nextPhase = phases[stateAfter.currentProductPhase];
    return JSON.stringify({
      success: true,
      completedPhase: completedPhase.name,
      projectComplete: false,
      nextPhase: {
        index: stateAfter.currentProductPhase,
        id: nextPhase.id,
        name: nextPhase.name,
        description: nextPhase.description,
        deliverables: nextPhase.deliverables,
        timeline: nextPhase.timeline,
      },
      message: `Phase "${completedPhase.name}" completed. Now plan slices for Phase ${stateAfter.currentProductPhase}: "${nextPhase.name}".`,
      nextStep: "Use a2p_create_build_plan with append=true to add slices for the next phase.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg });
  }
}
