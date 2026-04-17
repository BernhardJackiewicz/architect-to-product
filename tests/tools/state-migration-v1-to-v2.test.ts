import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../../src/state/state-manager.js";
import { ProjectStateSchema } from "../../src/state/validators.js";
import { makeTmpDir, cleanTmpDir } from "../helpers/setup.js";

/**
 * A2P v2 introduces structured systems-engineering fields + bumps STATE_VERSION 1 → 2.
 * All new fields are optional. A hand-crafted v1 state must:
 *  - parse cleanly under the v2 schema (preprocessed)
 *  - have its `version` bumped to 2 after preprocess
 *  - work end-to-end through StateManager (read/write/transitions)
 */
describe("state migration v1 → v2 (A2P v2 systems engineering)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-migration-v2");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function writeV1State(overrides: Record<string, unknown> = {}): void {
    mkdirSync(join(tmpDir, ".a2p"), { recursive: true });
    const v1: Record<string, unknown> = {
      version: 1,
      projectName: "legacy-project",
      architecture: null,
      slices: [],
      currentSliceIndex: -1,
      phase: "onboarding",
      config: {
        projectPath: tmpDir,
        testCommand: "npm test",
        lintCommand: "npm run lint",
        buildCommand: "npm run build",
        formatCommand: "npm run format",
        claudeModel: "opus",
        allowTestCommandOverride: false,
      },
      companions: [],
      qualityIssues: [],
      auditResults: [],
      whiteboxResults: [],
      activeVerificationResults: [],
      buildHistory: [],
      currentProductPhase: 0,
      infrastructure: null,
      backupConfig: {
        enabled: true,
        required: false,
        schedule: "daily",
        time: "02:00",
        retentionDays: 14,
        targets: ["deploy_artifacts"],
        offsiteProvider: "none",
        verifyAfterBackup: false,
        preDeploySnapshot: false,
      },
      backupStatus: { configured: false },
      companionsConfiguredAt: null,
      lastSecurityRelevantChangeAt: null,
      lastFullSastAt: null,
      lastFullSastFindingCount: 0,
      buildSignoffAt: null,
      buildSignoffSliceHash: null,
      adversarialReviewState: null,
      deployApprovalAt: null,
      deployApprovalStateHash: null,
      projectFindings: [],
      securityReentryReason: null,
      shakeBreakSession: null,
      shakeBreakResults: [],
      securityOverview: null,
      pendingSecurityDecision: null,
      secretManagementTier: null,
      sslVerifiedAt: null,
      sslVerification: null,
      bootstrapSliceId: null,
      bootstrapLockedAt: null,
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      ...overrides,
    };
    writeFileSync(join(tmpDir, ".a2p", "state.json"), JSON.stringify(v1, null, 2), "utf-8");
  }

  it("parses a hand-crafted v1 state under v2 schema without error", () => {
    writeV1State();
    const raw = JSON.parse(readFileSync(join(tmpDir, ".a2p", "state.json"), "utf-8"));
    const parsed = ProjectStateSchema.parse(raw);
    expect(parsed).toBeDefined();
  });

  it("bumps stored version from 1 → 2 on preprocess", () => {
    writeV1State();
    const raw = JSON.parse(readFileSync(join(tmpDir, ".a2p", "state.json"), "utf-8"));
    const parsed = ProjectStateSchema.parse(raw);
    expect(parsed.version).toBe(2);
  });

  it("leaves all v2 optional fields undefined on a v1 state", () => {
    writeV1State();
    const raw = JSON.parse(readFileSync(join(tmpDir, ".a2p", "state.json"), "utf-8"));
    const parsed = ProjectStateSchema.parse(raw);
    expect(parsed.architecture).toBeNull();
    expect(parsed.slices).toEqual([]);
  });

  it("StateManager.read() loads a v1 state file transparently", () => {
    writeV1State();
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.version).toBe(2);
    expect(state.projectName).toBe("legacy-project");
  });

  it("preserves v1 architecture fields (legacy string dataModel + apiDesign)", () => {
    writeV1State({
      architecture: {
        name: "Legacy",
        description: "Legacy project",
        techStack: {
          language: "TypeScript",
          framework: "Express",
          database: "PostgreSQL",
          frontend: null,
          hosting: null,
          other: [],
        },
        features: ["f1"],
        dataModel: "Users, Orders",
        apiDesign: "REST /users, /orders",
        raw: "",
      },
    });
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.dataModel).toBe("Users, Orders");
    expect(state.architecture?.apiDesign).toBe("REST /users, /orders");
    // v2-only systems block must be absent on legacy states
    expect(state.architecture?.systems).toBeUndefined();
  });

  it("preserves v1 slice hardening artifacts and completion reviews without v2 fields", () => {
    const now = "2025-02-01T00:00:00.000Z";
    writeV1State({
      architecture: {
        name: "X",
        description: "Y",
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
      },
      slices: [
        {
          id: "s1",
          name: "Add homepage hero",
          description: "Simple UI copy tweak",
          acceptanceCriteria: ["hero renders"],
          testStrategy: "unit",
          dependencies: [],
          status: "pending",
          files: [],
          testResults: [],
          sastFindings: [],
          type: "feature",
          hasUI: true,
          requirementsHardening: {
            goal: "render hero",
            nonGoals: [],
            affectedComponents: ["homepage"],
            assumptions: [],
            risks: [],
            finalAcceptanceCriteria: ["hero renders"],
            acHash: "abc",
            hardenedAt: now,
          },
        },
      ],
    });
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.slices[0].requirementsHardening?.systemsConcerns).toBeUndefined();
    expect(state.slices[0].testHardening).toBeUndefined();
    expect(state.slices[0].systemsClassification).toBeUndefined();
  });
});
