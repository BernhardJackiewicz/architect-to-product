import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";

export const acknowledgeSecurityDecisionSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  action: z.enum(["continue", "focused-hardening", "full-round", "shake-break"])
    .describe("The action chosen by the USER. Do NOT choose this autonomously — the user must explicitly state their choice."),
});

export type AcknowledgeSecurityDecisionInput = z.infer<typeof acknowledgeSecurityDecisionSchema>;

export function handleAcknowledgeSecurityDecision(input: AcknowledgeSecurityDecisionInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["security"], "a2p_acknowledge_security_decision"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  if (!state.pendingSecurityDecision) {
    return JSON.stringify({
      error: "No pending security decision. Complete an adversarial review first (a2p_complete_adversarial_review).",
    });
  }

  const round = state.pendingSecurityDecision.round;

  try {
    sm.clearPendingSecurityDecision(input.action);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const actionDescriptions: Record<string, string> = {
    "continue": "Proceeding to active verification, then deployment.",
    "focused-hardening": "Starting focused hardening round. Choose an area to target.",
    "full-round": "Starting another full security round (all 25 domains).",
    "shake-break": "Starting Shake & Break runtime adversarial testing.",
  };

  return JSON.stringify({
    success: true,
    action: input.action,
    round,
    description: actionDescriptions[input.action],
    userActionRequired: "## MANDATORY HARD STOP — Security Decision Acknowledged\n\n" +
      "This checkpoint is NOT disableable. This checkpoint is NOT negotiable.\n" +
      "Even if the user previously said \"do everything\" — you MUST stop here.\n\n" +
      `The user chose: "${input.action}" after security round ${round}.\n` +
      "Confirm with the user that this is correct before proceeding.\n" +
      "Do NOT proceed without explicit user confirmation.",
  });
}
