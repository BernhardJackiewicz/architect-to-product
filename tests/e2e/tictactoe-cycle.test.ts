import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleInitProject } from "../../src/tools/init-project.js";
import { handleGetState } from "../../src/tools/get-state.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleBuildSignoff } from "../../src/tools/build-signoff.js";
import { handleRunSast } from "../../src/tools/run-sast.js";
import { handleSetSecretManagement } from "../../src/tools/set-secret-management.js";
import { handleDeployApproval } from "../../src/tools/deploy-approval.js";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleDeployToServer } from "../../src/tools/deploy-to-server.js";
import { handleVerifySsl } from "../../src/tools/verify-ssl.js";
import { StateManager } from "../../src/state/state-manager.js";
import {
  makeTmpDir,
  cleanTmpDir,
  parse,
  addPassingTests,
  addSastEvidence,
  addQualityAudit,
  addReleaseAudit,
  addPassingVerification,
  addPassingWhitebox,
  useLegacySliceFlow,
} from "../helpers/setup.js";

/**
 * Full-cycle E2E test for a TicTacToe game project.
 *
 * Validates ALL 3 bug fixes working together end-to-end:
 *   Bug 1: Shake-break coverage integration — coverageByArea reflects shake-break results
 *   Bug 2: Secret management tier comparison — both generateDeployment and deployToServer return tierComparison
 *   Bug 3: SSL gate enforcement — setPhase("complete") blocked without SSL, succeeds after
 */
useLegacySliceFlow();

describe("Full Cycle E2E: TicTacToe Game", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-tictactoe");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Helper: set up project through onboarding ─────────────────────

  function initTicTacToe(): void {
    handleInitProject({ projectPath: tmpDir, projectName: "tictactoe" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "TicTacToe Game",
      description: "Classic 3x3 TicTacToe with two players, win detection, and draw handling",
      language: "TypeScript",
      framework: "React",
      features: [
        "3x3 game board",
        "alternating X/O turns",
        "win detection (rows, columns, diagonals)",
        "draw detection",
        "game reset",
        "move history",
      ],
      dataModel: "none — local state only",
      apiDesign: "none — client-side only",
    });
  }

  function createSlices(): void {
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "game-board",
          name: "Game Board UI",
          description: "3x3 grid component with clickable cells displaying X/O",
          acceptanceCriteria: [
            "Renders a 3x3 grid of cells",
            "Each cell is clickable when empty",
            "Displays X or O after click",
          ],
          testStrategy: "vitest + react-testing-library",
          dependencies: [],
        },
        {
          id: "game-logic",
          name: "Game Logic",
          description: "Turn management, win/draw detection, game reset",
          acceptanceCriteria: [
            "Alternates between X and O turns",
            "Detects winning combinations (rows, cols, diagonals)",
            "Detects draw when board is full",
            "Reset clears the board and starts with X",
          ],
          testStrategy: "vitest unit tests for pure logic",
          dependencies: ["game-board"],
        },
      ],
    });
  }

  function walkSliceToDone(sm: StateManager, sliceId: string, files: string[]): void {
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "red", files });
    addPassingTests(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "green", files });
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "refactor" });
    addSastEvidence(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "sast" });
    addPassingTests(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" });
  }

  // ─── Phase 0: Onboarding ─────────────────────────────────────────

  describe("Phase 0: Onboarding — init + architecture", () => {
    it("initializes the TicTacToe project", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "tictactoe" })
      );
      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".a2p/state.json");
    });

    it("sets architecture for a React/TypeScript TicTacToe game (no database, no hosting)", () => {
      initTicTacToe();

      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.projectName).toBe("tictactoe");
      expect(state.phase).toBe("onboarding");
      expect(state.architecture.name).toBe("TicTacToe Game");
      expect(state.architecture.techStack.language).toBe("TypeScript");
      expect(state.architecture.techStack.framework).toBe("React");
      // No database and no hosting specified
      expect(state.architecture.techStack.database).toBeNull();
      expect(state.architecture.techStack.hosting).toBeNull();
    });
  });

  // ─── Phase 1: Planning ────────────────────────────────────────────

  describe("Phase 1: Planning — build plan with 2 slices", () => {
    it("creates two slices: game-board and game-logic", () => {
      initTicTacToe();
      createSlices();

      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.progress.totalSlices).toBe(2);
      // getState doesn't expose slices array; verify via StateManager
      const sm = new StateManager(tmpDir);
      const raw = sm.read();
      expect(raw.slices[0].id).toBe("game-board");
      expect(raw.slices[1].id).toBe("game-logic");
    });
  });

  // ─── Phase 2: Building ───────────────────────────────────────────

  describe("Phase 2: Building — TDD cycle for both slices", () => {
    let sm: StateManager;

    beforeEach(() => {
      initTicTacToe();
      createSlices();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");
    });

    it("walks both slices through TDD to done and signs off", () => {
      walkSliceToDone(sm, "game-board", ["src/Board.tsx", "src/Board.test.tsx"]);
      walkSliceToDone(sm, "game-logic", ["src/game-logic.ts", "src/game-logic.test.ts"]);

      const signoff = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "Both slices complete — board renders, game logic detects wins/draws",
        })
      );
      expect(signoff.success).toBe(true);
      expect(signoff.signedOffAt).toBeTruthy();
    });
  });

  // ─── Bug 1: Shake-break coverage integration ─────────────────────

  describe("Bug 1: Shake-break coverage integration", () => {
    let sm: StateManager;

    beforeEach(() => {
      initTicTacToe();
      createSlices();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "game-board", ["src/Board.tsx"]);
      walkSliceToDone(sm, "game-logic", ["src/game-logic.ts"]);

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      // Full SAST + whitebox + adversarial review
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
    });

    it("coverage increases after adding shake-break results", () => {
      // Capture coverage BEFORE shake-break
      const stateBefore = sm.read();
      expect(stateBefore.securityOverview).not.toBeNull();
      const coverageBefore = new Map(
        stateBefore.securityOverview!.coverageByArea.map(a => [a.id, a.coverageEstimate])
      );

      // Add shake-break results with specific categories
      sm.addShakeBreakResult({
        id: `SB-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 5,
        categoriesTested: ["auth_idor", "business_logic", "token_session"],
        findingsRecorded: 0,
        note: "Shake-break for TicTacToe — no vulnerabilities found",
      });

      // Capture coverage AFTER shake-break
      const stateAfter = sm.read();
      expect(stateAfter.securityOverview).not.toBeNull();
      const coverageAfter = new Map(
        stateAfter.securityOverview!.coverageByArea.map(a => [a.id, a.coverageEstimate])
      );

      // auth_idor maps to ["auth-session", "data-access"]
      // business_logic maps to ["business-logic", "vuln-chaining"]
      // token_session maps to ["auth-session", "infra-secrets"]
      // Each shake-break category adds 15 to its mapped domains

      // "auth-session" should increase (from auth_idor + token_session)
      const authBefore = coverageBefore.get("auth-session") ?? 0;
      const authAfter = coverageAfter.get("auth-session") ?? 0;
      expect(authAfter).toBeGreaterThan(authBefore);
      expect(authAfter - authBefore).toBeGreaterThanOrEqual(15); // at least one category contributes

      // "business-logic" should increase (from business_logic)
      const bizBefore = coverageBefore.get("business-logic") ?? 0;
      const bizAfter = coverageAfter.get("business-logic") ?? 0;
      expect(bizAfter).toBeGreaterThan(bizBefore);

      // "infra-secrets" should increase (from token_session)
      const infraBefore = coverageBefore.get("infra-secrets") ?? 0;
      const infraAfter = coverageAfter.get("infra-secrets") ?? 0;
      expect(infraAfter).toBeGreaterThan(infraBefore);

      // Verify all coverage entries have valid structure
      for (const area of stateAfter.securityOverview!.coverageByArea) {
        expect(typeof area.id).toBe("string");
        expect(typeof area.coverageEstimate).toBe("number");
        expect(area.coverageEstimate).toBeGreaterThanOrEqual(0);
        expect(area.coverageEstimate).toBeLessThanOrEqual(100);
      }
    });
  });

  // ─── Bug 2: Secret management tier comparison ────────────────────

  describe("Bug 2: Secret management tier comparison from both tools", () => {
    let sm: StateManager;

    beforeEach(() => {
      initTicTacToe();
      createSlices();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "game-board", ["src/Board.tsx"]);
      walkSliceToDone(sm, "game-logic", ["src/game-logic.ts"]);

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      sm.setPhase("deployment");
    });

    function assertTierComparison(tierComparison: any[]): void {
      expect(Array.isArray(tierComparison)).toBe(true);
      expect(tierComparison.length).toBe(4);

      const tierIds = tierComparison.map((t: any) => t.id);
      expect(tierIds).toContain("env-file");
      expect(tierIds).toContain("docker-swarm");
      expect(tierIds).toContain("infisical");
      expect(tierIds).toContain("external");

      for (const entry of tierComparison) {
        expect(typeof entry.tier).toBe("number");
        expect(typeof entry.id).toBe("string");
        expect(typeof entry.name).toBe("string");
        expect(typeof entry.bestFor).toBe("string");
        expect(Array.isArray(entry.pros)).toBe(true);
        expect(Array.isArray(entry.cons)).toBe(true);
        expect(entry.pros.length).toBeGreaterThan(0);
        expect(entry.cons.length).toBeGreaterThan(0);
      }
    }

    it("handleGenerateDeployment returns tierComparison when no tier set", () => {
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.error).toContain("Secret management tier not chosen");
      expect(result.tierComparison).toBeDefined();
      assertTierComparison(result.tierComparison);
    });

    it("handleDeployToServer returns tierComparison when no tier set", () => {
      // deployToServer requires infrastructure — but it checks tier BEFORE
      // infrastructure when no tier is set. Record minimal infra so the error
      // is about secrets, not about missing infrastructure.
      // Actually, deploy-to-server checks infra first, so without infra it
      // returns the infra error. Let's record infra to get the tier error.
      sm.setInfrastructure({
        provider: "hetzner",
        serverId: "srv-1",
        serverName: "tictactoe-prod",
        serverIp: "1.2.3.4",
        serverType: "cx11",
        location: "fsn1",
        sshUser: "root",
        sshKeyFingerprint: "abc123",
        domain: "tictactoe.example.com",
        provisionedAt: new Date().toISOString(),
        lastDeployedAt: null,
      });

      const result = parse(handleDeployToServer({ projectPath: tmpDir }));
      expect(result.error).toBeDefined();
      expect(result.tierComparison).toBeDefined();
      assertTierComparison(result.tierComparison);
    });
  });

  // ─── Bug 3: SSL gate enforcement ─────────────────────────────────

  describe("Bug 3: SSL gate enforcement end-to-end", () => {
    let sm: StateManager;

    beforeEach(() => {
      initTicTacToe();
      createSlices();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "game-board", ["src/Board.tsx"]);
      walkSliceToDone(sm, "game-logic", ["src/game-logic.ts"]);

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      sm.setPhase("deployment");
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });
    });

    it("setPhase('complete') fails without SSL — error contains MANDATORY HARD STOP", () => {
      expect(() => sm.setPhase("complete")).toThrow(/MANDATORY HARD STOP/i);
    });

    it("setPhase('complete') succeeds after SSL verification", () => {
      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "tictactoe.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);

      // Now complete should work
      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");
    });

    it("IP-only: setPhase('complete') succeeds after ip-only-acknowledged", () => {
      // Verify SSL with IP-only acknowledgment
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "1.2.3.4",
          method: "ip-only-acknowledged",
          issuer: "none (IP-only)",
          autoRenewal: false,
          httpsRedirect: false,
          hstsPresent: false,
        })
      );
      expect(sslResult.success).toBe(true);
      expect(sslResult.ipOnlyNote).toBeDefined();
      expect(sslResult.domainRecommendation).toBeDefined();
      expect(sslResult.warnings.length).toBeGreaterThan(0);
      expect(sslResult.warnings[0]).toContain("HTTP only");

      // Now complete should work
      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");
      expect(finalState.sslVerification!.method).toBe("ip-only-acknowledged");
    });

    it("IP-only: blocked when domain is configured in infrastructure", () => {
      // Record infrastructure WITH a domain
      sm.setInfrastructure({
        provider: "hetzner",
        serverId: "srv-1",
        serverName: "test",
        serverIp: "1.2.3.4",
        serverType: "cx11",
        location: "fsn1",
        sshUser: "root",
        sshKeyFingerprint: "abc",
        domain: "tictactoe.example.com",
        provisionedAt: new Date().toISOString(),
        lastDeployedAt: null,
      });

      // IP-only should be blocked when domain exists
      const result = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "1.2.3.4",
          method: "ip-only-acknowledged",
          issuer: "none (IP-only)",
          autoRenewal: false,
          httpsRedirect: false,
          hstsPresent: false,
        })
      );
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Cannot use ip-only-acknowledged when a domain is configured");
    });
  });

  // ─── Full Integration: init → complete ────────────────────────────

  describe("Full lifecycle: TicTacToe from init to complete", () => {
    it("completes the entire TicTacToe workflow verifying all 3 bug fixes", { timeout: 30_000 }, () => {
      // ── Phase 0: Init + Architecture ──
      const initResult = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "tictactoe" })
      );
      expect(initResult.success).toBe(true);

      const archResult = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "TicTacToe Game",
          description: "Classic 3x3 TicTacToe with two players, win detection, and draw handling",
          language: "TypeScript",
          framework: "React",
          features: [
            "3x3 game board",
            "alternating X/O turns",
            "win detection",
            "draw detection",
            "game reset",
            "move history",
          ],
          dataModel: "none — local state only",
          apiDesign: "none — client-side only",
        })
      );
      expect(archResult.success).toBe(true);
      expect(archResult.architecture.techStack.database).toBeNull();
      expect(archResult.architecture.techStack.hosting).toBeNull();

      // ── Phase 1: Plan ──
      const planResult = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "game-board",
              name: "Game Board UI",
              description: "3x3 grid with clickable cells",
              acceptanceCriteria: ["Renders 3x3 grid", "Cells are clickable", "Shows X/O"],
              testStrategy: "vitest + react-testing-library",
              dependencies: [],
            },
            {
              id: "game-logic",
              name: "Game Logic",
              description: "Turn management, win/draw detection, reset",
              acceptanceCriteria: ["Alternates turns", "Detects wins", "Detects draw", "Reset works"],
              testStrategy: "vitest unit tests",
              dependencies: ["game-board"],
            },
          ],
        })
      );
      expect(planResult.success).toBe(true);
      expect(planResult.sliceCount).toBe(2);

      // ── Phase 2: Build (TDD) ──
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Slice 1: game-board
      handleUpdateSlice({
        projectPath: tmpDir, sliceId: "game-board", status: "red",
        files: ["src/Board.test.tsx"],
      });
      addPassingTests(sm, "game-board");
      handleUpdateSlice({
        projectPath: tmpDir, sliceId: "game-board", status: "green",
        files: ["src/Board.tsx", "src/Cell.tsx"],
      });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-board", status: "refactor" });
      addSastEvidence(sm, "game-board");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-board", status: "sast" });
      addPassingTests(sm, "game-board");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-board", status: "done" });

      // Slice 2: game-logic
      handleUpdateSlice({
        projectPath: tmpDir, sliceId: "game-logic", status: "red",
        files: ["src/game-logic.test.ts"],
      });
      addPassingTests(sm, "game-logic");
      handleUpdateSlice({
        projectPath: tmpDir, sliceId: "game-logic", status: "green",
        files: ["src/game-logic.ts", "src/App.tsx"],
      });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-logic", status: "refactor" });
      addSastEvidence(sm, "game-logic");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-logic", status: "sast" });
      addPassingTests(sm, "game-logic");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "game-logic", status: "done" });

      // Build signoff
      const signoff = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "TicTacToe: board renders, game logic detects wins/draws/reset",
        })
      );
      expect(signoff.success).toBe(true);

      // Quality audit (building → security gate)
      addQualityAudit(sm);

      // ── Phase 3: Security ──
      sm.setPhase("security");
      expect(parse(handleGetState({ projectPath: tmpDir })).phase).toBe("security");

      // Full SAST
      sm.markFullSastRun(0);

      // Whitebox + adversarial review
      addPassingWhitebox(sm);

      // ── Bug 1 verification: securityOverview before shake-break ──
      const stateBeforeSB = sm.read();
      expect(stateBeforeSB.securityOverview).not.toBeNull();
      const coverageBefore = new Map(
        stateBeforeSB.securityOverview!.coverageByArea.map(a => [a.id, a.coverageEstimate])
      );

      // Add shake-break results
      sm.addShakeBreakResult({
        id: `SB-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 8,
        categoriesTested: ["auth_idor", "business_logic", "token_session"],
        findingsRecorded: 0,
        note: "No vulnerabilities found in TicTacToe",
      });

      // Verify coverage AFTER shake-break
      const stateAfterSB = sm.read();
      const coverageAfter = new Map(
        stateAfterSB.securityOverview!.coverageByArea.map(a => [a.id, a.coverageEstimate])
      );

      // auth-session: boosted by auth_idor + token_session
      expect((coverageAfter.get("auth-session") ?? 0)).toBeGreaterThan(coverageBefore.get("auth-session") ?? 0);
      // business-logic: boosted by business_logic
      expect((coverageAfter.get("business-logic") ?? 0)).toBeGreaterThan(coverageBefore.get("business-logic") ?? 0);
      // infra-secrets: boosted by token_session
      expect((coverageAfter.get("infra-secrets") ?? 0)).toBeGreaterThan(coverageBefore.get("infra-secrets") ?? 0);

      // Release audit + active verification (security → deployment gate)
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // ── Phase 4: Deployment ──
      sm.setPhase("deployment");
      expect(parse(handleGetState({ projectPath: tmpDir })).phase).toBe("deployment");

      // ── Bug 2 verification: both tools return tierComparison without tier ──
      const genNoTier = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(genNoTier.error).toContain("Secret management tier not chosen");
      expect(genNoTier.tierComparison).toBeDefined();
      expect(genNoTier.tierComparison.length).toBe(4);
      for (const tier of genNoTier.tierComparison) {
        expect(typeof tier.tier).toBe("number");
        expect(typeof tier.id).toBe("string");
        expect(typeof tier.name).toBe("string");
        expect(typeof tier.bestFor).toBe("string");
        expect(Array.isArray(tier.pros)).toBe(true);
        expect(Array.isArray(tier.cons)).toBe(true);
      }

      // deployToServer also returns tierComparison (needs infra first)
      sm.setInfrastructure({
        provider: "hetzner",
        serverId: "srv-1",
        serverName: "tictactoe-prod",
        serverIp: "1.2.3.4",
        serverType: "cx11",
        location: "fsn1",
        sshUser: "root",
        sshKeyFingerprint: "abc123",
        domain: "tictactoe.example.com",
        provisionedAt: new Date().toISOString(),
        lastDeployedAt: null,
      });
      const dtsNoTier = parse(handleDeployToServer({ projectPath: tmpDir }));
      expect(dtsNoTier.tierComparison).toBeDefined();
      expect(dtsNoTier.tierComparison.length).toBe(4);

      // Set secret management tier
      const tierResult = parse(
        handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" })
      );
      expect(tierResult.success).toBe(true);

      // Deploy approval
      const approval = parse(
        handleDeployApproval({
          projectPath: tmpDir,
          note: "TicTacToe approved for deployment",
        })
      );
      expect(approval.success).toBe(true);

      // Generate deployment (now succeeds)
      const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(deployResult.projectName).toBe("tictactoe");
      expect(deployResult.techStack.language).toBe("TypeScript");
      expect(deployResult.techStack.framework).toBe("React");
      expect(deployResult.deploymentGuide).toBeDefined();
      expect(deployResult.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);

      // ── Bug 3 verification: SSL gate ──
      // Try to complete without SSL → must fail with MANDATORY HARD STOP
      expect(() => sm.setPhase("complete")).toThrow(/MANDATORY HARD STOP/i);

      // Record SSL verification
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "tictactoe.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);

      // Now complete should succeed
      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");

      // ── Final state verification ──
      const endState = parse(handleGetState({ projectPath: tmpDir }));
      expect(endState.phase).toBe("complete");
      expect(endState.projectName).toBe("tictactoe");
      expect(endState.progress.totalSlices).toBe(2);
      expect(endState.progress.doneSlices).toBe(2);
      expect(endState.architecture.techStack.language).toBe("TypeScript");
      expect(endState.architecture.techStack.framework).toBe("React");
      expect(endState.architecture.techStack.database).toBeNull();
      expect(endState.architecture.techStack.hosting).toBeNull();
    });
  });
});
