import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import type { ProjectState } from "../state/types.js";

export const updateSliceSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("ID of the slice to update"),
  status: z
    .enum(["red", "green", "refactor", "sast", "done"])
    .describe("New status for the slice (must be a valid transition)"),
  files: z
    .array(z.string())
    .optional()
    .describe("Files created or modified in this step"),
});

export type UpdateSliceInput = z.infer<typeof updateSliceSchema>;

export function handleUpdateSlice(input: UpdateSliceInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

  try {
    const state = sm.setSliceStatus(input.sliceId, input.status);
    const slice = state.slices.find((s) => s.id === input.sliceId)!;

    // Track files if provided (using proper StateManager API)
    if (input.files && input.files.length > 0) {
      sm.updateSliceFiles(input.sliceId, input.files);
      // Re-read to get updated files for response
      const freshSlice = sm.read().slices.find((s) => s.id === input.sliceId)!;
      slice.files = freshSlice.files;
    }

    const { nextStep, awaitingHumanReview } = getNextStepHint(input.status, state, input.sliceId);

    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      newStatus: input.status,
      files: slice.files,
      nextStep,
      awaitingHumanReview,
      ...(input.status === "done"
        ? {
            sliceSummary: {
              hint: "Erstelle eine Zusammenfassung: Akzeptanzkriterien, was die Tests prüfen, implementiertes Verhalten, getroffene Annahmen.",
            },
          }
        : {}),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

function getNextStepHint(
  status: string,
  state?: ProjectState,
  sliceId?: string
): { nextStep: string; awaitingHumanReview: boolean } {
  switch (status) {
    case "red":
      return {
        nextStep: "Tests are written and failing. Now write the minimal implementation to make them pass (GREEN phase).",
        awaitingHumanReview: false,
      };
    case "green":
      return {
        nextStep: "Tests pass. Now refactor the code for quality while keeping tests green (REFACTOR phase).",
        awaitingHumanReview: false,
      };
    case "refactor":
      return {
        nextStep: "Code is clean. Run lightweight SAST on changed files (a2p_run_sast mode=slice).",
        awaitingHumanReview: false,
      };
    case "sast":
      return {
        nextStep: "SAST complete. If no critical findings, mark as done. Otherwise, go back to RED to fix.",
        awaitingHumanReview: false,
      };
    case "done": {
      const reviewMode = state?.architecture?.reviewMode ?? "off";
      const slice = sliceId ? state?.slices.find((s) => s.id === sliceId) : undefined;
      const needsReview =
        reviewMode === "all" ||
        (reviewMode === "ui-only" && slice?.hasUI === true);

      if (needsReview) {
        const sliceName = slice?.name ?? sliceId ?? "unknown";
        return {
          nextStep: `CHECKPOINT — Slice "${sliceName}" ist fertig. Bitte reviewe und bestätige, bevor der nächste Slice gestartet wird.`,
          awaitingHumanReview: true,
        };
      }

      return {
        nextStep: "Slice complete! Advance to the next slice or proceed to the next phase.",
        awaitingHumanReview: false,
      };
    }
    default:
      return { nextStep: "", awaitingHumanReview: false };
  }
}
