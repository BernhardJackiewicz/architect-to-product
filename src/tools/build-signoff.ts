import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const buildSignoffSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  note: z.string().optional().describe("Optional note from the human (e.g. 'tested login and checkout flow')"),
});

export type BuildSignoffInput = z.infer<typeof buildSignoffSchema>;

export function handleBuildSignoff(input: BuildSignoffInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.setBuildSignoff(input.note);

    // Check for UI slices without Playwright companion
    const hasUISlices = state.slices.some((s) => s.hasUI);
    const hasPlaywright = state.companions.some((c) => c.type === "playwright" && c.installed);
    const e2eWarning = hasUISlices && !hasPlaywright
      ? "UI slices detected but no Playwright companion installed. E2E testing will be skipped. Consider installing playwright-mcp for visual verification."
      : undefined;

    return JSON.stringify({
      success: true,
      signedOffAt: state.buildSignoffAt,
      sliceHash: state.buildSignoffSliceHash,
      note: input.note ?? null,
      ...(e2eWarning ? { e2eWarning } : {}),
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
