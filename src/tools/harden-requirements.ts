import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const hardenRequirementsSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice being hardened"),
  goal: z.string().min(1).describe("One-sentence statement of what this slice must achieve"),
  nonGoals: z.array(z.string()).describe("Things explicitly out of scope for this slice"),
  affectedComponents: z
    .array(z.string())
    .min(1)
    .describe("Concrete components / files / modules that will be touched"),
  assumptions: z.array(z.string()).describe("Preconditions assumed to hold without verification"),
  risks: z.array(z.string()).describe("Things that could break or surprise"),
  finalAcceptanceCriteria: z
    .array(z.string())
    .min(1)
    .describe("Overwrites the slice's acceptanceCriteria with the hardened set"),
});

export type HardenRequirementsInput = z.infer<typeof hardenRequirementsSchema>;

export function handleHardenRequirements(input: HardenRequirementsInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.hardenSliceRequirements(input.sliceId, {
      goal: input.goal,
      nonGoals: input.nonGoals,
      affectedComponents: input.affectedComponents,
      assumptions: input.assumptions,
      risks: input.risks,
      finalAcceptanceCriteria: input.finalAcceptanceCriteria,
    });
    const slice = state.slices.find((s) => s.id === input.sliceId)!;
    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      acHash: slice.requirementsHardening!.acHash,
      finalAcceptanceCriteria: slice.requirementsHardening!.finalAcceptanceCriteria,
      nextStep: "a2p_harden_tests — map every final AC to concrete tests, with positive, negative, edge, regression cases and a done metric.",
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
