import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import type { Slice } from "../state/types.js";

export const createBuildPlanSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  slices: z
    .array(
      z.object({
        id: z.string().describe("Unique slice ID (e.g. s01-project-setup)"),
        name: z.string().describe("Human-readable name"),
        description: z.string().describe("What this slice implements"),
        acceptanceCriteria: z.array(z.string()).describe("When is this slice done?"),
        testStrategy: z.string().describe("How to test this slice"),
        dependencies: z.array(z.string()).describe("IDs of slices this depends on"),
        productPhaseId: z.string().optional().describe("Product phase this slice belongs to"),
        type: z.enum(["feature", "integration", "infrastructure"]).optional().describe("Slice type (default: feature)"),
        hasUI: z.boolean().optional().describe("Whether this slice has frontend/UI changes"),
      })
    )
    .min(1)
    .describe("Ordered list of vertical slices to build"),
  append: z.boolean().optional().describe("If true, append slices to existing plan instead of replacing (for multi-phase)"),
});

export type CreateBuildPlanInput = z.infer<typeof createBuildPlanSchema>;

export function handleCreateBuildPlan(input: CreateBuildPlanInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found. Run a2p_init_project first." });
  }

  const state = sm.read();

  if (!state.architecture) {
    return JSON.stringify({
      error: "No architecture set. Run a2p_set_architecture first.",
    });
  }

  // When appending, include existing slice IDs for dependency validation
  const existingIds = input.append
    ? new Set(state.slices.map((s) => s.id))
    : new Set<string>();
  const newIds = new Set(input.slices.map((s) => s.id));
  const allIds = new Set([...existingIds, ...newIds]);

  for (const slice of input.slices) {
    for (const dep of slice.dependencies) {
      if (!allIds.has(dep)) {
        return JSON.stringify({
          error: `Slice "${slice.id}" depends on "${dep}" which doesn't exist in the plan.`,
        });
      }
    }
  }

  // Check for circular dependencies (simple DFS)
  const circularError = detectCircularDeps(input.slices);
  if (circularError) {
    return JSON.stringify({ error: circularError });
  }

  // Convert to full Slice objects
  const slices: Slice[] = input.slices.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    acceptanceCriteria: s.acceptanceCriteria,
    testStrategy: s.testStrategy,
    dependencies: s.dependencies,
    status: "pending" as const,
    files: [],
    testResults: [],
    sastFindings: [],
    ...(s.productPhaseId ? { productPhaseId: s.productPhaseId } : {}),
    ...(s.type ? { type: s.type } : {}),
    ...(s.hasUI !== undefined ? { hasUI: s.hasUI } : {}),
  }));

  if (input.append) {
    sm.addSlices(slices);
  } else {
    sm.setSlices(slices);
  }

  // Only transition to planning if not already there (e.g. after completeProductPhase)
  if (state.phase !== "planning") {
    sm.setPhase("planning");
  }

  const totalSlices = input.append ? state.slices.length + slices.length : slices.length;

  return JSON.stringify({
    success: true,
    sliceCount: slices.length,
    totalSlices,
    appended: input.append ?? false,
    slices: slices.map((s, i) => ({
      order: (input.append ? state.slices.length : 0) + i + 1,
      id: s.id,
      name: s.name,
      dependencies: s.dependencies,
      ...(s.type ? { type: s.type } : {}),
      ...(s.productPhaseId ? { productPhaseId: s.productPhaseId } : {}),
    })),
    nextStep:
      "Build plan created. Transition to building phase and start the TDD loop with a2p_build_slice prompt.",
  });
}

function detectCircularDeps(
  slices: { id: string; dependencies: string[] }[]
): string | null {
  const depMap = new Map(slices.map((s) => [s.id, s.dependencies]));
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(id: string, path: string[]): string | null {
    if (inStack.has(id)) {
      return `Circular dependency detected: ${[...path, id].join(" → ")}`;
    }
    if (visited.has(id)) return null;

    visited.add(id);
    inStack.add(id);

    for (const dep of depMap.get(id) ?? []) {
      const err = dfs(dep, [...path, id]);
      if (err) return err;
    }

    inStack.delete(id);
    return null;
  }

  for (const slice of slices) {
    const err = dfs(slice.id, []);
    if (err) return err;
  }
  return null;
}
