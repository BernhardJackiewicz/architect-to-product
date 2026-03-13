import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

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

    // Track files if provided
    if (input.files && input.files.length > 0) {
      const existing = new Set(slice.files);
      for (const f of input.files) existing.add(f);
      slice.files = [...existing];
      // Re-read and write since setSliceStatus already wrote
      const freshState = sm.read();
      const freshSlice = freshState.slices.find((s) => s.id === input.sliceId)!;
      freshSlice.files = slice.files;
      // Write via updateConfig to trigger a write (hacky but works)
      sm.updateConfig(freshState.config);
    }

    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      newStatus: input.status,
      files: slice.files,
      nextStep: getNextStepHint(input.status),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

function getNextStepHint(status: string): string {
  switch (status) {
    case "red":
      return "Tests are written and failing. Now write the minimal implementation to make them pass (GREEN phase).";
    case "green":
      return "Tests pass. Now refactor the code for quality while keeping tests green (REFACTOR phase).";
    case "refactor":
      return "Code is clean. Run lightweight SAST on changed files (a2p_run_sast mode=slice).";
    case "sast":
      return "SAST complete. If no critical findings, mark as done. Otherwise, go back to RED to fix.";
    case "done":
      return "Slice complete! Advance to the next slice or proceed to the next phase.";
    default:
      return "";
  }
}
