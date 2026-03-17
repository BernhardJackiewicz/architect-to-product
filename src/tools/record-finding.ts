import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import { HardeningAreaIdSchema } from "../state/validators.js";
import type { SASTFinding, FindingConfidence, HardeningAreaId } from "../state/types.js";

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
  justification: z.string().optional().describe("Required when status is accepted, fixed, or false_positive — explain why this status is justified"),
  confidence: z.enum(["hypothesis", "evidence-backed", "hard-to-verify"]).optional().describe("Finding confidence level — REQUIRED for adversarial-review high/critical findings"),
  evidence: z.string().optional().describe("File:line reference proving what was checked — REQUIRED for adversarial-review high/critical findings"),
  domains: z.array(HardeningAreaIdSchema).optional().describe("Security domains this finding belongs to (e.g. auth-session, data-access)"),
});

export type RecordFindingInput = z.infer<typeof recordFindingSchema>;

/** Regex requiring at least one file:line reference in evidence */
const FILE_LINE_REGEX = /\S+:\d+/;

export function handleRecordFinding(input: RecordFindingInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["building", "security", "deployment"], "a2p_record_finding"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  // Require justification for non-open statuses (hardens the deployment gate)
  const requiresJustification = ["accepted", "fixed", "false_positive"];
  if (requiresJustification.includes(input.status) && (!input.justification || input.justification.trim().length === 0)) {
    return JSON.stringify({
      error: `Status "${input.status}" requires a justification. Explain why this finding is ${input.status}.`,
    });
  }

  // --- Evidence gate for adversarial-review high/critical findings ---
  let effectiveSeverity = input.severity;
  let autoDowngraded = false;

  if (input.tool === "adversarial-review" && (input.severity === "critical" || input.severity === "high")) {
    // confidence is REQUIRED
    if (!input.confidence) {
      return JSON.stringify({
        error: `Adversarial-review findings with severity "${input.severity}" require a confidence level. Provide confidence: "hypothesis" | "evidence-backed" | "hard-to-verify".`,
      });
    }

    // evidence is REQUIRED and must not be empty
    if (!input.evidence || input.evidence.trim().length === 0) {
      return JSON.stringify({
        error: `Adversarial-review findings with severity "${input.severity}" require evidence. Provide a file:line reference describing what was checked.`,
      });
    }

    // evidence must contain a file:line reference
    if (!FILE_LINE_REGEX.test(input.evidence)) {
      return JSON.stringify({
        error: `Evidence must contain at least one file:line reference (e.g. "src/auth.ts:42 — no ownership check on DELETE"). Got: "${input.evidence}"`,
      });
    }

    // Auto-downgrade hypothesis high/critical to medium
    if (input.confidence === "hypothesis") {
      effectiveSeverity = "medium";
      autoDowngraded = true;
    }
  }

  // Check for ID collision
  const existingIds = new Set(
    state.slices.flatMap((s) => s.sastFindings).map((f) => f.id)
  );
  if (existingIds.has(input.id)) {
    return JSON.stringify({
      error: `Finding ID "${input.id}" already exists. Use a unique ID.`,
    });
  }

  const description = autoDowngraded
    ? `[Auto-downgraded from ${input.severity} to medium — hypothesis without hard evidence] ${input.description}`
    : input.description;

  const finding: SASTFinding = {
    id: input.id,
    tool: input.tool,
    severity: effectiveSeverity,
    status: input.status,
    title: input.title,
    file: input.file,
    line: input.line,
    description,
    fix: input.fix ?? "",
    ...(input.justification ? { justification: input.justification } : {}),
    ...(input.confidence ? { confidence: input.confidence as FindingConfidence } : {}),
    ...(input.evidence ? { evidence: input.evidence } : {}),
    ...(input.domains ? { domains: input.domains as HardeningAreaId[] } : {}),
  };

  sm.addSASTFinding(input.sliceId, finding);

  return JSON.stringify({
    success: true,
    finding: {
      id: input.id,
      severity: effectiveSeverity,
      status: input.status,
      ...(autoDowngraded ? { autoDowngraded: true, originalSeverity: input.severity } : {}),
    },
  });
}
