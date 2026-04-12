import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

const REAL_SERVICE_KEYWORDS = /\b(real|integration|end[- ]to[- ]end|playwright|fixture|contract)\b/i;

export const hardenTestsSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice being hardened"),
  acToTestMap: z
    .array(
      z.object({
        ac: z.string().min(1),
        tests: z.array(z.string()).min(1),
        rationale: z.string(),
      }),
    )
    .min(1)
    .describe("Every hardened AC must appear here at least once with ≥1 concrete test"),
  positiveCases: z.array(z.string()).min(1),
  negativeCases: z.array(z.string()).min(1),
  edgeCases: z.array(z.string()),
  regressions: z.array(z.string()),
  additionalConcerns: z
    .array(z.string())
    .describe("Concurrency / idempotency / permissions / persistence / timeouts / contract / UI-states"),
  doneMetric: z.string().min(1).describe("What must be green for this slice to be truly done"),
});

export type HardenTestsInput = z.infer<typeof hardenTestsSchema>;

export function handleHardenTests(input: HardenTestsInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.read();
    const slice = state.slices.find((s) => s.id === input.sliceId);
    if (!slice) {
      return JSON.stringify({ error: `Slice "${input.sliceId}" not found` });
    }

    // Integration / UI slice nudge — hard check, not a warning.
    const isIntegrationOrUi = slice.type === "integration" || slice.hasUI === true;
    if (isIntegrationOrUi) {
      const hit = input.additionalConcerns.some((c) => REAL_SERVICE_KEYWORDS.test(c));
      if (!hit) {
        return JSON.stringify({
          error:
            `Slice "${input.sliceId}" is type=integration or hasUI=true. additionalConcerns must mention at least one real-service / integration / end-to-end / playwright / fixture / contract item — mocks alone are not enough to harden this slice.`,
        });
      }
    }

    const updated = sm.hardenSliceTests(input.sliceId, {
      acToTestMap: input.acToTestMap,
      positiveCases: input.positiveCases,
      negativeCases: input.negativeCases,
      edgeCases: input.edgeCases,
      regressions: input.regressions,
      additionalConcerns: input.additionalConcerns,
      doneMetric: input.doneMetric,
    });
    const fresh = updated.slices.find((s) => s.id === input.sliceId)!;

    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      hardenedAt: fresh.testHardening!.hardenedAt,
      requirementsAcHash: fresh.testHardening!.requirementsAcHash,
      nextStep: "a2p_harden_plan round=1 — write your initial implementation plan, critique it, and revise.",
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
