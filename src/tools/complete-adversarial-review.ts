import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import { HardeningAreaIdSchema } from "../state/validators.js";
import type {
  ProjectState,
  HardeningAreaId,
  SASTFinding,
  TechStack,
  ShakeBreakCategory,
} from "../state/types.js";

export const completeAdversarialReviewSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  findingsRecorded: z.number().int().min(0).describe("Number of adversarial-review findings recorded via a2p_record_finding (0 if codebase is too small/trivial)"),
  note: z.string().optional().describe("Brief summary of the adversarial review (e.g. 'reviewed auth, payments, API routes — 2 findings recorded')"),
  focusArea: HardeningAreaIdSchema.optional().describe("Hardening area if this was a focused round"),
});

export type CompleteAdversarialReviewInput = z.infer<typeof completeAdversarialReviewSchema>;

const MAX_ROUND_HISTORY_IN_OUTPUT = 5;

// --- Hardening Areas ---

interface RelevanceContext {
  techStack: TechStack;
  features: string[];
  sliceDescriptions: string[];
  hasAuth: boolean;
  hasUpload: boolean;
  hasWebhooks: boolean;
  hasPublicAPI: boolean;
  hasMultiTenant: boolean;
  hasPayments: boolean;
  hasStatefulFlows: boolean;
}

interface RelevanceResult {
  relevant: boolean;
  reason: string;
}

interface HardeningArea {
  id: HardeningAreaId;
  name: string;
  domains: number[];
  relevantWhen: (ctx: RelevanceContext) => RelevanceResult;
  shakeBreakCategories: ShakeBreakCategory[];
  description: string;
}

export function buildRelevanceContext(state: ProjectState): RelevanceContext {
  const features = state.architecture?.features ?? [];
  const sliceDescriptions = state.slices.map(s =>
    `${s.name} ${s.description} ${s.acceptanceCriteria.join(" ")}`
  );
  const allText = [...features, ...sliceDescriptions].join(" ").toLowerCase();
  const tech = state.architecture?.techStack;

  return {
    techStack: tech ?? { language: "", framework: "", database: null, frontend: null, hosting: null, other: [] },
    features,
    sliceDescriptions,
    hasAuth: /auth|login|session|jwt|password|signup|register|oauth|keycloak|clerk/i.test(allText),
    hasUpload: /upload|file.*upload|image.*upload|media|attachment/i.test(allText),
    hasWebhooks: /webhook|callback.*url|stripe.*webhook|event.*endpoint/i.test(allText),
    hasPublicAPI: /api|endpoint|rest|graphql|public.*route/i.test(allText),
    hasMultiTenant: /tenant|multi.?tenant|organization|workspace|team.*isol/i.test(allText),
    hasPayments: /payment|stripe|billing|order|cart|checkout|invoice|subscription/i.test(allText),
    hasStatefulFlows: /order|workflow|state.?machine|inventory|booking|reservation|approval|pipeline/i.test(allText),
  };
}

const HARDENING_AREAS: HardeningArea[] = [
  {
    id: "auth-session",
    name: "Authentication & Session Security",
    domains: [17, 18, 19, 2, 3],
    relevantWhen: (ctx) => ({
      relevant: ctx.hasAuth || ctx.hasPublicAPI,
      reason: ctx.hasAuth
        ? "Auth + Sessions erkannt (login, JWT, password reset)"
        : "Public API erkannt — Auth-Pruefung empfohlen",
    }),
    shakeBreakCategories: ["auth_idor", "token_session"],
    description: "Session handling, JWT, password reset, login flows",
  },
  {
    id: "data-access",
    name: "Data Access & Tenant Isolation",
    domains: [4, 16, 24],
    relevantWhen: (ctx) => ({
      relevant: !!ctx.techStack.database,
      reason: ctx.hasMultiTenant
        ? `Multi-Tenant + Datenbank erkannt (${ctx.techStack.database}) — Row-Level Isolation noetig`
        : `Datenbank erkannt (${ctx.techStack.database}) — Ownership-Checks relevant`,
    }),
    shakeBreakCategories: ["auth_idor"],
    description: "Ownership checks, tenant isolation, soft-delete access",
  },
  {
    id: "business-logic",
    name: "Business Logic & State Manipulation",
    domains: [1, 7, 8],
    relevantWhen: (ctx) => ({
      relevant: ctx.hasPayments || ctx.hasStatefulFlows,
      reason: ctx.hasPayments
        ? "Payments erkannt — Preismanipulation, Double-Spending relevant"
        : "Stateful Flows erkannt (orders, checkout, workflows)",
    }),
    shakeBreakCategories: ["business_logic", "race_conditions", "state_manipulation"],
    description: "Price manipulation, state machines, race conditions, DoS",
  },
  {
    id: "input-output",
    name: "Input Validation & Output Encoding",
    domains: [9, 10, 11, 12, 13],
    relevantWhen: (ctx) => ({
      relevant: !!ctx.techStack.frontend || ctx.hasPublicAPI,
      reason: ctx.techStack.frontend
        ? `Frontend erkannt (${ctx.techStack.frontend}) — XSS, CSRF relevant`
        : "Public API erkannt — Input Validation noetig",
    }),
    shakeBreakCategories: ["injection_runtime"],
    description: "XSS, CSRF, deserialization, IDOR, cookie flags, CORS",
  },
  {
    id: "api-surface",
    name: "API Surface & Endpoint Security",
    domains: [2, 22, 25],
    relevantWhen: (ctx) => ({
      relevant: ctx.hasPublicAPI,
      reason: "Public API-Endpunkte erkannt — Auth, Rate-Limiting, Exposure-Pruefung noetig",
    }),
    shakeBreakCategories: ["auth_idor", "injection_runtime"],
    description: "Missing auth, rate limiting, internal endpoint exposure, cache control",
  },
  {
    id: "external-integration",
    name: "External Integration Security",
    domains: [6, 20, 21],
    relevantWhen: (ctx) => ({
      relevant: ctx.hasUpload || ctx.hasWebhooks,
      reason: [
        ctx.hasUpload ? "File Upload" : null,
        ctx.hasWebhooks ? "Webhooks" : null,
      ].filter(Boolean).join(" + ") + " in Features erkannt",
    }),
    shakeBreakCategories: ["file_upload", "webhook_callback"],
    description: "File upload, webhooks, SSRF, trust boundaries",
  },
  {
    id: "infra-secrets",
    name: "Infrastructure & Secrets Management",
    domains: [14, 15, 23],
    relevantWhen: (ctx) => ({
      relevant: !!ctx.techStack.database || !!ctx.techStack.hosting,
      reason: [
        ctx.techStack.database ? ctx.techStack.database : null,
        ctx.techStack.hosting ? ctx.techStack.hosting : null,
      ].filter(Boolean).join(" + ") + " — DB-Connection + Deployment Security",
    }),
    shakeBreakCategories: [],
    description: "Deployment config, secrets, DB connection, backup security",
  },
  {
    id: "vuln-chaining",
    name: "Vulnerability Chaining & Multi-Step Exploits",
    domains: [5],
    relevantWhen: (_ctx) => ({
      relevant: true,
      reason: "Chaining wird ab Runde 2+ relevant — Low-Severity Issues kombinieren",
    }),
    shakeBreakCategories: ["business_logic", "state_manipulation"],
    description: "Combining low-severity issues into high-impact exploits",
  },
];

export function computeCoverageEstimate(
  areaId: HardeningAreaId,
  allFindings: SASTFinding[],
  focusHistory: HardeningAreaId[],
): number {
  const areaFindings = allFindings.filter(f => f.domains?.includes(areaId));
  const wasFocused = focusHistory.includes(areaId);
  return Math.min(100, areaFindings.length * 20 + (wasFocused ? 40 : 0));
}

interface HardeningRecommendation {
  id: HardeningAreaId;
  name: string;
  coverageEstimate: number;
  reason: string;
  shakeBreakCategories: ShakeBreakCategory[];
}

export function computeHardeningRecommendations(state: ProjectState): HardeningRecommendation[] {
  if (!state.architecture) return [];

  const ctx = buildRelevanceContext(state);

  // Use persisted securityOverview.coverageByArea when available (includes whitebox findings).
  // Fall back to on-the-fly computation for states without securityOverview.
  const persistedCoverage = state.securityOverview?.coverageByArea;

  let getCoverage: (areaId: HardeningAreaId) => number;
  if (persistedCoverage) {
    getCoverage = (areaId) => persistedCoverage.find(c => c.id === areaId)?.coverageEstimate ?? 0;
  } else {
    const allFindings: SASTFinding[] = [
      ...state.slices.flatMap(s => s.sastFindings),
      ...state.projectFindings,
    ];
    const roundHistory = state.adversarialReviewState?.roundHistory ?? [];
    const focusHistory: HardeningAreaId[] = roundHistory
      .filter((r): r is typeof r & { focusArea: HardeningAreaId } => !!r.focusArea)
      .map(r => r.focusArea);
    getCoverage = (areaId) => computeCoverageEstimate(areaId, allFindings, focusHistory);
  }

  const recommendations: HardeningRecommendation[] = [];

  for (const area of HARDENING_AREAS) {
    const relevance = area.relevantWhen(ctx);
    if (!relevance.relevant) continue;

    const coverage = getCoverage(area.id);
    if (coverage >= 100) continue;

    recommendations.push({
      id: area.id,
      name: area.name,
      coverageEstimate: coverage,
      reason: relevance.reason,
      shakeBreakCategories: area.shakeBreakCategories,
    });
  }

  // Sort: lowest coverage first
  recommendations.sort((a, b) => a.coverageEstimate - b.coverageEstimate);

  return recommendations;
}

export function handleCompleteAdversarialReview(input: CompleteAdversarialReviewInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  try {
    const state = sm.completeAdversarialReview(input.findingsRecorded, input.note, input.focusArea);
    const reviewState = state.adversarialReviewState!;

    // Aggregate all adversarial-review findings from all slices + project-level for deduplication
    const previousFindings = [
      ...state.slices.flatMap(s => s.sastFindings),
      ...state.projectFindings,
    ].filter(f => f.tool === "adversarial-review")
      .map(f => ({
        title: f.title,
        file: f.file,
        severity: f.severity,
        confidence: f.confidence ?? "legacy" as const,
        domains: f.domains ?? [],
        round: findRoundForFinding(f.id, reviewState),
      }));

    // Compute confidence stats
    const confidenceStats = {
      evidenceBacked: previousFindings.filter(f => f.confidence === "evidence-backed").length,
      hypothesis: previousFindings.filter(f => f.confidence === "hypothesis").length,
      hardToVerify: previousFindings.filter(f => f.confidence === "hard-to-verify").length,
      legacy: previousFindings.filter(f => f.confidence === "legacy").length,
    };

    // Warn if majority of high/critical are hypotheses
    const highCritical = previousFindings.filter(f => f.severity === "critical" || f.severity === "high");
    const hypothesisHighCritical = highCritical.filter(f => f.confidence === "hypothesis");
    const confidenceWarning = highCritical.length > 0 && hypothesisHighCritical.length > highCritical.length / 2
      ? `Warning: ${hypothesisHighCritical.length}/${highCritical.length} high/critical findings are hypotheses. Consider re-examining with code evidence.`
      : undefined;

    // Round history for output: last N rounds fully, older as summary
    const fullHistory = reviewState.roundHistory;
    let roundHistory: unknown[];
    let olderSummary: string | undefined;
    if (fullHistory.length > MAX_ROUND_HISTORY_IN_OUTPUT) {
      const older = fullHistory.slice(0, fullHistory.length - MAX_ROUND_HISTORY_IN_OUTPUT);
      const olderFindings = older.reduce((sum, r) => sum + r.findingsRecorded, 0);
      olderSummary = `... and ${older.length} earlier round(s) with ${olderFindings} finding(s)`;
      roundHistory = fullHistory.slice(-MAX_ROUND_HISTORY_IN_OUTPUT);
    } else {
      roundHistory = fullHistory;
    }

    // Compute recommendations
    const recommendations = computeHardeningRecommendations(state);

    // Security overview from state (persisted)
    const securityOverview = state.securityOverview;

    // Compute security activity summary
    const whiteboxCount = state.whiteboxResults.length;
    const shakeBreakCount = state.shakeBreakResults.length;
    const activeVerificationCount = state.activeVerificationResults.length;
    const relevantAreasCount = recommendations.length;
    const coveredAreasCount = securityOverview?.coverageByArea.filter(c => c.coverageEstimate > 0).length ?? 0;
    const totalAreas = securityOverview?.coverageByArea.length ?? 8;

    // Build hint with recommendations and modes
    let hint: string;
    if (recommendations.length === 0) {
      hint = `Adversarial Review Runde ${reviewState.round} abgeschlossen. ` +
        `${input.findingsRecorded} neue Finding(s), ${reviewState.totalFindingsRecorded} insgesamt.\n\n` +
        `Alle relevanten Bereiche haben ausreichende Coverage. Weiter zu Phase 2 (Active Verification).`;
    } else {
      const recLines = recommendations.slice(0, 3).map((r, i) => {
        const coverageLabel = r.coverageEstimate === 0
          ? "noch nicht geprueft"
          : `~${r.coverageEstimate}% geprueft`;
        const sbLine = r.shakeBreakCategories.length > 0
          ? `\n   [Shake & Break verfuegbar: ${r.shakeBreakCategories.join(", ")}]`
          : "";
        return `${i + 1}. **${r.name}** (${coverageLabel})\n   → Relevant weil ${r.reason}${sbLine}`;
      }).join("\n\n");

      hint = `Adversarial Review Runde ${reviewState.round} abgeschlossen. ` +
        `${input.findingsRecorded} neue Finding(s), ${reviewState.totalFindingsRecorded} insgesamt.\n\n` +
        `Security-Fortschritt (kumulativ ueber ${reviewState.round} Runde(n)):\n` +
        `- ${whiteboxCount} Whitebox-Audit(s), ${shakeBreakCount} Shake & Break Session(s), ${activeVerificationCount} Active Verification(s)\n` +
        `- ${coveredAreasCount} von ${totalAreas} Bereichen teilweise geprueft\n\n` +
        `Empfohlene Hardening-Bereiche:\n${recLines}\n\n` +
        `Optionen:\n` +
        `→ Bereich waehlen (z.B. "auth-session") fuer fokussiertes Hardening\n` +
        `→ "alles" fuer eine weitere volle Runde (alle 25 Domaenen)\n` +
        `→ "shake-break" fuer Runtime-Tests der empfohlenen Bereiche`;
    }

    return JSON.stringify({
      success: true,
      currentRound: reviewState.round,
      thisRoundFindings: input.findingsRecorded,
      totalFindingsRecorded: reviewState.totalFindingsRecorded,
      completedAt: reviewState.completedAt,
      ...(input.focusArea ? { focusArea: input.focusArea } : {}),
      previousFindings,
      confidenceStats,
      ...(confidenceWarning ? { confidenceWarning } : {}),
      roundHistory,
      ...(olderSummary ? { olderRoundsSummary: olderSummary } : {}),
      securityOverview,
      recommendations: recommendations.slice(0, 5),
      note: input.note ?? null,
      hint,
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

/** Match a finding to its round by comparing finding ID patterns or falling back to current round */
function findRoundForFinding(findingId: string, reviewState: { round: number; roundHistory: Array<{ round: number; completedAt: string }> }): number {
  // Findings don't have timestamps, so we use a simple heuristic:
  // If there's only one round so far, all findings belong to it.
  // Otherwise, return the current round as default (findings just recorded belong to current round).
  // This is a best-effort — the primary dedup is by title+file, not by round.
  return reviewState.round;
}
