import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import { ConcernPlanEntrySchema } from "../state/validators.js";

const finalPlanSchema = z.object({
  touchedAreas: z.array(z.string()).min(1),
  expectedFiles: z.array(z.string()).min(1),
  interfacesToChange: z.array(z.string()),
  invariantsToPreserve: z.array(z.string()),
  risks: z.array(z.string()),
  narrative: z.string().min(1).max(800),
  systemsConcernPlans: z
    .array(ConcernPlanEntrySchema)
    .optional()
    .describe(
      "A2P v2: per-concern plan entries. For every REQUIRED concern, describe the approach, files touched, and rollback strategy.",
    ),
});

export const hardenPlanSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice being hardened"),
  round: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .describe("Plan hardening round (1..3, strict sequential)"),
  initialPlan: z
    .string()
    .optional()
    .describe("Required on round 1 only: the first implementation plan you wrote"),
  critique: z
    .union([
      z.literal("LGTM — no substantive issues on re-review."),
      z.string().min(20),
    ])
    .describe(
      "Either the LGTM literal (only valid on round 2+ when the plan is unchanged and a prior round had substantive critique) or a substantive critique of at least 20 characters. Filler critique is prohibited.",
    ),
  revisedPlan: z
    .string()
    .min(1)
    .describe("The improved plan that addresses your critique"),
  improvementsFound: z
    .boolean()
    .describe("True if this round produced real improvement; false if it did not"),
  finalize: z
    .boolean()
    .describe("True to finalize plan hardening after this round (requires finalPlan)"),
  finalPlan: finalPlanSchema
    .optional()
    .describe("Structured final plan, required when finalize=true"),
});

export type HardenPlanInput = z.infer<typeof hardenPlanSchema>;

export function handleHardenPlan(input: HardenPlanInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    sm.appendSlicePlanRound(input.sliceId, input.round, {
      initialPlan: input.initialPlan,
      critique: input.critique,
      revisedPlan: input.revisedPlan,
      improvementsFound: input.improvementsFound,
    });

    if (input.finalize) {
      if (!input.finalPlan) {
        return JSON.stringify({
          error: "finalize=true requires a structured finalPlan (touchedAreas, expectedFiles, interfacesToChange, invariantsToPreserve, risks, narrative).",
        });
      }
      const state = sm.finalizeSlicePlan(input.sliceId, input.finalPlan);
      const slice = state.slices.find((s) => s.id === input.sliceId)!;
      return JSON.stringify({
        success: true,
        sliceId: input.sliceId,
        finalized: true,
        rounds: slice.planHardening!.rounds.length,
        nextStep:
          "a2p_update_slice status=ready_for_red — A2P will capture a baseline, after which you must write failing tests only (no production code) and call a2p_verify_test_first.",
      });
    }

    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      finalized: false,
      round: input.round,
      nextStep:
        input.round < 3
          ? `a2p_harden_plan round=${input.round + 1} — critique your revisedPlan again. If no real improvement is found, call with improvementsFound=false and finalize=true.`
          : "a2p_harden_plan round=3 was the last allowed round. Re-call with finalize=true and finalPlan={...} to commit.",
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
