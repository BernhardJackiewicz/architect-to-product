/**
 * A2P v2 full-stack dogfood — MCP wire path end-to-end.
 *
 * Unlike tests/dogfood/v2-link-shortener-e2e.test.ts which invokes the tool
 * *handlers* directly, this test spawns the actual compiled MCP server
 * (`dist/index.js`) as a subprocess and speaks the MCP JSON-RPC protocol to
 * it via `@modelcontextprotocol/sdk`'s `Client` + `StdioClientTransport`.
 *
 * Motivation (from run-2 dogfood — see dogfood/REPORT-RUN-2.md):
 * The v2.0.0 merge added v2 fields to the Zod schemas of the tool handlers,
 * but the corresponding `server.tool(...)` registrations in `src/server.ts`
 * did not enumerate those fields. Because the MCP SDK builds a `z.object(shape)`
 * from the registration shape and Zod strips unknown keys by default, every
 * v2 field passed by a real MCP client was silently dropped before reaching
 * the handler. The existing v2 dogfood test (which calls handlers directly)
 * could not catch this. This test exists to close that gap.
 *
 * Flow: init → set_architecture (with `systems` block) → create_build_plan
 * (with per-slice `systemsClassification`) → set_phase building → for each of
 * 2 slices: harden_requirements (with systemsConcerns) → harden_tests (with
 * systemsConcernTests) → harden_plan ×2 (LGTM round 2) + finalize (finalPlan
 * with systemsConcernPlans) → update_slice ready_for_red → write failing test
 * → verify_test_first → update_slice red → write implementation → run_tests →
 * update_slice green → refactor → run_sast → sast → completion_review (with
 * systemsConcernReviews) → update_slice done → git commit.
 *
 * Every v2 field is asserted to have been persisted to state.json.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const PROJECT_ROOT = resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../..",
);
const DIST_ENTRY = join(PROJECT_ROOT, "dist", "index.js");

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  }
}

function write(path: string, content: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

let client: Client;
let transport: StdioClientTransport;
let dir: string;

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<any> {
  const res = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 60_000 },
  );
  const text = (res.content as Array<{ type: string; text: string }>)
    .map((c) => c.text)
    .join("");
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON body — treat as error text.
    throw new Error(`${name} failed (non-JSON response): ${text.slice(0, 500)}`);
  }
  if (res.isError || parsed.error) {
    throw new Error(`${name} failed: ${parsed.error ?? text}`);
  }
  return parsed;
}

async function callToolRaw(
  name: string,
  args: Record<string, unknown>,
): Promise<{ parsed: any; isError: boolean; rawText: string }> {
  const res = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 60_000 },
  );
  const text = (res.content as Array<{ type: string; text: string }>)
    .map((c) => c.text)
    .join("");
  let parsed: any = { error: text };
  try {
    parsed = JSON.parse(text);
  } catch {
    /* non-JSON error body */
  }
  return { parsed, isError: res.isError === true, rawText: text };
}

function readState(): any {
  return JSON.parse(readFileSync(join(dir, ".a2p", "state.json"), "utf-8"));
}

beforeAll(async () => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `dist entry not found at ${DIST_ENTRY}. Run 'npx tsc' first.`,
    );
  }
  dir = join(tmpdir(), `a2p-v2-mcp-fullstack-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "dogfood@test"]);
  git(dir, ["config", "user.name", "dogfood"]);
  git(dir, ["commit", "--allow-empty", "-m", "baseline", "-q"]);

  // Scaffold package.json + vitest config so run_tests and verify_test_first
  // can actually execute. We copy node_modules from the host repo — installing
  // fresh per-test-run is too slow (~20s) and fragile in CI.
  write(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "mini-invoice-fixture",
        version: "0.0.0",
        private: true,
        type: "module",
        scripts: { test: "vitest run" },
      },
      null,
      2,
    ),
  );
  write(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          noUncheckedIndexedAccess: true,
          esModuleInterop: true,
          skipLibCheck: true,
          types: [],
          lib: ["ES2022"],
        },
        include: ["src", "tests"],
      },
      null,
      2,
    ),
  );
  write(
    join(dir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: true,
  },
});
`,
  );
  // Symlink node_modules from the host repo — vitest + typescript are enough.
  spawnSync("ln", ["-s", join(PROJECT_ROOT, "node_modules"), join(dir, "node_modules")], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-m", "scaffold", "-q"]);

  transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    stderr: "pipe",
  });
  client = new Client({
    name: "v2-mcp-fullstack-test",
    version: "0.0.1",
  });
  await client.connect(transport, { timeout: 30_000 });
}, 120_000);

afterAll(async () => {
  try {
    await client?.close();
  } catch {
    /* best-effort */
  }
  if (dir && existsSync(dir)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});

describe("v2 MCP surface — full-stack dogfood of a TS invoice library", () => {
  it(
    "lists all v2 tools on the wire",
    async () => {
      const { tools } = await client.listTools(undefined, { timeout: 20_000 });
      const names = new Set(tools.map((t) => t.name));
      const expected = [
        "a2p_init_project",
        "a2p_set_architecture",
        "a2p_create_build_plan",
        "a2p_set_phase",
        "a2p_harden_requirements",
        "a2p_harden_tests",
        "a2p_harden_plan",
        "a2p_verify_test_first",
        "a2p_update_slice",
        "a2p_run_tests",
        "a2p_run_sast",
        "a2p_completion_review",
        "a2p_get_state",
      ];
      for (const name of expected) {
        expect(names.has(name), `missing tool on MCP wire: ${name}`).toBe(true);
      }

      // Assert v2 fields are actually in the input schema for each v2 tool.
      // This is the regression guard for Finding #1 — "v2 fields silently
      // dropped on the MCP wire".
      const toolByName = new Map(tools.map((t) => [t.name, t]));
      const archTool = toolByName.get("a2p_set_architecture")!;
      const archProps = (archTool.inputSchema as any).properties ?? {};
      expect(archProps.systems, "a2p_set_architecture must expose `systems`").toBeDefined();
      expect(archProps.platform, "a2p_set_architecture must expose `platform`").toBeDefined();

      const hrTool = toolByName.get("a2p_harden_requirements")!;
      expect(
        (hrTool.inputSchema as any).properties?.systemsConcerns,
        "a2p_harden_requirements must expose `systemsConcerns`",
      ).toBeDefined();

      const htTool = toolByName.get("a2p_harden_tests")!;
      expect(
        (htTool.inputSchema as any).properties?.systemsConcernTests,
        "a2p_harden_tests must expose `systemsConcernTests`",
      ).toBeDefined();

      const crTool = toolByName.get("a2p_completion_review")!;
      expect(
        (crTool.inputSchema as any).properties?.systemsConcernReviews,
        "a2p_completion_review must expose `systemsConcernReviews`",
      ).toBeDefined();

      const cbpTool = toolByName.get("a2p_create_build_plan")!;
      const sliceItemSchema = (cbpTool.inputSchema as any).properties?.slices?.items;
      expect(
        sliceItemSchema?.properties?.systemsClassification,
        "a2p_create_build_plan slice schema must expose `systemsClassification`",
      ).toBeDefined();
    },
    30_000,
  );

  it(
    "walks 2 slices of the invoice library through the full v2 MCP flow",
    async () => {
      // ---------- init ----------
      await callTool("a2p_init_project", {
        projectPath: dir,
        projectName: "mini-invoice-fixture",
      });

      // ---------- architecture with systems block ----------
      await callTool("a2p_set_architecture", {
        projectPath: dir,
        name: "mini-invoice-fixture",
        description:
          "Small TypeScript library for generating and managing invoices. Totals with banker's rounding; strict one-way status state machine; per-customer scoping with existence-hiding 404; CSV injection protection; audit log for successes and failures.",
        language: "TypeScript",
        framework: "library",
        features: [
          "Invoice with LineItems and totals",
          "Status state machine",
          "Per-customer scoping",
          "CSV with injection protection",
          "Audit log",
        ],
        dataModel:
          "In-memory Map<customerId, Map<invoiceId, Invoice>>. Invoice(id, customerId, status, items[], tax, discount). LineItem(quantity, unitPrice, description).",
        apiDesign:
          "Pure library functions returning Result unions — no REST, no server.",
        platform: "backend-only",
        oversight: {
          sliceReview: "off",
          planApproval: false,
          buildSignoff: true,
          deployApproval: true,
          securitySignoff: false,
        },
        systems: {
          domainEntities: [
            {
              name: "Invoice",
              purpose: "Billing document with a one-way status lifecycle",
              identity: "uuid string prefixed with inv-",
              ownership: "multi-tenant",
              lifecycle:
                "draft → sent → paid (terminal) or draft/sent → voided (terminal)",
            },
            {
              name: "LineItem",
              purpose: "Invoice charge line (quantity × unitPrice)",
              identity: "positional within invoice.items",
              ownership: "multi-tenant",
              lifecycle: "created with invoice; immutable afterwards",
            },
          ],
          invariants: [
            {
              id: "INV-1",
              statement:
                "Total == sum(item.qty*item.unitPrice) * (1-discount) * (1+tax), banker's-rounded to cents.",
              scope: "per-entity",
              enforcedBy: "computeTotal() pure function in src/totals.ts",
            },
            {
              id: "INV-2",
              statement:
                "Status transitions are one-way; paid and voided are terminal — no transition escapes them.",
              scope: "per-entity",
              enforcedBy: "transitionStatus() TRANSITIONS guard table in src/status.ts",
            },
          ],
          stateMachines: [
            {
              name: "invoice-status",
              states: ["draft", "sent", "paid", "voided"],
              transitions: [
                { from: "draft", to: "sent", trigger: "send" },
                { from: "sent", to: "paid", trigger: "markPaid" },
                { from: "draft", to: "voided", trigger: "void" },
                { from: "sent", to: "voided", trigger: "void" },
              ],
              terminalStates: ["paid", "voided"],
            },
          ],
          apiContracts: [
            {
              id: "createInvoice",
              kind: "mcp-tool",
              inputShape: "{customerId,items,discount,tax}",
              outputShape: "Result<Invoice, {code:'INVALID_ITEM'|'EMPTY_ITEMS'}>",
              errorModes: ["INVALID_ITEM", "EMPTY_ITEMS"],
              versioning: "additive-only",
            },
          ],
          permissionsModel: {
            tenancy: "hard",
            roles: [
              {
                name: "customer",
                grants: ["read-own-invoice", "write-own-invoice"],
                mustNot: ["read-cross-customer-invoice", "write-cross-customer-invoice"],
              },
            ],
            boundaries: [
              "Every API function requires customerId; cross-customer reads must return NOT_FOUND (existence-hiding).",
            ],
          },
          failureModel: [
            {
              id: "FM-1",
              trigger: "negative quantity or negative unitPrice in LineItem",
              blastRadius: "single createInvoice call",
              detection: "input validation at createInvoice entry",
              recovery: "return Result.err({code:'INVALID_ITEM'}); caller retries with sanitized input",
            },
            {
              id: "FM-2",
              trigger: "attempted transition to a terminal/non-allowed status",
              blastRadius: "single transitionStatus call",
              detection: "TRANSITIONS guard table lookup",
              recovery: "return Result.err({code:'FORBIDDEN_TRANSITION'}); invoice unchanged",
            },
          ],
          migrationPolicy: {
            stateVersionCurrent: 1,
            forwardStrategy: "preprocess-in-zod",
            backwardCompatPromise:
              "library is in-memory only; no persisted state to migrate",
            migrationTests: [],
          },
          observabilityModel: {
            logging: "structured-json",
            logCorrelationKey: "customerId",
            metricsBackend: null,
            tracingBackend: null,
            requiredEventsPerSlice: [
              "invoice.created",
              "invoice.status_transition_attempted",
              "invoice.status_transition_succeeded",
            ],
          },
          performanceBudgets: [
            {
              surface: "createInvoice",
              p50Ms: 0.5,
              p95Ms: 1,
              maxBytesInMemory: 4096,
            },
          ],
          cacheStrategy: {
            layer: "none",
            invalidationTriggers: [],
            stalenessBoundMs: null,
          },
          distributedStateModel: {
            topology: "single-process",
            consistency: "strong",
            coordinationMechanism: null,
          },
          securityAssumptions: [
            {
              id: "SA-1",
              assumption:
                "customerId is authenticated by an upstream layer before reaching this library",
              invalidatedBy:
                "caller passes attacker-controlled customerId — this library trusts the parameter",
            },
            {
              id: "SA-2",
              assumption:
                "CSV consumers may be spreadsheet applications; formula-prefix characters (=, +, -, @) must be defanged on export",
              invalidatedBy:
                "consumer is known-safe (non-spreadsheet); defanging may still be applied as defense in depth",
            },
          ],
        },
      });

      // Verify state.json now has version=2 and architecture.systems populated.
      const stateAfterArch = readState();
      expect(stateAfterArch.version).toBe(2);
      expect(stateAfterArch.architecture?.systems?.domainEntities?.length).toBe(2);
      expect(stateAfterArch.architecture?.systems?.invariants?.length).toBe(2);
      expect(stateAfterArch.architecture?.systems?.cacheStrategy?.layer).toBe("none");

      // ---------- build plan with systemsClassification ----------
      await callTool("a2p_create_build_plan", {
        projectPath: dir,
        slices: [
          {
            id: "s01-invoice-totals",
            name: "Invoice creation with line items and totals",
            description:
              "Core Invoice entity and computeTotal with banker's rounding. No status yet, no customer scoping yet.",
            acceptanceCriteria: [
              "createInvoice with valid items returns ok=true and an invoice with computed total",
              "rounding is banker's rounding (half-to-even) to two decimal places",
              "rejecting negative quantity or negative unitPrice returns ok=false with code INVALID_ITEM",
              "rejecting an empty items array returns ok=false with code EMPTY_ITEMS",
            ],
            testStrategy:
              "vitest unit tests: happy path + banker rounding boundary + negative-quantity rejection + empty-items rejection.",
            dependencies: [],
            type: "feature",
            // Explicit override: we know this slice touches model and invariants.
            systemsClassification: ["data_model", "invariants"],
          },
          {
            id: "s02-status-state-machine",
            name: "Invoice status lifecycle: draft, sent, paid, voided",
            description:
              "Strict one-way lifecycle. draft->sent, sent->paid, draft->voided, sent->voided. Anything else is FORBIDDEN_TRANSITION.",
            acceptanceCriteria: [
              "transitionStatus(draft→sent) returns ok=true and updates status",
              "transitionStatus(paid→sent) returns ok=false code=FORBIDDEN_TRANSITION",
              "transitionStatus(voided→draft) returns ok=false code=FORBIDDEN_TRANSITION",
              "transitionStatus(draft→paid) returns ok=false code=FORBIDDEN_TRANSITION",
            ],
            testStrategy:
              "vitest table-driven: full 4x4 status pair matrix, assert exactly the four allowed pairs succeed.",
            dependencies: ["s01-invoice-totals"],
            type: "feature",
            // Explicit override — systems covered by this slice.
            systemsClassification: ["state_machine", "invariants"],
          },
          {
            id: "s03-customer-scoping",
            name: "Per-customer invoice scoping with existence-hiding",
            description:
              "Multi-tenant read/write isolation. Every stored invoice is owned by a customerId and any cross-customer access returns ok=false code=NOT_FOUND, byte-identical to the truly-missing case so attackers cannot probe for existence. listInvoices is customer-scoped.",
            acceptanceCriteria: [
              "store.create(customerA, items) returns ok=true and places the invoice under customerA",
              "store.get(customerA, idOfCustomerA) returns ok=true",
              "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
              "store.list(customerB) returns only customerB's invoices, never customerA's",
            ],
            testStrategy:
              "vitest tests with two distinct customerIds. Assert cross-customer access returns the exact same error object structure as a nonexistent id.",
            dependencies: ["s01-invoice-totals"],
            type: "feature",
            // NO systemsClassification — applicability rules infer required
            // concerns from keywords. Expected: auth_permissions (from
            // "multi-tenant", "owned by", "customer-scoped"), performance_under_load
            // (from "list"), failure_modes (transitive).
          },
        ],
      });

      const stateAfterPlan = readState();
      const s01Plan = stateAfterPlan.slices.find((s: any) => s.id === "s01-invoice-totals");
      const s02Plan = stateAfterPlan.slices.find((s: any) => s.id === "s02-status-state-machine");
      const s03Plan = stateAfterPlan.slices.find((s: any) => s.id === "s03-customer-scoping");
      expect(s01Plan?.systemsClassification).toEqual(["data_model", "invariants"]);
      expect(s02Plan?.systemsClassification).toEqual(["state_machine", "invariants"]);
      // Slice 3 deliberately has NO explicit classification — prove the absence
      // round-tripped cleanly through the MCP wire.
      expect(s03Plan?.systemsClassification).toBeUndefined();

      // ---------- A2P v2.0.2: register codebase-memory (required companion) ----------
      // Must happen BEFORE set_phase building — new gate blocks otherwise.
      await callTool("a2p_setup_companions", {
        projectPath: dir,
        companions: [
          {
            type: "codebase_memory",
            name: "codebase-memory",
            command: "codebase-memory-mcp",
          },
        ],
      });
      // Self-report the index readiness so the soft-gate on ready_for_red is silent.
      await callTool("a2p_verify_codebase_memory_index", {
        projectPath: dir,
        indexed: true,
        lastIndexedAt: new Date().toISOString(),
      });

      // ---------- set phase building ----------
      await callTool("a2p_set_phase", { projectPath: dir, phase: "building" });

      // ---------- Slice 1 ----------
      await walkSlice1();

      // Commit slice 1 before starting slice 2 so slice 2's baseline sees
      // slice 1's production files as HEAD-fresh (see run-1 finding).
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "s01 complete", "-q"]);

      // ---------- Slice 2 ----------
      await walkSlice2();

      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-m", "s02 complete", "-q"]);

      // ---------- Slice 3 — keyword-triggered applicability ----------
      await walkSlice3();

      // Final assertions against state.json.
      const finalState = readState();
      const s01 = finalState.slices.find((s: any) => s.id === "s01-invoice-totals");
      const s02 = finalState.slices.find((s: any) => s.id === "s02-status-state-machine");
      const s03 = finalState.slices.find((s: any) => s.id === "s03-customer-scoping");

      expect(s01.status).toBe("done");
      expect(s02.status).toBe("done");
      expect(s03.status).toBe("done");

      // Slice 3 keyword-inferred concerns:
      //   auth_permissions (from "multi-tenant" / "owned by" / "customer-scoped")
      //   performance_under_load (from "list")
      //   failure_modes (transitive, attached because at least one other fires)
      const s03Concerns = new Set<string>(
        (s03.requirementsHardening.systemsConcerns ?? []).map((c: any) => c.concern),
      );
      expect(s03Concerns.has("auth_permissions")).toBe(true);
      expect(s03Concerns.has("performance_under_load")).toBe(true);
      expect(s03Concerns.has("failure_modes")).toBe(true);
      const s03Review = s03.completionReviews?.at(-1);
      for (const r of s03Review.systemsConcernReviews) {
        expect(r.verdict).toBe("satisfied");
      }

      // v2 evidence on slice 1 (data_model + invariants + failure_modes auto).
      expect(s01.requirementsHardening?.systemsConcerns?.length).toBeGreaterThanOrEqual(3);
      expect(s01.testHardening?.systemsConcernTests?.length).toBeGreaterThanOrEqual(3);
      expect(s01.planHardening?.finalPlan?.systemsConcernPlans?.length).toBeGreaterThanOrEqual(3);
      const s01Review = s01.completionReviews?.at(-1);
      expect(s01Review?.systemsConcernReviews?.length).toBeGreaterThanOrEqual(3);
      for (const r of s01Review.systemsConcernReviews) {
        expect(r.verdict).toBe("satisfied");
      }

      // v2 evidence on slice 2 (state_machine + invariants + failure_modes auto).
      expect(s02.requirementsHardening?.systemsConcerns?.length).toBeGreaterThanOrEqual(3);
      expect(s02.testHardening?.systemsConcernTests?.length).toBeGreaterThanOrEqual(3);
      expect(s02.planHardening?.finalPlan?.systemsConcernPlans?.length).toBeGreaterThanOrEqual(3);
      const s02Review = s02.completionReviews?.at(-1);
      expect(s02Review?.systemsConcernReviews?.length).toBeGreaterThanOrEqual(3);
      for (const r of s02Review.systemsConcernReviews) {
        expect(r.verdict).toBe("satisfied");
      }
    },
    300_000,
  );

  it(
    "rejects ready_for_red when systemsConcerns evidence is missing (pre-RED gate)",
    async () => {
      // Start a fresh slice on the same project — adds a third slice via
      // add_slice with a required concern but we'll "forget" to harden it,
      // then try to move it to ready_for_red → must be blocked by the gate.
      await callTool("a2p_add_slice", {
        projectPath: dir,
        slice: {
          id: "s03-gate-fail-fixture",
          name: "Gate-failure fixture (negative test)",
          description:
            "This slice intentionally skips systemsConcerns evidence to prove the pre-RED gate blocks the transition.",
          acceptanceCriteria: ["placeholder AC"],
          testStrategy: "placeholder",
          dependencies: ["s02-status-state-machine"],
          type: "feature",
          systemsClassification: ["security"],
        },
      });

      // Harden requirements WITHOUT systemsConcerns evidence.
      await callTool("a2p_harden_requirements", {
        projectPath: dir,
        sliceId: "s03-gate-fail-fixture",
        goal: "Placeholder",
        nonGoals: [],
        affectedComponents: ["src/placeholder.ts"],
        assumptions: [],
        risks: [],
        finalAcceptanceCriteria: ["placeholder AC"],
        // systemsConcerns intentionally omitted
      });
      await callTool("a2p_harden_tests", {
        projectPath: dir,
        sliceId: "s03-gate-fail-fixture",
        acToTestMap: [{ ac: "placeholder AC", tests: ["t"], rationale: "x" }],
        positiveCases: ["p"],
        negativeCases: ["n"],
        edgeCases: [],
        regressions: [],
        additionalConcerns: [],
        doneMetric: "placeholder",
      });
      await callTool("a2p_harden_plan", {
        projectPath: dir,
        sliceId: "s03-gate-fail-fixture",
        round: 1,
        initialPlan: "placeholder initial plan text",
        critique: "placeholder critique text that is at least twenty chars long",
        revisedPlan: "placeholder revised plan",
        improvementsFound: false,
        finalize: true,
        finalPlan: {
          touchedAreas: ["src/"],
          expectedFiles: ["src/placeholder.ts"],
          interfacesToChange: [],
          invariantsToPreserve: [],
          risks: [],
          narrative: "placeholder narrative short",
        },
      });

      const { parsed, isError } = await callToolRaw("a2p_update_slice", {
        projectPath: dir,
        sliceId: "s03-gate-fail-fixture",
        status: "ready_for_red",
      });
      expect(
        isError || typeof parsed.error === "string",
        "pre-RED gate must reject when systemsConcerns is missing for a required concern",
      ).toBe(true);
      const msg = parsed.error ?? "";
      expect(msg).toMatch(/security|systems|concern/i);
    },
    120_000,
  );
});

// =========================================================================
// Slice walks — each slice is a TDD micro-flow through the v2 MCP surface.
// Kept inline (not a shared helper) so the assertions map 1:1 to the spec.
// =========================================================================

async function walkSlice1(): Promise<void> {
  const sid = "s01-invoice-totals";

  // harden_requirements with systemsConcerns
  await callTool("a2p_harden_requirements", {
    projectPath: dir,
    sliceId: sid,
    goal: "Deliver a pure Invoice.createInvoice with banker-rounded totals.",
    nonGoals: [
      "status state machine (s02)",
      "customer scoping",
      "CSV import/export",
    ],
    affectedComponents: [
      "src/invoice.ts",
      "src/totals.ts",
      "src/types.ts",
      "tests/invoice.test.ts",
    ],
    assumptions: ["unitPrice is a positive number in whole or fractional currency units"],
    risks: ["floating-point drift on chained multiplication"],
    finalAcceptanceCriteria: [
      "createInvoice with valid items returns ok=true and an invoice with computed total",
      "rounding is banker's rounding (half-to-even) to two decimal places",
      "rejecting negative quantity or negative unitPrice returns ok=false with code INVALID_ITEM",
      "rejecting an empty items array returns ok=false with code EMPTY_ITEMS",
    ],
    systemsConcerns: [
      {
        concern: "data_model",
        applicability: "required",
        justification: "",
        requirement:
          "Invoice entity defined with customerId (string), status (literal 'draft'), items (non-empty LineItem[]), tax (0..1), discount (0..1), total (computed, banker-rounded cents). LineItem has quantity (positive number), unitPrice (non-negative number), description (string).",
        linkedAcIds: [
          "createInvoice with valid items returns ok=true and an invoice with computed total",
        ],
      },
      {
        concern: "invariants",
        applicability: "required",
        justification: "",
        requirement:
          "INV-1: total == sum(qty*unitPrice) * (1-discount) * (1+tax), banker's-rounded to 2 decimals. Every successful createInvoice must satisfy INV-1 by construction.",
        linkedAcIds: [
          "rounding is banker's rounding (half-to-even) to two decimal places",
        ],
      },
      {
        concern: "failure_modes",
        applicability: "required",
        justification: "",
        requirement:
          "Invalid items (negative qty or negative unitPrice) must be rejected with code INVALID_ITEM. Empty items array must be rejected with code EMPTY_ITEMS. Result<T,E> union is the only error channel — no exceptions thrown.",
        linkedAcIds: [
          "rejecting negative quantity or negative unitPrice returns ok=false with code INVALID_ITEM",
          "rejecting an empty items array returns ok=false with code EMPTY_ITEMS",
        ],
      },
    ],
  });

  // harden_tests with systemsConcernTests
  await callTool("a2p_harden_tests", {
    projectPath: dir,
    sliceId: sid,
    acToTestMap: [
      {
        ac: "createInvoice with valid items returns ok=true and an invoice with computed total",
        tests: ["createInvoice happy-path single item", "createInvoice happy-path multi item"],
        rationale: "two shapes that exercise the sum-then-multiply order",
      },
      {
        ac: "rounding is banker's rounding (half-to-even) to two decimal places",
        tests: ["banker rounding 0.125 rounds to 0.12"],
        rationale: "half-to-even boundary — most common off-by-one source",
      },
      {
        ac: "rejecting negative quantity or negative unitPrice returns ok=false with code INVALID_ITEM",
        tests: ["rejects negative quantity", "rejects negative unitPrice"],
        rationale: "negatives must not short-circuit silently",
      },
      {
        ac: "rejecting an empty items array returns ok=false with code EMPTY_ITEMS",
        tests: ["rejects empty items array"],
        rationale: "empty state must be a distinct code, not INVALID_ITEM",
      },
    ],
    positiveCases: ["single item happy path", "multi item happy path", "discount 0.1 applied then tax 0.2"],
    negativeCases: ["negative quantity rejected", "negative unitPrice rejected", "empty items rejected"],
    edgeCases: ["banker rounding half-to-even"],
    regressions: [],
    additionalConcerns: ["pure-function determinism on re-evaluation"],
    doneMetric: "all 6 unit tests green; INVARIANT INV-1 holds on every random-input property",
    systemsConcernTests: [
      {
        concern: "data_model",
        testNames: ["createInvoice happy-path single item", "createInvoice happy-path multi item"],
        evidenceType: "positive",
        rationale: "shape + field-level assertions on the returned Invoice prove the data model",
      },
      {
        concern: "invariants",
        testNames: ["banker rounding 0.125 rounds to 0.12"],
        evidenceType: "edge",
        rationale: "INV-1 rounding boundary",
      },
      {
        concern: "failure_modes",
        testNames: ["rejects negative quantity", "rejects negative unitPrice", "rejects empty items"],
        evidenceType: "negative",
        rationale: "each documented failure mode has its own dedicated test",
      },
    ],
  });

  // plan round 1 with real initial+critique, round 2 LGTM then finalize
  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 1,
    initialPlan:
      "Plan: create src/types.ts with Invoice, LineItem, Result. src/totals.ts with computeTotal(items, discount, tax). src/invoice.ts with createInvoice returning a Result. tests/invoice.test.ts with the six named tests.",
    critique:
      "Initial plan does not specify rounding primitive — need Math.fround vs string-based banker. Also need to co-locate bankRound() with computeTotal to avoid hidden dependency.",
    revisedPlan:
      "Revised: keep bankRound as a small private helper in src/totals.ts. computeTotal(items, discount, tax) uses integer-cent intermediates where possible, then bankRound once at the end. createInvoice validates items up-front and short-circuits on the first violation.",
    improvementsFound: true,
    finalize: false,
  });
  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 2,
    critique: "LGTM — no substantive issues on re-review.",
    revisedPlan:
      "Revised: keep bankRound as a small private helper in src/totals.ts. computeTotal(items, discount, tax) uses integer-cent intermediates where possible, then bankRound once at the end. createInvoice validates items up-front and short-circuits on the first violation.",
    improvementsFound: false,
    finalize: true,
    finalPlan: {
      touchedAreas: ["src/", "tests/"],
      expectedFiles: [
        "src/types.ts",
        "src/totals.ts",
        "src/invoice.ts",
        "tests/invoice.test.ts",
      ],
      interfacesToChange: [
        "createInvoice",
        "computeTotal",
      ],
      invariantsToPreserve: ["INV-1 (banker-rounded total)"],
      risks: ["rounding bias if bankRound implementation is wrong"],
      narrative:
        "createInvoice validates items, delegates total math to computeTotal, returns Result<Invoice, {code}>. computeTotal uses bankRound once at the end. Tests hit happy-path, rounding boundary, and both negative cases + empty-items.",
      systemsConcernPlans: [
        {
          concern: "data_model",
          approach:
            "Declare Invoice and LineItem as readonly structural types in src/types.ts; createInvoice always returns a fresh object with the computed total frozen-in.",
          filesTouched: ["src/types.ts", "src/invoice.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "invariants",
          approach:
            "INV-1 enforced in computeTotal via a single bankRound call at the end of the pipeline; unit test 'banker rounding 0.125 rounds to 0.12' pins the rounding direction.",
          filesTouched: ["src/totals.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "failure_modes",
          approach:
            "createInvoice validates items first: INVALID_ITEM for any neg qty/unitPrice, EMPTY_ITEMS for empty array. Returned Result<Invoice, {code}> is the only error channel.",
          filesTouched: ["src/invoice.ts"],
          rollbackStrategy: null,
        },
      ],
    },
  });

  // ready_for_red (captures baseline)
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "ready_for_red",
  });

  // write failing test FIRST
  write(
    join(dir, "tests", "invoice.test.ts"),
    `import { describe, it, expect } from "vitest";
import { createInvoice } from "../src/invoice.js";

describe("createInvoice — totals + rejections", () => {
  it("createInvoice happy-path single item", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [{ quantity: 2, unitPrice: 10, description: "widget" }],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.total).toBe(20);
    }
  });

  it("createInvoice happy-path multi item", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [
        { quantity: 1, unitPrice: 10, description: "a" },
        { quantity: 2, unitPrice: 5, description: "b" },
      ],
      discount: 0.1,
      tax: 0.2,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // (10 + 10) * 0.9 * 1.2 = 21.6
      expect(r.value.total).toBeCloseTo(21.6, 2);
    }
  });

  it("banker rounding 0.125 rounds to 0.12", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [{ quantity: 1, unitPrice: 0.125, description: "x" }],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // banker: 0.125 → 0.12 (rounds to even)
      expect(r.value.total).toBe(0.12);
    }
  });

  it("rejects negative quantity", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [{ quantity: -1, unitPrice: 5, description: "x" }],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_ITEM");
  });

  it("rejects negative unitPrice", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [{ quantity: 1, unitPrice: -5, description: "x" }],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("INVALID_ITEM");
  });

  it("rejects empty items array", () => {
    const r = createInvoice({
      customerId: "c1",
      items: [],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("EMPTY_ITEMS");
  });
});
`,
  );

  // verify_test_first — expect failing test run
  await callTool("a2p_verify_test_first", {
    projectPath: dir,
    sliceId: sid,
    testCommand: "npx vitest run",
    timeoutMs: 90_000,
  });

  // move to red
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "red",
  });

  // implementation
  write(
    join(dir, "src", "types.ts"),
    `export interface LineItem {
  readonly quantity: number;
  readonly unitPrice: number;
  readonly description: string;
}

export interface Invoice {
  readonly id: string;
  readonly customerId: string;
  readonly status: "draft";
  readonly items: readonly LineItem[];
  readonly discount: number;
  readonly tax: number;
  readonly total: number;
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
`,
  );
  write(
    join(dir, "src", "totals.ts"),
    `import type { LineItem } from "./types.js";

/**
 * Banker's rounding (half-to-even) to 2 decimal places.
 * Rounds .xx5 to the nearest even hundredth.
 */
function bankRound(n: number): number {
  const scaled = n * 100;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  const EPS = 1e-9;
  let rounded: number;
  if (Math.abs(frac - 0.5) < EPS) {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  } else {
    rounded = Math.round(scaled);
  }
  return rounded / 100;
}

export function computeTotal(
  items: readonly LineItem[],
  discount: number,
  tax: number,
): number {
  const subtotal = items.reduce(
    (acc, it) => acc + it.quantity * it.unitPrice,
    0,
  );
  const withDiscount = subtotal * (1 - discount);
  const withTax = withDiscount * (1 + tax);
  return bankRound(withTax);
}
`,
  );
  write(
    join(dir, "src", "invoice.ts"),
    `import type { Invoice, LineItem, Result } from "./types.js";
import { computeTotal } from "./totals.js";

export interface CreateInvoiceInput {
  readonly customerId: string;
  readonly items: readonly LineItem[];
  readonly discount: number;
  readonly tax: number;
}

export type CreateInvoiceError = { code: "INVALID_ITEM" | "EMPTY_ITEMS" };

let _nextId = 1;

export function createInvoice(
  input: CreateInvoiceInput,
): Result<Invoice, CreateInvoiceError> {
  if (input.items.length === 0) {
    return { ok: false, error: { code: "EMPTY_ITEMS" } };
  }
  for (const it of input.items) {
    if (it.quantity < 0 || it.unitPrice < 0) {
      return { ok: false, error: { code: "INVALID_ITEM" } };
    }
  }
  const total = computeTotal(input.items, input.discount, input.tax);
  const invoice: Invoice = {
    id: "inv-" + String(_nextId++),
    customerId: input.customerId,
    status: "draft",
    items: input.items,
    discount: input.discount,
    tax: input.tax,
    total,
  };
  return { ok: true, value: invoice };
}
`,
  );

  // run_tests — must be green
  const runResult = await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });
  if (!runResult.success) {
    console.error("Slice 1 run_tests failed. Full response:", JSON.stringify(runResult, null, 2));
  }
  expect(runResult.success).toBe(true);

  // green
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "green",
    files: ["src/types.ts", "src/totals.ts", "src/invoice.ts", "tests/invoice.test.ts"],
  });

  // refactor (no actual changes needed)
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "refactor",
  });

  // run_sast — best-effort, should not reject the flow
  await callTool("a2p_run_sast", {
    projectPath: dir,
    sliceId: sid,
    mode: "slice",
    files: ["src/types.ts", "src/totals.ts", "src/invoice.ts"],
  });

  // sast
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "sast",
  });

  // Freshness re-run after SAST (required before completion_review → done)
  await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });

  // completion_review with systemsConcernReviews
  await callTool("a2p_completion_review", {
    projectPath: dir,
    sliceId: sid,
    acCoverage: [
      {
        ac: "createInvoice with valid items returns ok=true and an invoice with computed total",
        status: "met",
        evidence: "tests/invoice.test.ts: happy-path single + multi",
      },
      {
        ac: "rounding is banker's rounding (half-to-even) to two decimal places",
        status: "met",
        evidence: "tests/invoice.test.ts: banker rounding 0.125 rounds to 0.12",
      },
      {
        ac: "rejecting negative quantity or negative unitPrice returns ok=false with code INVALID_ITEM",
        status: "met",
        evidence: "tests/invoice.test.ts: rejects negative quantity + rejects negative unitPrice",
      },
      {
        ac: "rejecting an empty items array returns ok=false with code EMPTY_ITEMS",
        status: "met",
        evidence: "tests/invoice.test.ts: rejects empty items array",
      },
    ],
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
    systemsConcernReviews: [
      {
        concern: "data_model",
        verdict: "satisfied",
        evidence: "src/types.ts:1 — Invoice + LineItem readonly structural types",
        shortfall: "",
      },
      {
        concern: "invariants",
        verdict: "satisfied",
        evidence:
          "src/totals.ts:1 bankRound + tests/invoice.test.ts banker rounding 0.125 test",
        shortfall: "",
      },
      {
        concern: "failure_modes",
        verdict: "satisfied",
        evidence:
          "src/invoice.ts:12-21 — EMPTY_ITEMS short-circuit + INVALID_ITEM guard; three negative-case tests",
        shortfall: "",
      },
    ],
  });

  // done
  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "done",
  });
}

async function walkSlice2(): Promise<void> {
  const sid = "s02-status-state-machine";

  // Refresh test file to include BOTH slice 1 tests AND slice 2 failing tests,
  // so the baseline diff picks up new test content.
  // NOTE: we first refactor the impl interface to support mutable status — but
  // that's production code and can't be touched before the failing test. So
  // we structure it: test file first (failing against current impl), then
  // impl changes.

  await callTool("a2p_harden_requirements", {
    projectPath: dir,
    sliceId: sid,
    goal: "Add strict one-way status lifecycle and transitionStatus function.",
    nonGoals: ["customer scoping", "persistence", "audit log"],
    affectedComponents: ["src/types.ts", "src/status.ts", "src/invoice.ts", "tests/status.test.ts"],
    assumptions: ["A single in-memory store per test is acceptable"],
    risks: ["forgetting that paid and voided are both terminal"],
    finalAcceptanceCriteria: [
      "transitionStatus(draft→sent) returns ok=true and updates status",
      "transitionStatus(paid→sent) returns ok=false code=FORBIDDEN_TRANSITION",
      "transitionStatus(voided→draft) returns ok=false code=FORBIDDEN_TRANSITION",
      "transitionStatus(draft→paid) returns ok=false code=FORBIDDEN_TRANSITION",
    ],
    systemsConcerns: [
      {
        concern: "state_machine",
        applicability: "required",
        justification: "",
        requirement:
          "TRANSITIONS table: draft→sent, sent→paid, draft→voided, sent→voided. All other pairs rejected with FORBIDDEN_TRANSITION. Terminal states: paid, voided.",
        linkedAcIds: [
          "transitionStatus(draft→sent) returns ok=true and updates status",
          "transitionStatus(paid→sent) returns ok=false code=FORBIDDEN_TRANSITION",
        ],
      },
      {
        concern: "invariants",
        applicability: "required",
        justification: "",
        requirement:
          "INV-2: once an invoice is in paid or voided, no transition escapes that state. Enforced in transitionStatus guard table.",
        linkedAcIds: [
          "transitionStatus(voided→draft) returns ok=false code=FORBIDDEN_TRANSITION",
        ],
      },
      {
        concern: "failure_modes",
        applicability: "required",
        justification: "",
        requirement:
          "Every forbidden transition returns Result<Invoice, {code:FORBIDDEN_TRANSITION}>. No mutation on failure.",
        linkedAcIds: [
          "transitionStatus(draft→paid) returns ok=false code=FORBIDDEN_TRANSITION",
        ],
      },
    ],
  });

  await callTool("a2p_harden_tests", {
    projectPath: dir,
    sliceId: sid,
    acToTestMap: [
      {
        ac: "transitionStatus(draft→sent) returns ok=true and updates status",
        tests: ["draft to sent succeeds"],
        rationale: "primary happy path",
      },
      {
        ac: "transitionStatus(paid→sent) returns ok=false code=FORBIDDEN_TRANSITION",
        tests: ["paid to sent forbidden"],
        rationale: "terminal guard",
      },
      {
        ac: "transitionStatus(voided→draft) returns ok=false code=FORBIDDEN_TRANSITION",
        tests: ["voided to draft forbidden"],
        rationale: "terminal guard",
      },
      {
        ac: "transitionStatus(draft→paid) returns ok=false code=FORBIDDEN_TRANSITION",
        tests: ["draft to paid forbidden"],
        rationale: "skipping sent is not allowed",
      },
    ],
    positiveCases: ["draft→sent→paid chain succeeds step by step"],
    negativeCases: [
      "paid→sent",
      "voided→draft",
      "draft→paid",
      "voided→sent",
    ],
    edgeCases: ["unknown target status rejected"],
    regressions: [],
    additionalConcerns: ["mutation-free on failure — the returned invoice is unchanged"],
    doneMetric: "table-driven matrix + four targeted tests all green",
    systemsConcernTests: [
      {
        concern: "state_machine",
        testNames: ["draft to sent succeeds", "draft to paid forbidden"],
        evidenceType: "positive",
        rationale: "allowed pair succeeds + one disallowed pair fails",
      },
      {
        concern: "invariants",
        testNames: ["paid to sent forbidden", "voided to draft forbidden"],
        evidenceType: "negative",
        rationale: "INV-2 terminal guard proven in both terminal states",
      },
      {
        concern: "failure_modes",
        testNames: ["draft to paid forbidden"],
        evidenceType: "negative",
        rationale: "Result<Invoice, {code:FORBIDDEN_TRANSITION}> shape proven",
      },
    ],
  });

  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 1,
    initialPlan:
      "Extend Invoice.status union to include sent/paid/voided. Add transitionStatus(invoice, target) returning Result<Invoice, {code}>. Build a TRANSITIONS guard table.",
    critique:
      "Initial plan silently mutates invoice — should return a NEW invoice object with updated status so the previous state is preserved (helps INV-2 proving).",
    revisedPlan:
      "Revised: transitionStatus returns a new frozen Invoice with updated status on success; leaves original untouched. TRANSITIONS is a Record<Status, Status[]> keyed by origin. Terminal states have empty allow list.",
    improvementsFound: true,
    finalize: false,
  });
  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 2,
    critique: "LGTM — no substantive issues on re-review.",
    revisedPlan:
      "Revised: transitionStatus returns a new frozen Invoice with updated status on success; leaves original untouched. TRANSITIONS is a Record<Status, Status[]> keyed by origin. Terminal states have empty allow list.",
    improvementsFound: false,
    finalize: true,
    finalPlan: {
      touchedAreas: ["src/", "tests/"],
      expectedFiles: [
        "src/types.ts",
        "src/status.ts",
        "src/invoice.ts",
        "tests/status.test.ts",
      ],
      interfacesToChange: ["Status", "transitionStatus", "TRANSITIONS"],
      invariantsToPreserve: ["INV-2 (paid and voided are terminal)"],
      risks: ["forgetting that both paid and voided are terminal"],
      narrative:
        "Status union extended. TRANSITIONS table: draft→[sent,voided], sent→[paid,voided], paid→[], voided→[]. transitionStatus returns new Invoice on allow, FORBIDDEN_TRANSITION on deny.",
      systemsConcernPlans: [
        {
          concern: "state_machine",
          approach:
            "TRANSITIONS Record keyed by origin status; empty allow-list on paid and voided encodes terminality.",
          filesTouched: ["src/status.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "invariants",
          approach:
            "INV-2 preserved by never returning a new invoice when the target is not in TRANSITIONS[origin].",
          filesTouched: ["src/status.ts", "src/invoice.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "failure_modes",
          approach:
            "Every deny emits Result<Invoice, {code:FORBIDDEN_TRANSITION}> — no throw, no mutation.",
          filesTouched: ["src/status.ts"],
          rollbackStrategy: null,
        },
      ],
    },
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "ready_for_red",
  });

  // Write FAILING test file first (slice 2 test), no prod changes yet.
  write(
    join(dir, "tests", "status.test.ts"),
    `import { describe, it, expect } from "vitest";
import { createInvoice } from "../src/invoice.js";
import { transitionStatus } from "../src/status.js";

describe("transitionStatus — invoice lifecycle", () => {
  function baseInvoice() {
    const r = createInvoice({
      customerId: "c1",
      items: [{ quantity: 1, unitPrice: 10, description: "x" }],
      discount: 0,
      tax: 0,
    });
    if (!r.ok) throw new Error("baseline must succeed");
    return r.value;
  }

  it("draft to sent succeeds", () => {
    const inv = baseInvoice();
    const r = transitionStatus(inv, "sent");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.status).toBe("sent");
  });

  it("draft to paid forbidden", () => {
    const inv = baseInvoice();
    const r = transitionStatus(inv, "paid" as any);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("FORBIDDEN_TRANSITION");
  });

  it("paid to sent forbidden", () => {
    const inv = baseInvoice();
    const r1 = transitionStatus(inv, "sent");
    if (!r1.ok) throw new Error("setup");
    const r2 = transitionStatus(r1.value, "paid");
    if (!r2.ok) throw new Error("setup 2");
    const r3 = transitionStatus(r2.value, "sent" as any);
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.error.code).toBe("FORBIDDEN_TRANSITION");
  });

  it("voided to draft forbidden", () => {
    const inv = baseInvoice();
    const r1 = transitionStatus(inv, "voided");
    if (!r1.ok) throw new Error("setup");
    const r2 = transitionStatus(r1.value, "draft" as any);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe("FORBIDDEN_TRANSITION");
  });
});
`,
  );

  await callTool("a2p_verify_test_first", {
    projectPath: dir,
    sliceId: sid,
    testCommand: "npx vitest run",
    timeoutMs: 90_000,
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "red",
  });

  // Now write the impl. Widen Status, add src/status.ts, update types.ts.
  write(
    join(dir, "src", "types.ts"),
    `export type Status = "draft" | "sent" | "paid" | "voided";

export interface LineItem {
  readonly quantity: number;
  readonly unitPrice: number;
  readonly description: string;
}

export interface Invoice {
  readonly id: string;
  readonly customerId: string;
  readonly status: Status;
  readonly items: readonly LineItem[];
  readonly discount: number;
  readonly tax: number;
  readonly total: number;
}

export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };
`,
  );
  write(
    join(dir, "src", "status.ts"),
    `import type { Invoice, Result, Status } from "./types.js";

export const TRANSITIONS: Record<Status, readonly Status[]> = {
  draft: ["sent", "voided"],
  sent: ["paid", "voided"],
  paid: [],
  voided: [],
};

export function transitionStatus(
  invoice: Invoice,
  target: Status,
): Result<Invoice, { code: "FORBIDDEN_TRANSITION" }> {
  const allowed = TRANSITIONS[invoice.status];
  if (!allowed.includes(target)) {
    return { ok: false, error: { code: "FORBIDDEN_TRANSITION" } };
  }
  return { ok: true, value: { ...invoice, status: target } };
}
`,
  );

  const runR = await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });
  expect(runR.success).toBe(true);

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "green",
    files: ["src/types.ts", "src/status.ts", "tests/status.test.ts"],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "refactor",
  });

  await callTool("a2p_run_sast", {
    projectPath: dir,
    sliceId: sid,
    mode: "slice",
    files: ["src/types.ts", "src/status.ts"],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "sast",
  });

  // Freshness re-run after SAST.
  await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });

  await callTool("a2p_completion_review", {
    projectPath: dir,
    sliceId: sid,
    acCoverage: [
      {
        ac: "transitionStatus(draft→sent) returns ok=true and updates status",
        status: "met",
        evidence: "tests/status.test.ts: draft to sent succeeds",
      },
      {
        ac: "transitionStatus(paid→sent) returns ok=false code=FORBIDDEN_TRANSITION",
        status: "met",
        evidence: "tests/status.test.ts: paid to sent forbidden",
      },
      {
        ac: "transitionStatus(voided→draft) returns ok=false code=FORBIDDEN_TRANSITION",
        status: "met",
        evidence: "tests/status.test.ts: voided to draft forbidden",
      },
      {
        ac: "transitionStatus(draft→paid) returns ok=false code=FORBIDDEN_TRANSITION",
        status: "met",
        evidence: "tests/status.test.ts: draft to paid forbidden",
      },
    ],
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
    systemsConcernReviews: [
      {
        concern: "state_machine",
        verdict: "satisfied",
        evidence:
          "src/status.ts:3 TRANSITIONS table + tests/status.test.ts 4 transition tests",
        shortfall: "",
      },
      {
        concern: "invariants",
        verdict: "satisfied",
        evidence:
          "src/status.ts:7-12 terminal-state check + tests/status.test.ts paid/voided guard tests",
        shortfall: "",
      },
      {
        concern: "failure_modes",
        verdict: "satisfied",
        evidence:
          "src/status.ts:12 — no mutation on failure; Result<Invoice, {code:FORBIDDEN_TRANSITION}> shape in tests",
        shortfall: "",
      },
    ],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "done",
  });
}

/**
 * Slice 3 exists specifically to exercise the keyword-triggered
 * applicability path. It deliberately does NOT pass
 * `systemsClassification`, so the state-manager must derive required
 * concerns from slice metadata. We expect:
 *   - auth_permissions (from "multi-tenant" / "owned by" / "customer-scoped")
 *   - performance_under_load (from "list")
 *   - failure_modes (transitive because the other two fired)
 *
 * All three need per-concern evidence at every artifact level, and the
 * completion review must verdict each "satisfied" for the slice to
 * reach `done`.
 */
async function walkSlice3(): Promise<void> {
  const sid = "s03-customer-scoping";

  await callTool("a2p_harden_requirements", {
    projectPath: dir,
    sliceId: sid,
    goal: "Add a customer-scoped store wrapper around Invoice so cross-customer access cannot distinguish real from missing.",
    nonGoals: ["CSV export", "audit log", "status mutation (slice 2)"],
    affectedComponents: [
      "src/store.ts",
      "src/types.ts",
      "tests/customer-scoping.test.ts",
    ],
    assumptions: ["customerId is an opaque string supplied by the caller"],
    risks: [
      "error shape drift between cross-customer and truly-missing would leak existence",
      "list could become slow for very large customer fixtures — but the in-memory Map.values() walk is O(n) in customer's invoices only, not across the whole store",
    ],
    finalAcceptanceCriteria: [
      "store.create(customerA, items) returns ok=true and places the invoice under customerA",
      "store.get(customerA, idOfCustomerA) returns ok=true",
      "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
      "store.list(customerB) returns only customerB's invoices, never customerA's",
    ],
    systemsConcerns: [
      {
        concern: "auth_permissions",
        applicability: "required",
        justification: "",
        requirement:
          "Cross-customer reads MUST return {ok:false, error:{code:'NOT_FOUND'}} — the error object is byte-identical to the truly-missing case. No side channel (timing, logging verbosity, distinct error codes) may distinguish cross-customer from missing.",
        linkedAcIds: [
          "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
          "store.list(customerB) returns only customerB's invoices, never customerA's",
        ],
      },
      {
        concern: "performance_under_load",
        applicability: "required",
        justification: "",
        requirement:
          "store.list(customerId) iterates only that customer's bucket, not the whole store. Complexity is O(m) where m = customer's invoices. Other customers' buckets are never touched.",
        linkedAcIds: [
          "store.list(customerB) returns only customerB's invoices, never customerA's",
        ],
      },
      {
        concern: "failure_modes",
        applicability: "required",
        justification: "",
        requirement:
          "All store mutations return Result<T, {code}>. Cross-customer reads fail with NOT_FOUND; no exception thrown. Create/get/list all go through the same error-shape path so tests can assert byte-identity.",
        linkedAcIds: [
          "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
        ],
      },
    ],
  });

  await callTool("a2p_harden_tests", {
    projectPath: dir,
    sliceId: sid,
    acToTestMap: [
      {
        ac: "store.create(customerA, items) returns ok=true and places the invoice under customerA",
        tests: ["create places invoice under customer"],
        rationale: "happy path for create + scoping",
      },
      {
        ac: "store.get(customerA, idOfCustomerA) returns ok=true",
        tests: ["get own invoice succeeds"],
        rationale: "in-tenant read works",
      },
      {
        ac: "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
        tests: ["cross-customer get hidden as NOT_FOUND", "truly-missing id returns byte-identical NOT_FOUND"],
        rationale: "proves existence-hiding — both cases produce identical error",
      },
      {
        ac: "store.list(customerB) returns only customerB's invoices, never customerA's",
        tests: ["list is customer-scoped"],
        rationale: "prevents listing from leaking other customers' data",
      },
    ],
    positiveCases: ["create + get own", "list own invoices"],
    negativeCases: [
      "cross-customer get returns NOT_FOUND",
      "cross-customer get is byte-identical to truly-missing",
      "list returns zero items when customer has no invoices",
    ],
    edgeCases: [],
    regressions: [],
    additionalConcerns: [
      "error object identity: the cross-customer and truly-missing paths MUST construct the error object through the same helper so test equality is meaningful",
    ],
    doneMetric:
      "4 unit tests green; cross-customer / missing error shapes equal via deepEqual",
    systemsConcernTests: [
      {
        concern: "auth_permissions",
        testNames: [
          "cross-customer get hidden as NOT_FOUND",
          "truly-missing id returns byte-identical NOT_FOUND",
          "list is customer-scoped",
        ],
        evidenceType: "negative",
        rationale:
          "three negative tests pin the boundary: cross-customer ≡ missing, list never leaks",
      },
      {
        concern: "performance_under_load",
        testNames: ["list is customer-scoped"],
        evidenceType: "positive",
        rationale:
          "proves only the target bucket is walked; other buckets' contents never surface",
      },
      {
        concern: "failure_modes",
        testNames: [
          "cross-customer get hidden as NOT_FOUND",
          "truly-missing id returns byte-identical NOT_FOUND",
        ],
        evidenceType: "negative",
        rationale: "NOT_FOUND error shape is proven byte-identical across both code paths",
      },
    ],
  });

  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 1,
    initialPlan:
      "Introduce src/store.ts exporting makeStore() → {create, get, list}. Use Map<customerId, Map<invoiceId, Invoice>>. create calls createInvoice internally then puts. get returns NOT_FOUND when customerId bucket missing OR invoiceId not in bucket. list returns bucket values or [].",
    critique:
      "Initial plan didn't pin a single shared NOT_FOUND error constant — risks drift across code paths. Also doesn't mention that get MUST not reveal any timing difference between cross-customer and missing (in-memory Map lookups are constant-time, so a single early-return is both correct and fast).",
    revisedPlan:
      "Revised: export NOT_FOUND = {code:'NOT_FOUND'} as a frozen constant from src/store.ts and use it for both cross-customer and missing-id paths. get short-circuits on first miss regardless of which layer (customer bucket vs. invoice in bucket). Tests deepEqual the two error objects.",
    improvementsFound: true,
    finalize: false,
  });
  await callTool("a2p_harden_plan", {
    projectPath: dir,
    sliceId: sid,
    round: 2,
    critique: "LGTM — no substantive issues on re-review.",
    revisedPlan:
      "Revised: export NOT_FOUND = {code:'NOT_FOUND'} as a frozen constant from src/store.ts and use it for both cross-customer and missing-id paths. get short-circuits on first miss regardless of which layer (customer bucket vs. invoice in bucket). Tests deepEqual the two error objects.",
    improvementsFound: false,
    finalize: true,
    finalPlan: {
      touchedAreas: ["src/", "tests/"],
      expectedFiles: [
        "src/store.ts",
        "tests/customer-scoping.test.ts",
      ],
      interfacesToChange: ["makeStore", "InvoiceStore", "NOT_FOUND"],
      invariantsToPreserve: [
        "INV-3: cross-customer read is byte-identical to truly-missing read",
      ],
      risks: ["future contributor forgets to use the shared NOT_FOUND constant"],
      narrative:
        "makeStore() returns a closed-over Map<customerId, Map<invoiceId, Invoice>>. create uses createInvoice for total math, then upserts. get/list short-circuit through the shared NOT_FOUND constant for any miss regardless of layer.",
      systemsConcernPlans: [
        {
          concern: "auth_permissions",
          approach:
            "Shared NOT_FOUND constant guarantees cross-customer and truly-missing produce the same error object. list iterates only the customer's bucket — no global iteration.",
          filesTouched: ["src/store.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "performance_under_load",
          approach:
            "Map<customerId, Map<invoiceId, Invoice>> gives O(1) get + O(m) list where m = customer's invoice count; no global scan.",
          filesTouched: ["src/store.ts"],
          rollbackStrategy: null,
        },
        {
          concern: "failure_modes",
          approach:
            "Every read goes through the same short-circuit → NOT_FOUND path. No exceptions. Tests assert deepEqual on the two failure paths.",
          filesTouched: ["src/store.ts"],
          rollbackStrategy: null,
        },
      ],
    },
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "ready_for_red",
  });

  // Write failing test first
  write(
    join(dir, "tests", "customer-scoping.test.ts"),
    `import { describe, it, expect } from "vitest";
import { makeStore, NOT_FOUND } from "../src/store.js";

describe("customer-scoped InvoiceStore", () => {
  it("create places invoice under customer", () => {
    const store = makeStore();
    const r = store.create("cA", {
      items: [{ quantity: 1, unitPrice: 10, description: "x" }],
      discount: 0,
      tax: 0,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.customerId).toBe("cA");
  });

  it("get own invoice succeeds", () => {
    const store = makeStore();
    const c = store.create("cA", {
      items: [{ quantity: 1, unitPrice: 10, description: "x" }],
      discount: 0,
      tax: 0,
    });
    if (!c.ok) throw new Error("setup");
    const g = store.get("cA", c.value.id);
    expect(g.ok).toBe(true);
  });

  it("cross-customer get hidden as NOT_FOUND", () => {
    const store = makeStore();
    const c = store.create("cA", {
      items: [{ quantity: 1, unitPrice: 10, description: "x" }],
      discount: 0,
      tax: 0,
    });
    if (!c.ok) throw new Error("setup");
    const g = store.get("cB", c.value.id);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.error).toEqual(NOT_FOUND);
  });

  it("truly-missing id returns byte-identical NOT_FOUND", () => {
    const store = makeStore();
    const gCross = store.get("cB", "inv-does-not-exist");
    const gMissing = store.get("cA", "inv-does-not-exist");
    expect(gCross.ok).toBe(false);
    expect(gMissing.ok).toBe(false);
    if (!gCross.ok && !gMissing.ok) {
      expect(gCross.error).toEqual(gMissing.error);
    }
  });

  it("list is customer-scoped", () => {
    const store = makeStore();
    store.create("cA", { items: [{ quantity: 1, unitPrice: 10, description: "x" }], discount: 0, tax: 0 });
    store.create("cA", { items: [{ quantity: 2, unitPrice: 5, description: "y" }], discount: 0, tax: 0 });
    store.create("cB", { items: [{ quantity: 1, unitPrice: 3, description: "z" }], discount: 0, tax: 0 });
    const listA = store.list("cA");
    const listB = store.list("cB");
    expect(listA.length).toBe(2);
    expect(listB.length).toBe(1);
    expect(listA.every((i) => i.customerId === "cA")).toBe(true);
    expect(listB.every((i) => i.customerId === "cB")).toBe(true);
  });
});
`,
  );

  await callTool("a2p_verify_test_first", {
    projectPath: dir,
    sliceId: sid,
    testCommand: "npx vitest run",
    timeoutMs: 90_000,
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "red",
  });

  // Implementation — store.ts with shared NOT_FOUND constant
  write(
    join(dir, "src", "store.ts"),
    `import type { Invoice, LineItem, Result } from "./types.js";
import { createInvoice } from "./invoice.js";

export const NOT_FOUND = Object.freeze({ code: "NOT_FOUND" as const });

export type StoreError = typeof NOT_FOUND | { code: "INVALID_ITEM" | "EMPTY_ITEMS" };

export interface CreateInput {
  readonly items: readonly LineItem[];
  readonly discount: number;
  readonly tax: number;
}

export interface InvoiceStore {
  create(customerId: string, input: CreateInput): Result<Invoice, StoreError>;
  get(customerId: string, invoiceId: string): Result<Invoice, typeof NOT_FOUND>;
  list(customerId: string): readonly Invoice[];
}

/**
 * Per-customer in-memory store. Cross-customer and truly-missing reads
 * both produce the shared NOT_FOUND constant so callers cannot
 * distinguish existence via error-object inspection.
 */
export function makeStore(): InvoiceStore {
  const byCustomer = new Map<string, Map<string, Invoice>>();

  return {
    create(customerId, input) {
      const r = createInvoice({
        customerId,
        items: input.items,
        discount: input.discount,
        tax: input.tax,
      });
      if (!r.ok) return r;
      let bucket = byCustomer.get(customerId);
      if (!bucket) {
        bucket = new Map();
        byCustomer.set(customerId, bucket);
      }
      bucket.set(r.value.id, r.value);
      return { ok: true, value: r.value };
    },

    get(customerId, invoiceId) {
      const bucket = byCustomer.get(customerId);
      if (!bucket) return { ok: false, error: NOT_FOUND };
      const inv = bucket.get(invoiceId);
      if (!inv) return { ok: false, error: NOT_FOUND };
      return { ok: true, value: inv };
    },

    list(customerId) {
      const bucket = byCustomer.get(customerId);
      if (!bucket) return [];
      return Array.from(bucket.values());
    },
  };
}
`,
  );

  const runR = await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });
  expect(runR.success).toBe(true);

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "green",
    files: ["src/store.ts", "tests/customer-scoping.test.ts"],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "refactor",
  });

  await callTool("a2p_run_sast", {
    projectPath: dir,
    sliceId: sid,
    mode: "slice",
    files: ["src/store.ts"],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "sast",
  });

  await callTool("a2p_run_tests", {
    projectPath: dir,
    sliceId: sid,
    command: "npx vitest run",
    timeoutMs: 90_000,
  });

  await callTool("a2p_completion_review", {
    projectPath: dir,
    sliceId: sid,
    acCoverage: [
      {
        ac: "store.create(customerA, items) returns ok=true and places the invoice under customerA",
        status: "met",
        evidence: "tests/customer-scoping.test.ts: create places invoice under customer",
      },
      {
        ac: "store.get(customerA, idOfCustomerA) returns ok=true",
        status: "met",
        evidence: "tests/customer-scoping.test.ts: get own invoice succeeds",
      },
      {
        ac: "store.get(customerB, idOfCustomerA) returns ok=false code=NOT_FOUND byte-identical to a truly-missing id",
        status: "met",
        evidence:
          "tests/customer-scoping.test.ts: cross-customer get hidden as NOT_FOUND + truly-missing id returns byte-identical NOT_FOUND (deepEqual)",
      },
      {
        ac: "store.list(customerB) returns only customerB's invoices, never customerA's",
        status: "met",
        evidence: "tests/customer-scoping.test.ts: list is customer-scoped",
      },
    ],
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
    systemsConcernReviews: [
      {
        concern: "auth_permissions",
        verdict: "satisfied",
        evidence:
          "src/store.ts:3 — frozen NOT_FOUND constant shared by cross-customer + truly-missing paths; tests deepEqual the two errors",
        shortfall: "",
      },
      {
        concern: "performance_under_load",
        verdict: "satisfied",
        evidence:
          "src/store.ts:37 list() iterates only the customer's bucket — other customers' buckets are never touched; list test proves scoping",
        shortfall: "",
      },
      {
        concern: "failure_modes",
        verdict: "satisfied",
        evidence:
          "src/store.ts:28-36 — every get path short-circuits to the shared NOT_FOUND; no exceptions",
        shortfall: "",
      },
    ],
  });

  await callTool("a2p_update_slice", {
    projectPath: dir,
    sliceId: sid,
    status: "done",
  });
}
