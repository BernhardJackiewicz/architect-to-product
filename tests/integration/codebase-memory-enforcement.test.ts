/**
 * A2P v2.0.2 — codebase-memory enforcement gate tests.
 *
 * Verifies:
 *  1. `planning → building` is blocked when no codebase-memory companion
 *     is registered AND the architecture does not opt out.
 *  2. The same transition succeeds once codebase-memory is registered
 *     via `a2p_setup_companions` (binary present on CI unknown — we use
 *     the `required:false` escape so the install check doesn't poison
 *     the test).
 *  3. Explicit bypass via `architecture.bypassCodebaseMemory` + rationale
 *     lets the transition through with an audit trail.
 *  4. `a2p_setup_companions` with a missing required companion returns
 *     an error unless `allowMissingRequired:true` is set with a
 *     non-empty bypassRationale.
 *  5. `a2p_verify_codebase_memory_index` writes codebaseMemoryReadiness
 *     to state.json.
 *  6. The soft warning on `pending → ready_for_red` is present when
 *     indexed=false and suppressed when indexed=true.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleSetupCompanions } from "../../src/tools/setup-companions.js";
import { handleSetPhase } from "../../src/tools/set-phase.js";
import { handleVerifyCodebaseMemoryIndex } from "../../src/tools/verify-codebase-memory-index.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, seedSliceHardening } from "../helpers/setup.js";

function bootstrap(dir: string): void {
  handleInitProject({ projectPath: dir, projectName: "cm-enforcement" });
  handleSetArchitecture({
    projectPath: dir,
    name: "CM Enforcement",
    description: "Fixture project for v2.0.2 codebase-memory enforcement tests",
    language: "TypeScript",
    framework: "Express",
    features: ["f1"],
    dataModel: "none",
    apiDesign: "REST",
  });
  handleCreateBuildPlan({
    projectPath: dir,
    slices: [
      {
        id: "s1",
        name: "Slice 1",
        description: "Stub slice",
        acceptanceCriteria: ["placeholder"],
        testStrategy: "unit",
        dependencies: [],
      },
    ],
  });
}

describe("A2P v2.0.2 — codebase-memory enforcement gate", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-cm-enforce");
  });
  afterEach(() => {
    cleanTmpDir(dir);
  });

  it("planning → building is blocked when codebase-memory is not registered", () => {
    bootstrap(dir);
    const res = parse(
      handleSetPhase({ projectPath: dir, phase: "building" }),
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/codebase-memory/);
    expect(res.error).toMatch(/bypassCodebaseMemory|setup_companions/);
  });

  it("planning → building succeeds once codebase-memory is registered via setup_companions", () => {
    bootstrap(dir);
    // `required: false` avoids the binary-availability gate in setup_companions
    // itself — this test specifically exercises the OUTER phase gate.
    const setup = parse(
      handleSetupCompanions({
        projectPath: dir,
        companions: [
          {
            type: "codebase_memory",
            name: "codebase-memory",
            command: "codebase-memory-mcp",
            required: false,
          },
        ],
      }),
    );
    expect(setup.success).toBe(true);
    const transition = parse(
      handleSetPhase({ projectPath: dir, phase: "building" }),
    );
    expect(transition.error).toBeUndefined();
    expect(transition.to).toBe("building");
  });

  it("explicit architecture.bypassCodebaseMemory + rationale ≥20 chars lets the transition through", () => {
    bootstrap(dir);
    // Mutate architecture directly via StateManager — that's what the
    // architecture schema supports; tools that set architecture would
    // surface the fields if the user provided them at set_architecture time.
    const sm = new StateManager(dir);
    const state = sm.read();
    state.architecture!.bypassCodebaseMemory = true;
    state.architecture!.bypassCodebaseMemoryRationale =
      "This is a greenfield spike; no cross-file exploration is required for the next two weeks.";
    sm.setArchitecture(state.architecture!);

    const transition = parse(
      handleSetPhase({ projectPath: dir, phase: "building" }),
    );
    expect(transition.error).toBeUndefined();
    expect(transition.to).toBe("building");
  });

  it("bypass without rationale still trips the gate", () => {
    bootstrap(dir);
    const sm = new StateManager(dir);
    const state = sm.read();
    state.architecture!.bypassCodebaseMemory = true;
    state.architecture!.bypassCodebaseMemoryRationale = "too short"; // < 20 chars
    sm.setArchitecture(state.architecture!);

    const res = parse(
      handleSetPhase({ projectPath: dir, phase: "building" }),
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/codebase-memory/);
  });

  it("setup_companions rejects a missing required codebase-memory without allowMissingRequired", () => {
    bootstrap(dir);
    const res = parse(
      handleSetupCompanions({
        projectPath: dir,
        companions: [
          {
            type: "codebase_memory",
            name: "cm",
            command: "definitely-not-a-real-binary-xyz-9999",
            // required defaults to true for codebase_memory
          },
        ],
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/codebase_memory|codebase-memory/);
    expect(res.missingRequired).toBeDefined();
    expect(res.installHints).toBeDefined();
  });

  it("setup_companions accepts allowMissingRequired:true with bypassRationale and records bypass", () => {
    bootstrap(dir);
    const res = parse(
      handleSetupCompanions({
        projectPath: dir,
        companions: [
          {
            type: "codebase_memory",
            name: "cm",
            command: "definitely-not-a-real-binary-xyz-9999",
          },
        ],
        allowMissingRequired: true,
        bypassRationale: "CI sandbox without the codebase-memory-mcp binary available",
      }),
    );
    expect(res.success).toBe(true);
    expect(res.bypassedRequired).toBeDefined();
    expect(res.bypassedRequired[0].type).toBe("codebase_memory");

    const state = new StateManager(dir).read();
    expect(state.config.companionBypasses).toBeDefined();
    expect(state.config.companionBypasses?.[0].rationale).toContain("CI sandbox");
  });

  it("setup_companions rejects allowMissingRequired:true without rationale", () => {
    bootstrap(dir);
    const res = parse(
      handleSetupCompanions({
        projectPath: dir,
        companions: [
          {
            type: "codebase_memory",
            name: "cm",
            command: "definitely-not-a-real-binary-xyz-9999",
          },
        ],
        allowMissingRequired: true,
        // bypassRationale intentionally omitted
      }),
    );
    expect(res.error).toBeDefined();
    expect(res.error).toMatch(/bypassRationale/);
  });

  it("verify_codebase_memory_index persists codebaseMemoryReadiness", () => {
    bootstrap(dir);
    const res = parse(
      handleVerifyCodebaseMemoryIndex({
        projectPath: dir,
        indexed: true,
        lastIndexedAt: "2026-04-17T12:00:00Z",
        nodeCount: 811,
        edgeCount: 1079,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.codebaseMemoryReadiness.indexed).toBe(true);
    expect(res.codebaseMemoryReadiness.lastIndexedAt).toBe("2026-04-17T12:00:00Z");
    expect(res.nodeCount).toBe(811);
    expect(res.edgeCount).toBe(1079);

    const state = new StateManager(dir).read();
    expect(state.codebaseMemoryReadiness?.indexed).toBe(true);
  });

  it("update_slice to ready_for_red emits soft warning when index not recorded", () => {
    // Walk the project into building phase via setup_companions.
    bootstrap(dir);
    handleSetupCompanions({
      projectPath: dir,
      companions: [
        {
          type: "codebase_memory",
          name: "codebase-memory",
          command: "codebase-memory-mcp",
          required: false,
        },
      ],
    });
    handleSetPhase({ projectPath: dir, phase: "building" });

    // Seed the slice with hardening evidence so the pre-RED gate doesn't
    // reject — we're testing the soft codebase-memory warning, not the
    // hardening gate itself.
    const sm = new StateManager(dir);
    seedSliceHardening(sm, "s1");

    const res = parse(
      handleUpdateSlice({
        projectPath: dir,
        sliceId: "s1",
        status: "ready_for_red",
      }),
    );
    expect(res.error).toBeUndefined();
    expect(res.codebaseMemoryWarning).toBeDefined();
    expect(res.codebaseMemoryWarning).toMatch(/SOFT WARNING/);
    expect(res.codebaseMemoryWarning).toMatch(/index_repository/);
  });

  it("update_slice to ready_for_red is silent when index is recorded fresh", () => {
    bootstrap(dir);
    handleSetupCompanions({
      projectPath: dir,
      companions: [
        {
          type: "codebase_memory",
          name: "codebase-memory",
          command: "codebase-memory-mcp",
          required: false,
        },
      ],
    });
    handleVerifyCodebaseMemoryIndex({
      projectPath: dir,
      indexed: true,
      lastIndexedAt: new Date().toISOString(),
    });
    handleSetPhase({ projectPath: dir, phase: "building" });

    const sm = new StateManager(dir);
    seedSliceHardening(sm, "s1");

    const res = parse(
      handleUpdateSlice({
        projectPath: dir,
        sliceId: "s1",
        status: "ready_for_red",
      }),
    );
    expect(res.error).toBeUndefined();
    expect(res.codebaseMemoryWarning).toBeUndefined();
  });
});
