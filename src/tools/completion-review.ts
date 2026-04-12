import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireProject } from "../utils/tool-helpers.js";
import { getSliceDiffSinceBaseline } from "../utils/slice-diff.js";
import { scanForStubSignals } from "../utils/stub-scan.js";
import type {
  AutomatedStubSignal,
  PlanComplianceReport,
  SliceAcCoverageEntry,
  SliceCompletionReview,
  SliceFinalPlan,
} from "../state/types.js";

/**
 * Best-effort symbol scan: for each TS/JS file in `changedFiles`, extract the
 * names of top-level `export function|const|class|interface|type|enum`
 * declarations. Returns value-level exports (function, const, class, etc.)
 * and type-level exports (type, interface) separately, along with a map
 * tracking which file each symbol came from.
 *
 * This is intentionally regex-based — a full AST parse is out of scope and
 * the plan compliance check is layered (finalPlan + self-report + this).
 */
function extractExportedSymbols(
  projectPath: string,
  changedFiles: string[],
): { valueExports: Set<string>; typeExports: Set<string>; symbolToFile: Map<string, string> } {
  const valueExports = new Set<string>();
  const typeExports = new Set<string>();
  const symbolToFile = new Map<string, string>();
  const re = /\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  const typeKindRe = /\bexport\s+(?:default\s+)?(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const rel of changedFiles) {
    if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) continue;
    let content: string;
    try {
      content = readFileSync(join(projectPath, rel), "utf-8");
    } catch {
      continue;
    }
    const typeNames = new Set<string>();
    for (const m of content.matchAll(typeKindRe)) {
      typeNames.add(m[1]);
    }
    for (const m of content.matchAll(re)) {
      const name = m[1];
      symbolToFile.set(name, rel);
      if (typeNames.has(name)) {
        typeExports.add(name);
      } else {
        valueExports.add(name);
      }
    }
  }
  return { valueExports, typeExports, symbolToFile };
}

/**
 * Extract the bare identifier from a `finalPlan.interfacesToChange` entry.
 * Plan entries may be bare names ("divide"), descriptive prose
 * ("new export: divide(a: number, b: number): number"), or prefixed
 * ("adds sendWebhook"). This strips common prefixes and returns the first
 * identifier-like token.
 */
function extractBareIdentifier(entry: string): string {
  const cleaned = entry
    .replace(/^(?:new\s+export|adds|exports|removes|modifies|renames)\s*:?\s*/i, "")
    .trim();
  const match = cleaned.match(/^([A-Za-z_$][\w$]*)/);
  return match ? match[1] : entry;
}

export const completionReviewSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().describe("Slice being reviewed"),
  acCoverage: z
    .array(
      z.object({
        ac: z.string().min(1),
        status: z.enum(["met", "partial", "missing"]),
        evidence: z.string(),
      }),
    )
    .min(1),
  testCoverageQuality: z.enum(["deep", "shallow", "insufficient"]),
  missingFunctionality: z.array(z.string()),
  missingTests: z.array(z.string()),
  missingEdgeCases: z.array(z.string()),
  missingIntegrationWork: z.array(z.string()),
  missingCleanupRefactor: z.array(z.string()),
  missingPlanFixes: z.array(z.string()),
  shortcutsOrStubs: z.array(z.string()),
  stubJustifications: z
    .array(
      z.object({
        signalIndex: z.number().int().min(0),
        reason: z.string().min(1),
        followupSliceId: z.string().optional(),
      }),
    )
    .describe("One entry per automated stub signal that should not block COMPLETE"),
  verdict: z.enum(["NOT_COMPLETE", "COMPLETE"]),
  nextActions: z.array(z.string()),
});

export type CompletionReviewInput = z.infer<typeof completionReviewSchema>;

export function handleCompletionReview(input: CompletionReviewInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  const slice = state.slices.find((s) => s.id === input.sliceId);
  if (!slice) {
    return JSON.stringify({ error: `Slice "${input.sliceId}" not found` });
  }

  if (slice.status !== "sast") {
    return JSON.stringify({
      error: `Slice "${input.sliceId}": a2p_completion_review is only valid when status=sast. Current status: ${slice.status}`,
    });
  }

  // 1. acCoverage set-equality against slice.acceptanceCriteria
  const declared = new Set(input.acCoverage.map((e) => e.ac));
  for (const ac of slice.acceptanceCriteria) {
    if (!declared.has(ac)) {
      return JSON.stringify({
        error: `acCoverage is missing acceptance criterion "${ac}". Every AC must be listed exactly once.`,
      });
    }
  }
  for (const ac of declared) {
    if (!slice.acceptanceCriteria.includes(ac)) {
      return JSON.stringify({
        error: `acCoverage references unknown acceptance criterion "${ac}".`,
      });
    }
  }
  if (input.acCoverage.length !== slice.acceptanceCriteria.length) {
    return JSON.stringify({
      error: `acCoverage length (${input.acCoverage.length}) does not match slice.acceptanceCriteria length (${slice.acceptanceCriteria.length}).`,
    });
  }

  const isBootstrap = slice.bootstrap === true;

  // 2. Compute automated stub signals from diff since baseline.
  let automatedStubSignals: AutomatedStubSignal[] = [];
  const projectTestPatterns = state.architecture?.testFilePatterns;
  if (slice.baseline) {
    const changed = getSliceDiffSinceBaseline(input.projectPath, slice.baseline);
    automatedStubSignals = scanForStubSignals(
      input.projectPath,
      changed,
      projectTestPatterns && projectTestPatterns.length > 0
        ? projectTestPatterns
        : undefined,
    );
  }

  // 3. Compute plan compliance. Bootstrap slices are exempt.
  let planCompliance: PlanComplianceReport;
  if (isBootstrap || !slice.planHardening) {
    planCompliance = {
      unplannedFiles: [],
      unplannedInterfaceChanges: [],
      touchedAreasCovered: true,
      verdict: "ok",
      note: isBootstrap
        ? "bootstrap-exempt: bootstrap slices have no structured finalPlan to diff against"
        : "no plan hardening available; compliance check skipped",
    };
  } else {
    const finalPlan: SliceFinalPlan = slice.planHardening.finalPlan;
    const changed = slice.baseline
      ? getSliceDiffSinceBaseline(input.projectPath, slice.baseline)
      : [];
    const expected = new Set(finalPlan.expectedFiles.map((p) => p.replace(/\\/g, "/")));
    const unplannedFiles = changed.filter((p) => !expected.has(p.replace(/\\/g, "/")));
    // Empty diff → trivially compliant (no drift, no violated areas).
    const touchedAreasCovered =
      changed.length === 0 ||
      finalPlan.touchedAreas.length === 0 ||
      finalPlan.touchedAreas.every((area) =>
        changed.some((p) => p.includes(area)),
      );

    // Best-effort interface-change symbol scan: extract exported names from
    // changed TS/JS files and compare against finalPlan.interfacesToChange.
    // Two relaxations vs the original exact-match approach (Bug #1 dogfood fix):
    //   (a) Plan entries are parsed to extract bare identifiers — prose like
    //       "new export: divide(a: number, b: number): number" matches "divide".
    //   (b) Type-only exports (type, interface) from planned files are treated
    //       as supporting declarations and not flagged as unplanned — they are
    //       implementation details of a planned function, not API surface drift.
    const plannedIdentifiers = new Set(
      finalPlan.interfacesToChange.map(extractBareIdentifier),
    );
    const expectedFilesNorm = new Set(
      finalPlan.expectedFiles.map((p) => p.replace(/\\/g, "/")),
    );
    const { valueExports, typeExports, symbolToFile } = extractExportedSymbols(
      input.projectPath,
      changed,
    );
    const unplannedInterfaceChanges = [
      ...Array.from(valueExports).filter(
        (name) => !plannedIdentifiers.has(name),
      ),
      // Type-only exports are only flagged if they come from files NOT in
      // the plan's expectedFiles — a type alias in a planned file is a
      // supporting declaration, not a new interface.
      ...Array.from(typeExports).filter(
        (name) =>
          !plannedIdentifiers.has(name) &&
          !expectedFilesNorm.has((symbolToFile.get(name) ?? "").replace(/\\/g, "/")),
      ),
    ];

    const hasFileDrift = unplannedFiles.length > 0;
    const hasInterfaceDrift = unplannedInterfaceChanges.length > 0;
    const minorDrift =
      unplannedFiles.length <= 3 &&
      unplannedInterfaceChanges.length <= 3 &&
      touchedAreasCovered;
    const verdict: PlanComplianceReport["verdict"] =
      hasFileDrift || hasInterfaceDrift
        ? minorDrift
          ? "drift"
          : "broken"
        : touchedAreasCovered
          ? "ok"
          : "drift";
    planCompliance = {
      unplannedFiles,
      unplannedInterfaceChanges,
      touchedAreasCovered,
      verdict,
      note: "interface scan is regex-based and covers TS/JS exports only; non-TS files are checked at file granularity.",
    };
  }

  // 4. Verdict-consistency hard checks.
  const reasons: string[] = [];

  const nonMetAc = input.acCoverage.filter((e) => e.status !== "met");
  if (nonMetAc.length > 0) {
    reasons.push(`${nonMetAc.length} acceptance criterion/criteria not met`);
  }
  if (input.testCoverageQuality !== "deep") {
    reasons.push(`testCoverageQuality="${input.testCoverageQuality}"`);
  }
  if (!isBootstrap && planCompliance.verdict !== "ok") {
    reasons.push(`planCompliance="${planCompliance.verdict}"`);
  }
  const missingBuckets: Array<[string, string[]]> = [
    ["missingFunctionality", input.missingFunctionality],
    ["missingTests", input.missingTests],
    ["missingEdgeCases", input.missingEdgeCases],
    ["missingIntegrationWork", input.missingIntegrationWork],
    ["missingCleanupRefactor", input.missingCleanupRefactor],
    ["missingPlanFixes", input.missingPlanFixes],
  ];
  for (const [name, arr] of missingBuckets) {
    if (arr.length > 0) reasons.push(`${name} not empty`);
  }
  if (input.shortcutsOrStubs.length > 0) {
    reasons.push("shortcutsOrStubs not empty");
  }

  // Automated stub signals: for non-bootstrap slices, every signal must have a
  // matching justification, or the verdict must be NOT_COMPLETE.
  if (!isBootstrap && automatedStubSignals.length > 0) {
    const justifiedIndexes = new Set(input.stubJustifications.map((j) => j.signalIndex));
    const unjustified = automatedStubSignals.filter((_, i) => !justifiedIndexes.has(i));
    if (unjustified.length > 0) {
      reasons.push(`${unjustified.length} automated stub signal(s) unjustified`);
    }
  }

  const mustBeNotComplete = reasons.length > 0;
  if (input.verdict === "COMPLETE" && mustBeNotComplete) {
    return JSON.stringify({
      error: `Verdict COMPLETE rejected. ${reasons.join("; ")}.`,
      automatedStubSignals,
      planCompliance,
      requiredVerdict: "NOT_COMPLETE",
    });
  }
  if (input.verdict === "NOT_COMPLETE" && input.nextActions.length === 0) {
    return JSON.stringify({
      error: "NOT_COMPLETE verdict requires at least one entry in nextActions.",
    });
  }

  // 5. Persist
  const review: Omit<SliceCompletionReview, "loop" | "createdAt"> = {
    acCoverage: input.acCoverage as SliceAcCoverageEntry[],
    testCoverageQuality: input.testCoverageQuality,
    planCompliance,
    missingFunctionality: input.missingFunctionality,
    missingTests: input.missingTests,
    missingEdgeCases: input.missingEdgeCases,
    missingIntegrationWork: input.missingIntegrationWork,
    missingCleanupRefactor: input.missingCleanupRefactor,
    missingPlanFixes: input.missingPlanFixes,
    shortcutsOrStubs: input.shortcutsOrStubs,
    automatedStubSignals,
    stubJustifications: input.stubJustifications,
    verdict: input.verdict,
    nextActions: input.nextActions,
    ...(isBootstrap ? { bootstrapExempt: true } : {}),
  };

  try {
    const updated = sm.recordSliceCompletionReview(input.sliceId, review);
    const fresh = updated.slices.find((s) => s.id === input.sliceId)!;
    const loop = (fresh.completionReviews ?? []).length;
    return JSON.stringify({
      success: true,
      sliceId: input.sliceId,
      loop,
      verdict: input.verdict,
      planCompliance,
      automatedStubSignals,
      nextStep:
        input.verdict === "COMPLETE"
          ? "a2p_update_slice status=done — every gate has verdicted COMPLETE against fresh evidence."
          : "a2p_update_slice status=completion_fix — A2P will refresh the baseline. Fix the gaps (add tests first, then code), a2p_verify_test_first, then resume red→green→refactor→sast→completion_review.",
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
