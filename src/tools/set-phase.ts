import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const setPhaseSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  phase: z.enum([
    "onboarding", "planning", "building", "refactoring",
    "e2e_testing", "security", "deployment", "complete",
  ]).describe("Target phase to transition to"),
});

export type SetPhaseInput = z.infer<typeof setPhaseSchema>;

export function handleSetPhase(input: SetPhaseInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const stateBefore = sm.read();
  const fromPhase = stateBefore.phase;

  try {
    const stateAfter = sm.setPhase(input.phase);
    return JSON.stringify({
      success: true,
      from: fromPhase,
      to: stateAfter.phase,
      message: `Phase transition: ${fromPhase} → ${stateAfter.phase}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: msg });
  }
}
