import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import type { Slice } from "../state/types.js";

export const addSliceSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  slice: z.object({
    id: z.string().describe("Unique slice ID"),
    name: z.string().describe("Human-readable name"),
    description: z.string().describe("What this slice implements"),
    acceptanceCriteria: z.array(z.string()).min(1).describe("When is this slice done? At least one concrete, testable criterion"),
    testStrategy: z.string().min(1).describe("How to test this slice: name the happy-path test, key error cases, and whether integration/real-service tests are needed"),
    dependencies: z.array(z.string()).describe("IDs of slices this depends on"),
    type: z.enum(["feature", "integration", "infrastructure"]).optional().describe("Slice type (default: feature)"),
    productPhaseId: z.string().optional().describe("Product phase this slice belongs to"),
    hasUI: z.boolean().optional().describe("Whether this slice has frontend/UI changes"),
    bootstrap: z.boolean().optional().describe("Reserved for the A2P self-rebuild: one slice per project may legacy-flow through the build. Rejected if already claimed or locked."),
  }),
  insertAfterSliceId: z.string().optional().describe("Insert after this slice ID (appends to end if omitted)"),
});

export type AddSliceInput = z.infer<typeof addSliceSchema>;

export function handleAddSlice(input: AddSliceInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

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

  // Reject self-dependency (check before existence validation)
  if (input.slice.dependencies.includes(input.slice.id)) {
    return JSON.stringify({
      error: `Slice "${input.slice.id}" cannot depend on itself.`,
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
    ...(input.slice.bootstrap === true ? { bootstrap: true } : {}),
  };

  // Save the current index before mutation
  const previousIndex = state.currentSliceIndex;

  if (!input.insertAfterSliceId) {
    // Append to end — use addSlices, then restore index
    sm.addSlices([newSlice]);
    // Restore the index to where we were (addSlices jumps to the new slice)
    if (previousIndex >= 0 && previousIndex < state.slices.length) {
      sm.setCurrentSliceIndex(previousIndex);
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
      currentSlicePreserved: true,
      nextStep: `Slice "${newSlice.name}" added at position ${state.slices.length + 1}. Continue building current slice.`,
      testHint: "When building this slice: define happy-path test, key error cases, and integration/real-service tests before writing code.",
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

  // Use setSlices (resets index to 0)
  sm.setSlices(newSlices);

  // Restore the correct current slice index
  // If inserted before or at the current position, shift index forward by 1
  let correctedIndex = previousIndex;
  if (insertIndex + 1 <= previousIndex) {
    correctedIndex = previousIndex + 1;
  }
  if (correctedIndex >= 0) {
    sm.setCurrentSliceIndex(correctedIndex);
  }

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
    currentSlicePreserved: true,
    insertedBeforeCurrentSlice: insertIndex + 1 <= previousIndex,
    nextStep: `Slice "${newSlice.name}" inserted after "${input.insertAfterSliceId}" at position ${insertIndex + 2}.`,
    testHint: "When building this slice: define happy-path test, key error cases, and integration/real-service tests before writing code.",
  });
}
