import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { StateManager } from "../../src/state/state-manager.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { handleVerifyTestFirst } from "../../src/tools/verify-test-first.js";
import { handleCompletionReview } from "../../src/tools/completion-review.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { computeRequiredConcerns } from "../../src/utils/systems-applicability.js";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";
import type { SystemsConcernId, ConcernRequirementEntry, ConcernTestEntry, ConcernPlanEntry, ConcernReviewEntry } from "../../src/state/types.js";

/**
 * A2P v2 integration test — realistic multi-concern stateful slice.
 *
 * Simulates the slice archetype the external plan called out as the
 * acid test: a multi-tenant webhook-driven stateful flow with per-tenant
 * idempotency and external-boundary observability. The slice's metadata
 * triggers SEVEN concerns simultaneously:
 *   - concurrency_idempotency (integration + webhook + stripe + retry)
 *   - api_contracts (integration type)
 *   - observability (integration + backend platform)
 *   - auth_permissions ("tenant" keyword)
 *   - security (webhook/token/upload)
 *   - failure_modes (piggyback — present whenever others fire)
 *   - distributed_state (architecture.systems.distributedStateModel != single-process)
 *
 * We walk the slice through the full v2 flow and assert:
 *   1. computeRequiredConcerns returns exactly those 7 concerns
 *   2. Omitting any concern at any of 4 stages produces a precise error
 *   3. With all 7 concerns present, the slice reaches DONE cleanly
 */

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

// Concerns this slice should trigger — verified in the first test.
// Anything the applicability rules flag must appear here; extras are OK
// as long as we supply evidence for them.
const CORE_EXPECTED: SystemsConcernId[] = [
  "concurrency_idempotency",
  "api_contracts",
  "observability",
  "auth_permissions",
  "security",
  "failure_modes",
  "distributed_state",
];

function buildConcernEntries(concerns: SystemsConcernId[]): {
  requirements: ConcernRequirementEntry[];
  tests: ConcernTestEntry[];
  plans: ConcernPlanEntry[];
  reviews: ConcernReviewEntry[];
} {
  const requirements: ConcernRequirementEntry[] = concerns.map((concern) => ({
    concern,
    applicability: "required",
    justification: "",
    requirement: `Concrete requirement for ${concern}`,
    linkedAcIds: ["AC1"],
  }));
  const tests: ConcernTestEntry[] = concerns.map((concern) => ({
    concern,
    testNames: ["t1"],
    evidenceType: concern === "api_contracts" ? "contract" : concern === "security" ? "negative" : "positive",
    rationale: `Tests that cover ${concern} obligations`,
  }));
  const plans: ConcernPlanEntry[] = concerns.map((concern) => ({
    concern,
    approach: `Approach for ${concern}`,
    filesTouched: ["src/x.ts"],
    rollbackStrategy: concern === "migrations" ? "down migration" : null,
  }));
  const reviews: ConcernReviewEntry[] = concerns.map((concern) => ({
    concern,
    verdict: "satisfied",
    evidence: `src/x.ts:10 covers ${concern}`,
    shortfall: "",
  }));
  return { requirements, tests, plans, reviews };
}

function setupProjectForWebhookSlice(dir: string): void {
  handleInitProject({ projectPath: dir, projectName: "webhook-test" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Webhook Project",
    description: "A multi-tenant webhook-driven order service",
    language: "TypeScript",
    framework: "Express",
    database: "PostgreSQL",
    features: ["Stripe webhook handling", "Per-tenant idempotency"],
    dataModel: "orders, webhook_deliveries",
    apiDesign: "REST with Stripe webhook intake",
    platform: "backend-only",
    systems: {
      domainEntities: [
        { name: "Order", purpose: "payment record", identity: "uuid", ownership: "multi-tenant", lifecycle: "created on checkout" },
      ],
      invariants: [
        { id: "INV-1", statement: "no order is double-processed for the same webhook delivery", scope: "per-entity", enforcedBy: "idempotency table" },
      ],
      stateMachines: [],
      apiContracts: [],
      permissionsModel: { tenancy: "hard", roles: [], boundaries: ["tenant scope on every query"] },
      failureModel: [],
      migrationPolicy: { stateVersionCurrent: 1, forwardStrategy: "explicit-script", backwardCompatPromise: "additive", migrationTests: [] },
      observabilityModel: {
        logging: "structured-json",
        logCorrelationKey: "requestId",
        metricsBackend: "datadog",
        tracingBackend: "datadog",
        requiredEventsPerSlice: ["webhook_received", "order_state"],
      },
      performanceBudgets: [],
      cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
      distributedStateModel: { topology: "multi-process", consistency: "eventual", coordinationMechanism: "postgres row lock" },
      securityAssumptions: [],
    },
  });
}

function addWebhookSlice(sm: StateManager): void {
  sm.setSlices([
    {
      id: "s1",
      name: "Stripe webhook retry queue with per-tenant idempotency",
      description:
        "Process Stripe webhook callbacks with retry logic; per-tenant idempotency tokens and audit logging. As a tenant admin, I can see webhook delivery status.",
      acceptanceCriteria: ["AC1"],
      testStrategy: "integration with a mocked Stripe and real Postgres",
      dependencies: [],
      status: "pending",
      files: [],
      testResults: [],
      sastFindings: [],
      type: "integration",
    },
  ]);
}

describe("A2P v2 end-to-end — multi-tenant webhook stateful slice", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-v2-e2e-webhook");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@e.com"]);
    git(dir, ["config", "user.name", "T"]);
    git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);
  });

  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("applicability rules detect at least the core 7 concerns for this slice", () => {
    setupProjectForWebhookSlice(dir);
    const sm = new StateManager(dir);
    addWebhookSlice(sm);
    const slice = sm.read().slices[0];
    const architecture = sm.read().architecture;
    const required = computeRequiredConcerns(slice, architecture);
    for (const concern of CORE_EXPECTED) {
      expect(required.has(concern)).toBe(true);
    }
  });

  function computedConcerns(sm: StateManager): SystemsConcernId[] {
    const state = sm.read();
    return [...computeRequiredConcerns(state.slices[0], state.architecture)];
  }

  it("omitting a single concern from requirementsHardening blocks ready_for_red with precise error", () => {
    setupProjectForWebhookSlice(dir);
    const sm = new StateManager(dir);
    addWebhookSlice(sm);
    const concerns = computedConcerns(sm);
    const { requirements, tests, plans } = buildConcernEntries(concerns);
    // Remove one concern from requirements only
    const shortReqs = requirements.filter((r) => r.concern !== "concurrency_idempotency");

    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: shortReqs,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"],
      edgeCases: [], regressions: [],
      additionalConcerns: ["real integration with postgres and stripe fixture"],
      doneMetric: "dm",
      systemsConcernTests: tests,
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts", "tests/x.test.ts"], interfacesToChange: ["handleStripeWebhook"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: plans,
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /systems concern "concurrency_idempotency" is REQUIRED.*missing from requirementsHardening/,
    );
  });

  it("omitting a concern from planHardening is caught at pre-RED", () => {
    setupProjectForWebhookSlice(dir);
    const sm = new StateManager(dir);
    addWebhookSlice(sm);
    const concerns = computedConcerns(sm);
    const { requirements, tests, plans } = buildConcernEntries(concerns);
    const shortPlans = plans.filter((p) => p.concern !== "observability");

    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: requirements,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"],
      edgeCases: [], regressions: [],
      additionalConcerns: ["real integration with postgres and stripe fixture"],
      doneMetric: "dm",
      systemsConcernTests: tests,
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts", "tests/x.test.ts"], interfacesToChange: ["handleStripeWebhook"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: shortPlans,
      },
    });

    expect(() => sm.setSliceStatus("s1", "ready_for_red")).toThrow(
      /systems concern "observability" is REQUIRED.*systemsConcernPlans/,
    );
  });

  it("unsatisfied verdict on a concern blocks sast → done with a precise error", () => {
    setupProjectForWebhookSlice(dir);
    const sm = new StateManager(dir);
    addWebhookSlice(sm);
    const concerns = computedConcerns(sm);
    const { requirements, tests, plans, reviews } = buildConcernEntries(concerns);

    // Full hardening
    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: requirements,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"],
      edgeCases: [], regressions: [],
      additionalConcerns: ["real integration with postgres and stripe fixture"],
      doneMetric: "dm",
      systemsConcernTests: tests,
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts", "tests/x.test.ts"], interfacesToChange: ["handleStripeWebhook"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: plans,
      },
    });
    // Walk to sast
    sm.setSliceStatus("s1", "ready_for_red");
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// test\n");
    handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 1" });
    sm.setSliceStatus("s1", "red");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const handleStripeWebhook = () => 1;\n");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });

    // Record review with ONE concern unsatisfied
    const brokenReviews = reviews.map((r) =>
      r.concern === "auth_permissions"
        ? { ...r, verdict: "unsatisfied" as const, shortfall: "missing negative test for cross-tenant access" }
        : r,
    );
    handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
      systemsConcernReviews: brokenReviews,
    });

    // planCompliance verdict takes precedence in error ordering only if drift is detected;
    // here implementation matches expected files, so planCompliance="ok" and
    // the systems-concern check fires.
    expect(() => sm.setSliceStatus("s1", "done")).toThrow(
      /systems concern "auth_permissions" verdicted "unsatisfied".*cross-tenant/,
    );
  });

  it("with every required concern present and satisfied, the slice reaches DONE cleanly", () => {
    setupProjectForWebhookSlice(dir);
    const sm = new StateManager(dir);
    addWebhookSlice(sm);
    const concerns = computedConcerns(sm);
    const { requirements, tests, plans, reviews } = buildConcernEntries(concerns);

    handleHardenRequirements({
      projectPath: dir, sliceId: "s1",
      goal: "g", nonGoals: [], affectedComponents: ["src/x.ts"],
      assumptions: [], risks: [], finalAcceptanceCriteria: ["AC1"],
      systemsConcerns: requirements,
    });
    handleHardenTests({
      projectPath: dir, sliceId: "s1",
      acToTestMap: [{ ac: "AC1", tests: ["t1"], rationale: "r" }],
      positiveCases: ["p"], negativeCases: ["n"],
      edgeCases: [], regressions: [],
      additionalConcerns: ["real integration with postgres and stripe fixture"],
      doneMetric: "dm",
      systemsConcernTests: tests,
    });
    handleHardenPlan({
      projectPath: dir, sliceId: "s1", round: 1, initialPlan: "p", critique: "c", revisedPlan: "r",
      improvementsFound: false, finalize: true,
      finalPlan: {
        touchedAreas: ["src"], expectedFiles: ["src/x.ts", "tests/x.test.ts"], interfacesToChange: ["handleStripeWebhook"],
        invariantsToPreserve: [], risks: [], narrative: "n",
        systemsConcernPlans: plans,
      },
    });
    sm.setSliceStatus("s1", "ready_for_red");
    mkdirSync(join(dir, "tests"), { recursive: true });
    writeFileSync(join(dir, "tests", "x.test.ts"), "// test\n");
    handleVerifyTestFirst({ projectPath: dir, sliceId: "s1", testCommand: "exit 1" });
    sm.setSliceStatus("s1", "red");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "x.ts"), "export const handleStripeWebhook = () => 1;\n");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });
    sm.setSliceStatus("s1", "green");
    sm.setSliceStatus("s1", "refactor");
    sm.markSastRun("s1");
    sm.setSliceStatus("s1", "sast");
    sm.addTestResult("s1", { timestamp: new Date().toISOString(), command: "t", exitCode: 0, passed: 1, failed: 0, skipped: 0, output: "pass" });

    const reviewResult = parse(handleCompletionReview({
      projectPath: dir, sliceId: "s1",
      acCoverage: [{ ac: "AC1", status: "met", evidence: "tests cover it" }],
      testCoverageQuality: "deep",
      missingFunctionality: [], missingTests: [], missingEdgeCases: [],
      missingIntegrationWork: [], missingCleanupRefactor: [], missingPlanFixes: [],
      shortcutsOrStubs: [], stubJustifications: [],
      verdict: "COMPLETE", nextActions: [],
      systemsConcernReviews: reviews,
    }));
    expect(reviewResult.verdict).toBe("COMPLETE");

    const final = sm.setSliceStatus("s1", "done");
    expect(final.slices[0].status).toBe("done");
    // Persisted evidence is intact
    const persisted = final.slices[0];
    const n = concerns.length;
    expect(persisted.requirementsHardening?.systemsConcerns?.length).toBe(n);
    expect(persisted.testHardening?.systemsConcernTests?.length).toBe(n);
    expect(persisted.planHardening?.finalPlan.systemsConcernPlans?.length).toBe(n);
    expect(persisted.completionReviews?.[0].systemsConcernReviews?.length).toBe(n);
  });
});
