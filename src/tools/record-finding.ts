import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import type { SASTFinding } from "../state/types.js";

export const recordFindingSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().nullable().describe("Slice ID (null for project-wide findings)"),
  id: z.string().describe("Unique finding ID"),
  tool: z.string().describe("Source tool (semgrep, bandit, manual, etc.)"),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("Finding severity"),
  status: z.enum(["open", "fixed", "accepted", "false_positive"]).describe("Current status"),
  title: z.string().describe("Short title"),
  file: z.string().describe("File path"),
  line: z.number().describe("Line number"),
  description: z.string().describe("Full description of the issue"),
  fix: z.string().optional().describe("Suggested fix or applied fix (optional for new findings)"),
});

export type RecordFindingInput = z.infer<typeof recordFindingSchema>;

export function handleRecordFinding(input: RecordFindingInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

  // Check for ID collision
  const state = sm.read();
  const existingIds = new Set(
    state.slices.flatMap((s) => s.sastFindings).map((f) => f.id)
  );
  if (existingIds.has(input.id)) {
    return JSON.stringify({
      error: `Finding ID "${input.id}" already exists. Use a unique ID.`,
    });
  }

  const finding: SASTFinding = {
    id: input.id,
    tool: input.tool,
    severity: input.severity,
    status: input.status,
    title: input.title,
    file: input.file,
    line: input.line,
    description: input.description,
    fix: input.fix ?? "",
  };

  sm.addSASTFinding(input.sliceId, finding);

  return JSON.stringify({
    success: true,
    finding: { id: input.id, severity: input.severity, status: input.status },
  });
}
