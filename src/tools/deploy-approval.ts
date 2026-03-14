import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const deployApprovalSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  note: z.string().optional().describe("Optional note from the human (e.g. 'staging tested, ready for prod')"),
});

export type DeployApprovalInput = z.infer<typeof deployApprovalSchema>;

export function handleDeployApproval(input: DeployApprovalInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.setDeployApproval(input.note);
    return JSON.stringify({
      success: true,
      approvedAt: state.deployApprovalAt,
      stateHash: state.deployApprovalStateHash,
      note: input.note ?? null,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
