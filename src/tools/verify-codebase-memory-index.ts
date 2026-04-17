import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

/**
 * A2P v2.0.2 — record the codebase-memory-mcp index readiness for this
 * project. Pattern matches `a2p_verify_ssl`: the tool does not (and cannot)
 * itself query another MCP server, so it accepts a self-report from the
 * caller and persists it to state.codebaseMemoryReadiness.
 *
 * The caller is expected to have first run
 * `mcp__codebase-memory__list_projects` (and `index_repository` if the
 * project is missing) before calling this tool. The `indexed` boolean the
 * caller passes becomes the gate input for the soft warning on slice
 * `ready_for_red`.
 */
export const verifyCodebaseMemoryIndexSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  indexed: z
    .boolean()
    .describe(
      "True if the caller has confirmed via mcp__codebase-memory__list_projects that an index exists for this project. False if no index (or index is known-stale).",
    ),
  lastIndexedAt: z
    .string()
    .nullable()
    .describe(
      "ISO timestamp of the most recent successful index run. Pull this from mcp__codebase-memory__list_projects.indexed_at. Pass null if the project has never been indexed.",
    ),
  nodeCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional: node count reported by codebase-memory (for audit)"),
  edgeCount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Optional: edge count reported by codebase-memory (for audit)"),
});

export type VerifyCodebaseMemoryIndexInput = z.infer<
  typeof verifyCodebaseMemoryIndexSchema
>;

export function handleVerifyCodebaseMemoryIndex(
  input: VerifyCodebaseMemoryIndexInput,
): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.setCodebaseMemoryIndexStatus(
      input.indexed,
      input.lastIndexedAt,
    );
    const readiness = state.codebaseMemoryReadiness!;
    return JSON.stringify({
      success: true,
      codebaseMemoryReadiness: readiness,
      ...(input.nodeCount !== undefined ? { nodeCount: input.nodeCount } : {}),
      ...(input.edgeCount !== undefined ? { edgeCount: input.edgeCount } : {}),
      nextStep: readiness.indexed
        ? "Index readiness recorded. A2P will now suppress the soft warning on slice ready_for_red."
        : "Index readiness recorded as NOT indexed. Slice transitions will emit a soft warning until you call mcp__codebase-memory__index_repository and re-run this tool with indexed:true.",
    });
  } catch (err) {
    return JSON.stringify({
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
