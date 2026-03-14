import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import type { QualityIssue } from "../state/types.js";

export const runQualitySchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  issues: z
    .array(
      z.object({
        type: z.enum(["dead_code", "redundant", "high_coupling", "unused_import", "complex"]),
        file: z.string(),
        symbol: z.string(),
        description: z.string(),
      })
    )
    .describe(
      "Quality issues found by codebase-memory-mcp (search_graph for unreferenced symbols, get_architecture for coupling hotspots)"
    ),
});

export type RunQualityInput = z.infer<typeof runQualitySchema>;

/**
 * Records quality issues found via codebase-memory-mcp analysis.
 *
 * The actual analysis is done by Claude using codebase-memory-mcp tools:
 * 1. search_graph → find all functions/classes
 * 2. trace_call_path → check which have no callers (dead code)
 * 3. get_architecture → identify hotspots and high fan-out (coupling)
 * 4. search_graph with similar names → find redundant implementations
 *
 * This tool records the results in the project state.
 */
export function handleRunQuality(input: RunQualityInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["building"], "a2p_run_quality"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  const recorded: QualityIssue[] = [];
  let counter = 1;

  for (const issue of input.issues) {
    const qi: QualityIssue = {
      id: `Q${String(counter++).padStart(3, "0")}`,
      type: issue.type,
      file: issue.file,
      symbol: issue.symbol,
      description: issue.description,
      status: "open",
    };
    sm.addQualityIssue(qi);
    recorded.push(qi);
  }

  const byType = {
    dead_code: recorded.filter((q) => q.type === "dead_code").length,
    redundant: recorded.filter((q) => q.type === "redundant").length,
    high_coupling: recorded.filter((q) => q.type === "high_coupling").length,
    unused_import: recorded.filter((q) => q.type === "unused_import").length,
    complex: recorded.filter((q) => q.type === "complex").length,
  };

  return JSON.stringify({
    success: true,
    totalIssues: recorded.length,
    byType,
    issues: recorded,
    hint:
      recorded.length > 0
        ? "Fix these issues: delete dead code, consolidate duplicates, simplify complex functions. Run tests after each fix."
        : "No quality issues found. Codebase is clean!",
  });
}
