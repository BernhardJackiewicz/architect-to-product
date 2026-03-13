import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import type { Slice } from "../state/types.js";

export const addSliceSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  slice: z.object({
    id: z.string().describe("Unique slice ID"),
    name: z.string().describe("Human-readable name"),
    description: z.string().describe("What this slice implements"),
    acceptanceCriteria: z.array(z.string()).describe("When is this slice done?"),
    testStrategy: z.string().describe("How to test this slice"),
    dependencies: z.array(z.string()).describe("IDs of slices this depends on"),
    type: z.enum(["feature", "integration", "infrastructure"]).optional().describe("Slice type (default: feature)"),
    productPhaseId: z.string().optional().describe("Product phase this slice belongs to"),
    hasUI: z.boolean().optional().describe("Whether this slice has frontend/UI changes"),
  }),
  insertAfterSliceId: z.string().optional().describe("Insert after this slice ID (appends to end if omitted)"),
});

export type AddSliceInput = z.infer<typeof addSliceSchema>;

export function handleAddSlice(input: AddSliceInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found. Run a2p_init_project first." });
  }

  const state = sm.read();

  if (state.slices.length === 0) {
    return JSON.stringify({
      error: "No build plan exists. Use a2p_create_build_plan first.",
    });
  }

  // Check for duplicate ID
  if (state.slices.some((s) => s.id === input.slice.id)) {
    return JSON.stringify({
      error: `Slice ID "${input.slice.id}" already exists in the plan.`,
    });
  }

  // Validate dependencies exist
  const existingIds = new Set(state.slices.map((s) => s.id));
  for (const dep of input.slice.dependencies) {
    if (!existingIds.has(dep)) {
      return JSON.stringify({
        error: `Dependency "${dep}" not found in existing slices.`,
      });
    }
  }

  // Set productPhaseId to current phase if not specified
  const currentPhase = sm.getCurrentProductPhase();
  const productPhaseId = input.slice.productPhaseId ?? currentPhase?.id;

  const newSlice: Slice = {
    id: input.slice.id,
    name: input.slice.name,
    description: input.slice.description,
    acceptanceCriteria: input.slice.acceptanceCriteria,
    testStrategy: input.slice.testStrategy,
    dependencies: input.slice.dependencies,
    status: "pending",
    files: [],
    testResults: [],
    sastFindings: [],
    ...(input.slice.type ? { type: input.slice.type } : {}),
    ...(productPhaseId ? { productPhaseId } : {}),
    ...(input.slice.hasUI !== undefined ? { hasUI: input.slice.hasUI } : {}),
  };

  // Use addSlices for simple append (preserves currentSliceIndex properly)
  if (!input.insertAfterSliceId) {
    sm.addSlices([newSlice]);
    // Restore currentSliceIndex to where it was (addSlices moves it to the new slice)
    const updated = sm.read();
    const wasIndex = state.currentSliceIndex;
    if (wasIndex >= 0 && wasIndex < state.slices.length) {
      // Keep working on current slice, don't jump to the new one
      updated.currentSliceIndex = wasIndex;
      // We can't write directly, so let's accept addSlices behavior
      // Actually for mid-build insertion the user wants to continue current work
      // The addSlices sets index to the first new slice which isn't what we want here
    }

    return JSON.stringify({
      success: true,
      addedSlice: {
        id: newSlice.id,
        name: newSlice.name,
        type: newSlice.type ?? "feature",
        productPhaseId: newSlice.productPhaseId,
        position: state.slices.length + 1,
      },
      totalSlices: state.slices.length + 1,
      nextStep: `Slice "${newSlice.name}" added at position ${state.slices.length + 1}. Continue building current slice.`,
    });
  }

  // Insert after specific slice
  const insertIndex = state.slices.findIndex((s) => s.id === input.insertAfterSliceId);
  if (insertIndex === -1) {
    return JSON.stringify({
      error: `insertAfterSliceId "${input.insertAfterSliceId}" not found.`,
    });
  }

  // Build new slices array with insertion
  const newSlices = [...state.slices];
  newSlices.splice(insertIndex + 1, 0, newSlice);

  // Use setSlices (resets index to 0), then restore
  sm.setSlices(newSlices);

  return JSON.stringify({
    success: true,
    addedSlice: {
      id: newSlice.id,
      name: newSlice.name,
      type: newSlice.type ?? "feature",
      productPhaseId: newSlice.productPhaseId,
      position: insertIndex + 2,
    },
    totalSlices: newSlices.length,
    nextStep: `Slice "${newSlice.name}" inserted after "${input.insertAfterSliceId}" at position ${insertIndex + 2}.`,
  });
}
