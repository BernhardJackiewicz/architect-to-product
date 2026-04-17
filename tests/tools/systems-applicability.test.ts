import { describe, it, expect } from "vitest";
import { computeRequiredConcerns } from "../../src/utils/systems-applicability.js";
import type {
  Architecture,
  Slice,
  SystemsConcernId,
} from "../../src/state/types.js";

/**
 * Unit tests for the A2P v2 applicability rules.
 *
 * Every concern has at least one positive test (something that triggers it)
 * and one negative test (something that does NOT trigger it). Explicit
 * override via `systemsClassification` is tested separately.
 *
 * `failure_modes` is always required. That's the one concern whose "negative
 * test" is: there is no case where it's absent.
 */

function makeSlice(overrides: Partial<Slice> = {}): Slice {
  return {
    id: "s1",
    name: "Default slice",
    description: "A default slice",
    acceptanceCriteria: ["AC1"],
    testStrategy: "unit",
    dependencies: [],
    status: "pending",
    files: [],
    testResults: [],
    sastFindings: [],
    ...overrides,
  };
}

function makeArchitecture(overrides: Partial<Architecture> = {}): Architecture {
  return {
    name: "Test",
    description: "Test",
    techStack: {
      language: "TypeScript",
      framework: "Express",
      database: null,
      frontend: null,
      hosting: null,
      other: [],
    },
    features: ["f"],
    dataModel: "n",
    apiDesign: "n",
    raw: "",
    ...overrides,
  };
}

function hasAll(
  result: Set<SystemsConcernId>,
  concerns: SystemsConcernId[],
): boolean {
  return concerns.every((c) => result.has(c));
}

describe("computeRequiredConcerns — failure_modes piggybacks on other triggers", () => {
  it("bare slice with no architecture yields an EMPTY required set (no gate fires)", () => {
    const result = computeRequiredConcerns(makeSlice(), null);
    expect(result.size).toBe(0);
  });

  it("bare copy-change UI slice without systems block yields an EMPTY set", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        name: "Update homepage copy",
        description: "Change hero text",
        acceptanceCriteria: ["hero reads 'New'"],
        type: "feature",
        hasUI: true,
      }),
      makeArchitecture(),
    );
    expect(result.size).toBe(0);
  });

  it("failure_modes is included whenever another concern fires", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add OAuth login flow" }),
      makeArchitecture(),
    );
    expect(result.has("auth_permissions")).toBe(true);
    expect(result.has("failure_modes")).toBe(true);
  });

  it("failure_modes is included when architecture has a systems block (v2 opt-in)", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Change button color" }),
      makeArchitecture({
        systems: {
          domainEntities: [],
          invariants: [],
          stateMachines: [],
          apiContracts: [],
          permissionsModel: { tenancy: "none", roles: [], boundaries: [] },
          failureModel: [],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise: "additive",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "text",
            logCorrelationKey: null,
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [],
          },
          performanceBudgets: [],
          cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
          distributedStateModel: {
            topology: "single-process",
            consistency: "single-writer",
            coordinationMechanism: null,
          },
          securityAssumptions: [],
        },
      }),
    );
    expect(result.has("failure_modes")).toBe(true);
  });
});

describe("computeRequiredConcerns — migrations rule", () => {
  it("positive: description mentions 'migration'", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add migration for users.email unique" }),
      makeArchitecture(),
    );
    expect(result.has("migrations")).toBe(true);
  });

  it("positive: AC mentions 'schema'", () => {
    const result = computeRequiredConcerns(
      makeSlice({ acceptanceCriteria: ["Updated schema passes"] }),
      makeArchitecture(),
    );
    expect(result.has("migrations")).toBe(true);
  });

  it("negative: plain UI copy slice does not require migrations", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Change button color" }),
      makeArchitecture(),
    );
    expect(result.has("migrations")).toBe(false);
  });
});

describe("computeRequiredConcerns — concurrency_idempotency rule", () => {
  it("positive: integration slice + webhook keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        type: "integration",
        name: "Stripe webhook handler",
        description: "Process payment events",
      }),
      makeArchitecture(),
    );
    expect(result.has("concurrency_idempotency")).toBe(true);
  });

  it("negative: feature slice with webhook keyword does NOT require it", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "feature", description: "Document webhook format" }),
      makeArchitecture(),
    );
    expect(result.has("concurrency_idempotency")).toBe(false);
  });

  it("negative: integration slice without webhook/background keywords", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        type: "integration",
        description: "Add company logo to integration docs",
      }),
      makeArchitecture(),
    );
    expect(result.has("concurrency_idempotency")).toBe(false);
  });
});

describe("computeRequiredConcerns — observability rule", () => {
  it("positive: backend platform + api keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add /users endpoint" }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: null,
          frontend: null,
          hosting: null,
          other: [],
          platform: "backend-only",
        },
      }),
    );
    expect(result.has("observability")).toBe(true);
  });

  it("positive: integration slices always require observability (external boundary)", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "integration", description: "Call external service" }),
      makeArchitecture(),
    );
    expect(result.has("observability")).toBe(true);
  });

  it("negative: UI-only feature slice on web platform without api keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        type: "feature",
        hasUI: true,
        description: "Change footer copy",
      }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Next.js",
          database: null,
          frontend: "React",
          hosting: null,
          other: [],
          platform: "web",
        },
      }),
    );
    expect(result.has("observability")).toBe(false);
  });
});

describe("computeRequiredConcerns — auth_permissions rule", () => {
  it("positive: 'auth' keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add OAuth login" }),
      makeArchitecture(),
    );
    expect(result.has("auth_permissions")).toBe(true);
  });

  it("positive: 'as a <role>' phrase in AC", () => {
    const result = computeRequiredConcerns(
      makeSlice({ acceptanceCriteria: ["As an admin I can delete users"] }),
      makeArchitecture(),
    );
    expect(result.has("auth_permissions")).toBe(true);
  });

  it("negative: plain settings slice", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Toggle dark mode" }),
      makeArchitecture(),
    );
    expect(result.has("auth_permissions")).toBe(false);
  });
});

describe("computeRequiredConcerns — api_contracts rule", () => {
  it("positive: integration slice always requires api_contracts", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "integration", description: "call some service" }),
      makeArchitecture(),
    );
    expect(result.has("api_contracts")).toBe(true);
  });

  it("plan declaring interface changes DOES NOT auto-trigger api_contracts (lifecycle-stable by design)", () => {
    // Earlier versions derived api_contracts applicability from
    // planHardening.finalPlan.interfacesToChange. That created a hazard: the
    // set of required concerns grew AFTER requirements were hardened, making
    // the pre-RED gate unsatisfiable without re-hardening. The dogfood run
    // surfaced this. Now feature slices must opt into api_contracts via
    // `systemsClassification`.
    const result = computeRequiredConcerns(
      makeSlice({
        type: "feature",
        planHardening: {
          rounds: [],
          finalPlan: {
            touchedAreas: ["api"],
            expectedFiles: ["src/api.ts"],
            interfacesToChange: ["export function addUser()"],
            invariantsToPreserve: [],
            risks: [],
            narrative: "plan",
          },
          finalized: true,
          requirementsAcHash: "h",
          testsHardenedAt: "t",
        },
      }),
      makeArchitecture(),
    );
    expect(result.has("api_contracts")).toBe(false);
  });

  it("feature slice with explicit systemsClassification opts into api_contracts", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "feature", systemsClassification: ["api_contracts"] }),
      makeArchitecture(),
    );
    expect(result.has("api_contracts")).toBe(true);
  });

  it("negative: pure UI feature slice", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "feature", description: "Change button color" }),
      makeArchitecture(),
    );
    expect(result.has("api_contracts")).toBe(false);
  });
});

describe("computeRequiredConcerns — data_model rule", () => {
  it("positive: architecture has DB + slice touches model file", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/user.ts"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
      }),
    );
    expect(result.has("data_model")).toBe(true);
  });

  it("negative: no DB in architecture", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/user.ts"] }),
      makeArchitecture(),
    );
    expect(result.has("data_model")).toBe(false);
  });

  it("negative: DB present but slice touches only UI files", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/ui/button.tsx"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
      }),
    );
    expect(result.has("data_model")).toBe(false);
  });
});

describe("computeRequiredConcerns — state_machine + invariants", () => {
  it("positive: 'transition' keyword triggers state_machine AND invariants", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add pending→done transition" }),
      makeArchitecture(),
    );
    expect(result.has("state_machine")).toBe(true);
    expect(result.has("invariants")).toBe(true);
  });

  it("positive: data_model triggers invariants transitively", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/user.ts"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
      }),
    );
    expect(result.has("data_model")).toBe(true);
    expect(result.has("invariants")).toBe(true);
  });

  it("negative: plain UI slice has no state_machine or transitive invariants", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Change button color" }),
      makeArchitecture(),
    );
    expect(result.has("state_machine")).toBe(false);
    expect(result.has("invariants")).toBe(false);
  });
});

describe("computeRequiredConcerns — performance_under_load", () => {
  it("positive: 'batch' keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Process batch import" }),
      makeArchitecture(),
    );
    expect(result.has("performance_under_load")).toBe(true);
  });

  it("positive: infrastructure slice", () => {
    const result = computeRequiredConcerns(
      makeSlice({ type: "infrastructure", description: "Setup deployment pipeline" }),
      makeArchitecture(),
    );
    expect(result.has("performance_under_load")).toBe(true);
  });

  it("negative: simple feature copy change", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Change welcome message" }),
      makeArchitecture(),
    );
    expect(result.has("performance_under_load")).toBe(false);
  });
});

describe("computeRequiredConcerns — cache_invalidation", () => {
  it("positive: architecture declares redis cache + slice touches model", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/product.ts"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
        systems: {
          domainEntities: [],
          invariants: [],
          stateMachines: [],
          apiContracts: [],
          permissionsModel: { tenancy: "none", roles: [], boundaries: [] },
          failureModel: [],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise: "additive",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "text",
            logCorrelationKey: null,
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [],
          },
          performanceBudgets: [],
          cacheStrategy: { layer: "redis", invalidationTriggers: [], stalenessBoundMs: null },
          distributedStateModel: {
            topology: "single-process",
            consistency: "single-writer",
            coordinationMechanism: null,
          },
          securityAssumptions: [],
        },
      }),
    );
    expect(result.has("cache_invalidation")).toBe(true);
  });

  it("negative: architecture has no systems block", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/product.ts"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
      }),
    );
    expect(result.has("cache_invalidation")).toBe(false);
  });

  it("negative: architecture declares cacheStrategy.layer='none'", () => {
    const result = computeRequiredConcerns(
      makeSlice({ files: ["src/models/product.ts"] }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
        systems: {
          domainEntities: [],
          invariants: [],
          stateMachines: [],
          apiContracts: [],
          permissionsModel: { tenancy: "none", roles: [], boundaries: [] },
          failureModel: [],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise: "additive",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "text",
            logCorrelationKey: null,
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [],
          },
          performanceBudgets: [],
          cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
          distributedStateModel: {
            topology: "single-process",
            consistency: "single-writer",
            coordinationMechanism: null,
          },
          securityAssumptions: [],
        },
      }),
    );
    expect(result.has("cache_invalidation")).toBe(false);
  });
});

describe("computeRequiredConcerns — distributed_state", () => {
  it("positive: architecture declares multi-process topology", () => {
    const result = computeRequiredConcerns(
      makeSlice(),
      makeArchitecture({
        systems: {
          domainEntities: [],
          invariants: [],
          stateMachines: [],
          apiContracts: [],
          permissionsModel: { tenancy: "none", roles: [], boundaries: [] },
          failureModel: [],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise: "additive",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "text",
            logCorrelationKey: null,
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [],
          },
          performanceBudgets: [],
          cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
          distributedStateModel: {
            topology: "multi-node",
            consistency: "eventual",
            coordinationMechanism: "zookeeper",
          },
          securityAssumptions: [],
        },
      }),
    );
    expect(result.has("distributed_state")).toBe(true);
  });

  it("negative: single-process topology", () => {
    const result = computeRequiredConcerns(
      makeSlice(),
      makeArchitecture({
        systems: {
          domainEntities: [],
          invariants: [],
          stateMachines: [],
          apiContracts: [],
          permissionsModel: { tenancy: "none", roles: [], boundaries: [] },
          failureModel: [],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise: "additive",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "text",
            logCorrelationKey: null,
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [],
          },
          performanceBudgets: [],
          cacheStrategy: { layer: "none", invalidationTriggers: [], stalenessBoundMs: null },
          distributedStateModel: {
            topology: "single-process",
            consistency: "single-writer",
            coordinationMechanism: null,
          },
          securityAssumptions: [],
        },
      }),
    );
    expect(result.has("distributed_state")).toBe(false);
  });
});

describe("computeRequiredConcerns — security", () => {
  it("positive: 'upload' keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Allow user to upload avatar" }),
      makeArchitecture(),
    );
    expect(result.has("security")).toBe(true);
  });

  it("positive: 'password' keyword", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Add password reset flow" }),
      makeArchitecture(),
    );
    expect(result.has("security")).toBe(true);
  });

  it("negative: UI copy change", () => {
    const result = computeRequiredConcerns(
      makeSlice({ description: "Change heading size" }),
      makeArchitecture(),
    );
    expect(result.has("security")).toBe(false);
  });
});

describe("computeRequiredConcerns — explicit override (systemsClassification)", () => {
  it("override forces exact set + failure_modes always-on", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        description: "Upload password-hashed tokens to external webhook",
        systemsClassification: ["security"],
      }),
      makeArchitecture(),
    );
    // Override is authoritative: only `security` + always-on `failure_modes`
    expect(result.has("security")).toBe(true);
    expect(result.has("failure_modes")).toBe(true);
    // Even though keywords would have triggered them, override suppresses
    expect(result.has("auth_permissions")).toBe(false);
  });

  it("override can include multiple concerns", () => {
    const result = computeRequiredConcerns(
      makeSlice({ systemsClassification: ["security", "observability", "api_contracts"] }),
      makeArchitecture(),
    );
    expect(result.has("security")).toBe(true);
    expect(result.has("observability")).toBe(true);
    expect(result.has("api_contracts")).toBe(true);
    expect(result.has("failure_modes")).toBe(true); // always-on
  });

  it("empty override array falls through to structural signals", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        description: "Process stripe webhook retry",
        type: "integration",
        systemsClassification: [],
      }),
      makeArchitecture(),
    );
    // Empty array → falls through; integration + stripe keyword fires
    expect(result.has("concurrency_idempotency")).toBe(true);
  });
});

describe("computeRequiredConcerns — multi-concern triggers", () => {
  it("realistic webhook+payment slice fires several concerns at once", () => {
    const result = computeRequiredConcerns(
      makeSlice({
        type: "integration",
        name: "Stripe payment webhook retry queue",
        description:
          "Process Stripe webhook callbacks with retry logic; per-tenant idempotency tokens and audit logging",
        acceptanceCriteria: [
          "As a tenant admin I can see webhook delivery status",
          "Duplicate webhooks are idempotent per tenant",
        ],
      }),
      makeArchitecture({
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
          platform: "backend-only",
        },
      }),
    );
    expect(
      hasAll(result, [
        "concurrency_idempotency",
        "api_contracts",
        "observability",
        "auth_permissions",
        "security",
        "failure_modes",
      ]),
    ).toBe(true);
  });
});
