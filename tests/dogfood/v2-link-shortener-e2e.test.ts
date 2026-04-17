/**
 * Real dogfood validation — A2P v2 end-to-end on a link-shortener fixture.
 *
 * Drives the REAL handler functions (same ones the MCP server invokes) to
 * walk two realistic slices through the complete v2 flow. Each step is
 * asserted; any unexpected failure is a dogfood finding.
 *
 * Findings from earlier iterations are encoded in the code comments and
 * collected in dogfood/REPORT.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { StateManager } from "../../src/state/state-manager.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleSetPhase } from "../../src/tools/set-phase.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleHardenRequirements } from "../../src/tools/harden-requirements.js";
import { handleHardenTests } from "../../src/tools/harden-tests.js";
import { handleHardenPlan } from "../../src/tools/harden-plan.js";
import { handleVerifyTestFirst } from "../../src/tools/verify-test-first.js";
import { handleCompletionReview } from "../../src/tools/completion-review.js";
import { makeTmpDir, cleanTmpDir, parse } from "../helpers/setup.js";
import { computeRequiredConcerns } from "../../src/utils/systems-applicability.js";
import type { SystemsConcernId } from "../../src/state/types.js";

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function expectOk(resultJson: string, label: string): any {
  const r = parse(resultJson);
  if (r.error) {
    throw new Error(`${label} failed: ${r.error}`);
  }
  return r;
}

let dir: string;
let sm: StateManager;

beforeAll(() => {
  dir = makeTmpDir("a2p-v2-dogfood");
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dogfood@test"]);
  git(dir, ["config", "user.name", "dogfood"]);
  git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);

  expectOk(
    handleInitProject({ projectPath: dir, projectName: "link-shortener" }),
    "handleInitProject",
  );

  sm = new StateManager(dir);

  expectOk(
    handleSetArchitecture({
      projectPath: dir,
      name: "Link Shortener",
      description:
        "Multi-tenant link shortener with per-user rate limit, idempotency, reserved-word blocklist, and audit log. Every request must be authenticated and scoped by userId.",
      language: "TypeScript",
      framework: "Express",
      database: "PostgreSQL",
      features: ["Create short links", "Click tracking", "Per-user stats", "Reserved-word blocklist"],
      dataModel: "User(id, tier), ShortLink(id, userId, url, code, createdAt, deletedAt), Click(id, linkId, at)",
      apiDesign: "REST: POST /shorten, GET /:code (redirect), GET /stats/:code",
      platform: "backend-only",
      systems: {
        domainEntities: [
          { name: "User", purpose: "Account", identity: "uuid", ownership: "multi-tenant", lifecycle: "signup → active" },
          { name: "ShortLink", purpose: "URL alias", identity: "code (base36)", ownership: "multi-tenant", lifecycle: "created → clicked* → soft-deleted" },
        ],
        invariants: [
          { id: "INV-1", statement: "No two active links share the same code", scope: "global", enforcedBy: "unique index + collision retry" },
          { id: "INV-2", statement: "Stats are visible only to the link's owner", scope: "per-entity", enforcedBy: "ownership check in handler" },
        ],
        stateMachines: [],
        apiContracts: [
          { id: "POST /shorten", kind: "http", inputShape: "{ url, idempotencyKey? }", outputShape: "{ code } | { error, code }", errorModes: ["400 invalid url", "400 reserved word", "429 rate limit"], versioning: "additive-only" },
          { id: "GET /stats/:code", kind: "http", inputShape: "path", outputShape: "{ clicks } | { error }", errorModes: ["404 not found (also cross-user)"], versioning: "additive-only" },
        ],
        permissionsModel: { tenancy: "hard", roles: [{ name: "user", grants: ["own-link stats"], mustNot: ["other-user stats"] }], boundaries: ["owner check on /stats"] },
        failureModel: [
          { id: "FM-1", trigger: "code collision on generation", blastRadius: "single request", detection: "unique-index violation", recovery: "retry with fresh code (bounded)" },
        ],
        migrationPolicy: { stateVersionCurrent: 1, forwardStrategy: "explicit-script", backwardCompatPromise: "additive", migrationTests: [] },
        observabilityModel: {
          logging: "structured-json",
          logCorrelationKey: "requestId",
          metricsBackend: null,
          tracingBackend: null,
          requiredEventsPerSlice: ["link_created", "stats_accessed", "rate_limit_hit"],
        },
        performanceBudgets: [{ surface: "POST /shorten", p50Ms: 50, p95Ms: 200 }],
        cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
        distributedStateModel: { topology: "single-process", consistency: "single-writer", coordinationMechanism: null },
        securityAssumptions: [
          { id: "SA-1", assumption: "User IDs from auth middleware are trusted", invalidatedBy: "auth bypass" },
        ],
      },
    }),
    "handleSetArchitecture",
  );

  expectOk(handleSetPhase({ projectPath: dir, phase: "planning" }), "setPhase planning");

  expectOk(
    handleCreateBuildPlan({
      projectPath: dir,
      slices: [
        {
          id: "s01-shorten",
          name: "POST /shorten — authenticated create",
          description:
            "Authenticated POST /shorten endpoint. Each request carries a userId token. Accepts a URL, generates a base36 code, stores per-user with per-user idempotencyKey scoping. Rate limit 5/min per user. Reject reserved words. Write audit entry on success and failure. As a user I can create a short link.",
          acceptanceCriteria: [
            "As an authenticated user I can POST a valid URL and receive a code",
            "Repeated idempotencyKey returns the original code (first-write-wins)",
            "Reserved word in code request returns 400 with typed error",
            "11th create in 60s for same user returns 429",
            "Audit log records create attempts, success AND failure",
          ],
          testStrategy: "unit tests against createLink() with fake clock + mock id generator; real rate-limit test against injected clock",
          dependencies: [],
          type: "integration",
          systemsClassification: [
            "auth_permissions",
            "concurrency_idempotency",
            "security",
            "api_contracts",
            "observability",
            "performance_under_load",
          ],
        },
        {
          id: "s02-stats",
          name: "GET /stats/:code — owner-only analytics",
          description:
            "Returns click count for the link identified by code. Only the link's owner gets stats; cross-user request returns 404 (existence-hiding). Record audit entry. Authenticated endpoint.",
          acceptanceCriteria: [
            "As the owner I GET /stats/:code and receive { clicks: N }",
            "A non-owner GETting /stats/:code receives 404 (not 403 — existence leak)",
            "A missing code returns 404",
            "Audit log records stats access attempts, success AND failure",
          ],
          testStrategy: "unit tests against getStats() with seeded link fixtures",
          dependencies: ["s01-shorten"],
          type: "integration",
          systemsClassification: ["auth_permissions", "api_contracts", "observability"],
        },
      ],
    }),
    "handleCreateBuildPlan",
  );

  expectOk(handleSetPhase({ projectPath: dir, phase: "building" }), "setPhase building");
});

afterAll(() => {
  cleanTmpDir(dir);
});

function conc(sliceId: string): SystemsConcernId[] {
  const state = sm.read();
  return [...computeRequiredConcerns(state.slices.find((s) => s.id === sliceId)!, state.architecture)];
}

function reqEntry(concern: SystemsConcernId, ac: string[]) {
  return {
    concern,
    applicability: "required" as const,
    justification: "",
    requirement: `Requirement for ${concern}`,
    linkedAcIds: [ac[0]],
  };
}

function testEntry(concern: SystemsConcernId) {
  return {
    concern,
    testNames: [`test_${concern}`],
    evidenceType:
      concern === "security" ? ("negative" as const) :
      concern === "api_contracts" ? ("contract" as const) :
      ("positive" as const),
    rationale: `Covers ${concern}`,
  };
}

function planEntry(concern: SystemsConcernId) {
  return {
    concern,
    approach: `Approach for ${concern}`,
    filesTouched: ["src/shorten.ts"],
    rollbackStrategy: null,
  };
}

function reviewEntry(concern: SystemsConcernId) {
  return {
    concern,
    verdict: "satisfied" as const,
    evidence: `src/x.ts + tests/x.test.ts cover ${concern}`,
    shortfall: "",
  };
}

function walkSliceThrough(
  sliceId: string,
  produceTestFile: string,
  produceSrcFile: string,
  exportedSymbol: string,
): void {
  // Create dirs up front so the baseline capture sees them as empty.
  mkdirSync(join(dir, "tests"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  const state0 = sm.read();
  const slice0 = state0.slices.find((s) => s.id === sliceId)!;
  const concerns = conc(sliceId);
  const ac = slice0.acceptanceCriteria;

  // harden requirements
  expectOk(
    handleHardenRequirements({
      projectPath: dir,
      sliceId,
      goal: `Implement ${slice0.name}`,
      nonGoals: [],
      affectedComponents: [produceSrcFile],
      assumptions: [],
      risks: [],
      finalAcceptanceCriteria: ac,
      systemsConcerns: concerns.map((c) => reqEntry(c, ac)),
    }),
    `harden_requirements ${sliceId}`,
  );

  // harden tests (must mention real/integration because slice is type=integration)
  expectOk(
    handleHardenTests({
      projectPath: dir,
      sliceId,
      acToTestMap: ac.map((a) => ({ ac: a, tests: [`covers: ${a.slice(0, 30)}`], rationale: "direct unit test" })),
      positiveCases: ["happy path"],
      negativeCases: ["error path"],
      edgeCases: [],
      regressions: [],
      additionalConcerns: ["real integration fixture with vitest"],
      doneMetric: "all AC green",
      systemsConcernTests: concerns.map(testEntry),
    }),
    `harden_tests ${sliceId}`,
  );

  // harden plan: single round + finalize
  expectOk(
    handleHardenPlan({
      projectPath: dir,
      sliceId,
      round: 1,
      initialPlan: `Initial plan for ${sliceId}`,
      critique:
        "Initial plan glosses over the audit entry on failed paths and doesn't specify where rate-limit enforcement sits in the request pipeline. Needs explicit ordering: validate → idempotency lookup → rate-limit → mutate → audit.",
      revisedPlan:
        "Revised plan: validate → idempotency lookup → rate-limit → mutate → audit. Audit entries on both success and failure paths with distinct note strings.",
      improvementsFound: true,
      finalize: false,
    }),
    `harden_plan r1 ${sliceId}`,
  );
  expectOk(
    handleHardenPlan({
      projectPath: dir,
      sliceId,
      round: 2,
      critique: "LGTM — no substantive issues on re-review.",
      revisedPlan:
        "Revised plan: validate → idempotency lookup → rate-limit → mutate → audit. Audit entries on both success and failure paths with distinct note strings.",
      improvementsFound: false,
      finalize: true,
      finalPlan: {
        touchedAreas: ["src"],
        // plan-compliance scanner compares changed files to expectedFiles by
        // relative path, so we record relative paths here (not absolute).
        expectedFiles: [
          produceSrcFile.replace(dir + "/", ""),
          produceTestFile.replace(dir + "/", ""),
        ],
        // Plan-compliance scanner extracts exported symbols from changed TS
        // files and compares to plannedIdentifiers. Use the matching symbol.
        interfacesToChange: [exportedSymbol],
        invariantsToPreserve: ["audit on every outcome"],
        risks: [],
        narrative:
          "Validate → idempotency → rate-limit → mutate → audit. Each step logs a distinct audit note so postmortems are possible.",
        systemsConcernPlans: concerns.map(planEntry),
      },
    }),
    `harden_plan r2 finalize ${sliceId}`,
  );

  // ready_for_red
  sm.setSliceStatus(sliceId, "ready_for_red");

  // Write a RED test. Must NOT touch production files before verify_test_first.
  writeFileSync(produceTestFile, `throw new Error("no impl yet for ${sliceId}");\n`);
  expectOk(
    handleVerifyTestFirst({ projectPath: dir, sliceId, testCommand: "exit 1" }),
    `verify_test_first ${sliceId}`,
  );

  sm.setSliceStatus(sliceId, "red");

  // Write impl, record passing tests, transition through green→refactor→sast.
  // The exported symbol name MUST match plan.interfacesToChange for the
  // plan-compliance scanner to verdict "ok".
  writeFileSync(produceSrcFile, `// ${sliceId} impl\nexport const ${exportedSymbol} = 1;\n`);
  sm.addTestResult(sliceId, {
    timestamp: new Date().toISOString(),
    command: "vitest run",
    exitCode: 0,
    passed: ac.length,
    failed: 0,
    skipped: 0,
    output: "ok",
  });
  sm.setSliceStatus(sliceId, "green");
  sm.setSliceStatus(sliceId, "refactor");
  sm.markSastRun(sliceId);
  sm.setSliceStatus(sliceId, "sast");
  sm.addTestResult(sliceId, {
    timestamp: new Date().toISOString(),
    command: "vitest run",
    exitCode: 0,
    passed: ac.length,
    failed: 0,
    skipped: 0,
    output: "ok after SAST",
  });

  // completion_review with per-concern verdicts
  expectOk(
    handleCompletionReview({
      projectPath: dir,
      sliceId,
      acCoverage: ac.map((a) => ({ ac: a, status: "met" as const, evidence: `covers: ${a.slice(0, 30)}` })),
      testCoverageQuality: "deep",
      missingFunctionality: [],
      missingTests: [],
      missingEdgeCases: [],
      missingIntegrationWork: [],
      missingCleanupRefactor: [],
      missingPlanFixes: [],
      shortcutsOrStubs: [],
      stubJustifications: [],
      verdict: "COMPLETE",
      nextActions: [],
      systemsConcernReviews: concerns.map(reviewEntry),
    }),
    `completion_review ${sliceId}`,
  );

  sm.setSliceStatus(sliceId, "done");
}

describe("DOGFOOD slice 1 — POST /shorten", () => {
  it("applicability rules return at least one concern (explicit classification locks the set)", () => {
    const concerns = conc("s01-shorten");
    expect(concerns.length).toBeGreaterThan(0);
    // explicit classification included auth_permissions + failure_modes (piggyback)
    expect(concerns).toContain("auth_permissions");
    expect(concerns).toContain("failure_modes");
  });

  it("walks pending → done through the full v2 flow", () => {
    walkSliceThrough(
      "s01-shorten",
      join(dir, "tests", "shorten.test.ts"),
      join(dir, "src", "shorten.ts"),
      "createLink",
    );
    expect(sm.read().slices.find((s) => s.id === "s01-shorten")!.status).toBe("done");
  });
});

describe("DOGFOOD slice 2 — GET /stats/:code", () => {
  it("commit slice 1 artifacts so slice 2's baseline doesn't see them as pre-touched", () => {
    // A real workflow would have the user commit slice 1's implementation
    // before starting slice 2. Without this, verify_test_first for slice 2
    // sees src/shorten.ts as a production-file-touched-before-red and fails.
    git(dir, ["add", "-A"]);
    git(dir, ["-c", "user.name=dogfood", "-c", "user.email=dogfood@test", "commit", "-m", "slice 1 complete", "-q"]);
  });

  it("walks pending → done through the full v2 flow", () => {
    walkSliceThrough(
      "s02-stats",
      join(dir, "tests", "stats.test.ts"),
      join(dir, "src", "stats.ts"),
      "getStats",
    );
    expect(sm.read().slices.find((s) => s.id === "s02-stats")!.status).toBe("done");
  });
});

describe("DOGFOOD final state", () => {
  it("both slices done and carry full v2 evidence", () => {
    const state = sm.read();
    expect(state.slices.length).toBe(2);
    for (const s of state.slices) {
      expect(s.status).toBe("done");
      expect(s.requirementsHardening?.systemsConcerns?.length).toBeGreaterThan(0);
      expect(s.testHardening?.systemsConcernTests?.length).toBeGreaterThan(0);
      expect(s.planHardening?.finalPlan.systemsConcernPlans?.length).toBeGreaterThan(0);
      const rev = (s.completionReviews ?? []).find((r) => r.verdict === "COMPLETE" && !r.supersededByHardeningAt);
      expect(rev).toBeDefined();
      expect(rev!.systemsConcernReviews?.length).toBeGreaterThan(0);
    }
  });

  it("state.json version is 2 (post-migration)", () => {
    expect(sm.read().version).toBe(2);
  });

  it("buildHistory captured phase + slice_status events", () => {
    const history = sm.read().buildHistory;
    const sliceEvents = history.filter((e) => e.action === "slice_status");
    expect(sliceEvents.length).toBeGreaterThanOrEqual(10);
  });

  it("state.json contains all four v2 evidence types", () => {
    const content = readFileSync(join(dir, ".a2p", "state.json"), "utf-8");
    expect(content).toContain('"systemsConcerns"');
    expect(content).toContain('"systemsConcernTests"');
    expect(content).toContain('"systemsConcernPlans"');
    expect(content).toContain('"systemsConcernReviews"');
  });
});
