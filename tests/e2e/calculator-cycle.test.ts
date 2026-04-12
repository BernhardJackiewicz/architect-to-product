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
 * Full-cycle E2E test for a Scientific Calculator app project.
 *
 * Exercises every A2P workflow phase from init through deployment,
 * with specific focus on:
 *   Bug 1: shake-break coverage mapping into securityOverview.coverageByArea
 *   Bug 2: generateDeployment returns tierComparison when no tier is set
 *   Bug 3: setPhase("complete") enforces MANDATORY HARD STOP without SSL
 */
useLegacySliceFlow();

describe("Full Cycle E2E: Scientific Calculator", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-calc-cycle");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Helper: bootstrap through onboarding + planning ────────────
  function initCalculatorProject(): void {
    handleInitProject({ projectPath: tmpDir, projectName: "sci-calculator" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "Scientific Calculator",
      description:
        "A scientific calculator with basic and advanced math operations (sin, cos, log, power, factorial)",
      language: "TypeScript",
      framework: "none",
      features: [
        "basic arithmetic (+, -, *, /)",
        "scientific functions (sin, cos, tan)",
        "logarithmic functions (log, ln)",
        "power and root operations",
        "factorial",
        "keyboard input support",
        "expression history",
      ],
      dataModel: "none — in-memory state only",
      apiDesign: "none — client-side only",
    });
  }

  function createBuildPlan(): void {
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "calc-engine",
          name: "Calculator Engine",
          description:
            "Core math engine: parsing, evaluation, scientific functions",
          acceptanceCriteria: [
            "Evaluates basic arithmetic expressions",
            "Supports sin, cos, tan, log, ln, pow, sqrt",
            "Computes factorial for non-negative integers",
            "Returns error for invalid expressions",
          ],
          testStrategy: "vitest unit tests",
          dependencies: [],
        },
        {
          id: "calc-ui",
          name: "Calculator UI",
          description:
            "Vanilla HTML/CSS/JS UI with button grid and display, wired to engine",
          acceptanceCriteria: [
            "Renders number pad and operator buttons",
            "Displays current expression and result",
            "Keyboard input works",
            "Expression history panel shows last 10 entries",
          ],
          testStrategy: "vitest + jsdom",
          dependencies: ["calc-engine"],
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
    it("initializes the Scientific Calculator project", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "sci-calculator" })
      );
      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".a2p/state.json");
    });

    it("sets architecture for a vanilla TS calculator (no framework, no db, no hosting)", () => {
      initCalculatorProject();

      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.projectName).toBe("sci-calculator");
      expect(state.phase).toBe("onboarding");
      expect(state.architecture.name).toBe("Scientific Calculator");
      expect(state.architecture.techStack.language).toBe("TypeScript");
      expect(state.architecture.techStack.framework).toBe("none");
      expect(state.architecture.techStack.database).toBeNull();
      expect(state.architecture.techStack.hosting).toBeNull();
    });
  });

  // ─── Phase 1: Planning ────────────────────────────────────────────

  describe("Phase 1: Planning — two slices for engine + UI", () => {
    beforeEach(() => {
      initCalculatorProject();
    });

    it("creates two slices with dependency", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "calc-engine",
              name: "Calculator Engine",
              description: "Core math engine",
              acceptanceCriteria: ["evaluates expressions"],
              testStrategy: "vitest",
              dependencies: [],
            },
            {
              id: "calc-ui",
              name: "Calculator UI",
              description: "Vanilla UI",
              acceptanceCriteria: ["renders buttons"],
              testStrategy: "vitest + jsdom",
              dependencies: ["calc-engine"],
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.sliceCount).toBe(2);
      expect(result.slices[0].id).toBe("calc-engine");
      expect(result.slices[1].id).toBe("calc-ui");
      expect(result.slices[0].order).toBe(1);
      expect(result.slices[1].order).toBe(2);
    });
  });

  // ─── Phase 2: TDD Build Loop ─────────────────────────────────────

  describe("Phase 2: Building — TDD cycle for both slices", () => {
    let sm: StateManager;

    beforeEach(() => {
      initCalculatorProject();
      createBuildPlan();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");
    });

    it("walks both slices through pending → red → green → refactor → sast → done", () => {
      // Engine slice
      walkSliceToDone(sm, "calc-engine", ["src/engine.ts", "src/engine.test.ts"]);

      // UI slice
      walkSliceToDone(sm, "calc-ui", ["src/ui.ts", "src/ui.test.ts", "index.html"]);

      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.progress.doneSlices).toBe(2);
      expect(state.progress.totalSlices).toBe(2);
    });

    it("build signoff works after all slices done", () => {
      walkSliceToDone(sm, "calc-engine", ["src/engine.ts"]);
      walkSliceToDone(sm, "calc-ui", ["src/ui.ts"]);

      const result = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "All calculator features tested — arithmetic, trig, log, factorial",
        })
      );
      expect(result.success).toBe(true);
      expect(result.signedOffAt).toBeTruthy();
    });
  });

  // ─── Phase 3: Security — shake-break coverage focus ────────────

  describe("Phase 3: Security — shake-break coverage mapping (Bug 1)", () => {
    let sm: StateManager;

    beforeEach(() => {
      initCalculatorProject();
      createBuildPlan();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "calc-engine", ["src/engine.ts"]);
      walkSliceToDone(sm, "calc-ui", ["src/ui.ts"]);

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      // Full SAST + whitebox + adversarial (baseline)
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
    });

    it("securityOverview exists after adversarial review", () => {
      const state = sm.read();
      expect(state.securityOverview).not.toBeNull();
      expect(state.securityOverview!.totalSecurityRounds).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(state.securityOverview!.coverageByArea)).toBe(true);
      expect(state.securityOverview!.coverageByArea.length).toBe(8);
    });

    it("shake-break result increases coverage for mapped hardening areas", () => {
      // Record baseline coverage before shake-break
      const stateBefore = sm.read();
      const businessLogicBefore = stateBefore.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;
      const inputOutputBefore = stateBefore.securityOverview!.coverageByArea.find(
        (a) => a.id === "input-output"
      )!;

      // Add a shake-break result with categories that map to business-logic and input-output
      // business_logic → ["business-logic", "vuln-chaining"]
      // injection_runtime → ["input-output", "api-surface"]
      sm.addShakeBreakResult({
        id: `SB-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 15,
        categoriesTested: ["business_logic", "injection_runtime"],
        findingsRecorded: 2,
        note: "Tested expression injection and logic bypass on calculator engine",
      });

      // Verify coverage increased for the mapped areas
      const stateAfter = sm.read();
      expect(stateAfter.securityOverview).not.toBeNull();

      const businessLogicAfter = stateAfter.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;
      const inputOutputAfter = stateAfter.securityOverview!.coverageByArea.find(
        (a) => a.id === "input-output"
      )!;

      // Coverage should have increased (each shake-break category adds 15 per mapped domain)
      expect(businessLogicAfter.coverageEstimate).toBeGreaterThan(
        businessLogicBefore.coverageEstimate
      );
      expect(inputOutputAfter.coverageEstimate).toBeGreaterThan(
        inputOutputBefore.coverageEstimate
      );

      // The actual values should be > 0
      expect(businessLogicAfter.coverageEstimate).toBeGreaterThan(0);
      expect(inputOutputAfter.coverageEstimate).toBeGreaterThan(0);

      // Also verify secondary mappings increased:
      // business_logic also maps to vuln-chaining
      const vulnChainingAfter = stateAfter.securityOverview!.coverageByArea.find(
        (a) => a.id === "vuln-chaining"
      )!;
      expect(vulnChainingAfter.coverageEstimate).toBeGreaterThan(0);

      // injection_runtime also maps to api-surface
      const apiSurfaceAfter = stateAfter.securityOverview!.coverageByArea.find(
        (a) => a.id === "api-surface"
      )!;
      expect(apiSurfaceAfter.coverageEstimate).toBeGreaterThan(0);
    });

    it("multiple shake-break rounds accumulate coverage", () => {
      // First round
      sm.addShakeBreakResult({
        id: `SB-1-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 10,
        categoriesTested: ["business_logic"],
        findingsRecorded: 1,
        note: "Round 1: logic bypass",
      });

      const stateAfterFirst = sm.read();
      const blAfterFirst = stateAfterFirst.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;

      // Second round with same category
      sm.addShakeBreakResult({
        id: `SB-2-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 10,
        categoriesTested: ["business_logic"],
        findingsRecorded: 0,
        note: "Round 2: re-test logic bypass after fix",
      });

      const stateAfterSecond = sm.read();
      const blAfterSecond = stateAfterSecond.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;

      // Coverage should have increased further (another sbCount * 15)
      expect(blAfterSecond.coverageEstimate).toBeGreaterThan(
        blAfterFirst.coverageEstimate
      );
    });
  });

  // ─── Phase 4: Deployment ──────────────────────────────────────────

  describe("Phase 4: Deployment — secret gate + SSL gate (Bugs 2 & 3)", () => {
    let sm: StateManager;

    beforeEach(() => {
      initCalculatorProject();
      createBuildPlan();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "calc-engine", ["src/engine.ts"]);
      walkSliceToDone(sm, "calc-ui", ["src/ui.ts"]);

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      sm.setPhase("deployment");
    });

    it("Bug 2: generateDeployment returns tierComparison with 4 tiers when no tier set", () => {
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));

      expect(result.error).toContain("Secret management tier not chosen");
      expect(result.tierComparison).toBeDefined();
      expect(Array.isArray(result.tierComparison)).toBe(true);
      expect(result.tierComparison.length).toBe(4);

      // All 4 tiers present
      const tierIds = result.tierComparison.map((t: any) => t.id);
      expect(tierIds).toContain("env-file");
      expect(tierIds).toContain("docker-swarm");
      expect(tierIds).toContain("infisical");
      expect(tierIds).toContain("external");

      // Each tier has pros and cons arrays
      for (const tier of result.tierComparison) {
        expect(tier.name).toBeTruthy();
        expect(Array.isArray(tier.pros)).toBe(true);
        expect(Array.isArray(tier.cons)).toBe(true);
        expect(tier.pros.length).toBeGreaterThan(0);
        expect(tier.cons.length).toBeGreaterThan(0);
      }
    });

    it("Bug 3: setPhase('complete') throws MANDATORY HARD STOP without SSL", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      expect(() => sm.setPhase("complete")).toThrow(/MANDATORY HARD STOP/);
    });

    it("setPhase('complete') succeeds after SSL verification", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "calc.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);

      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");
    });
  });

  // ─── Full Integration: init → complete ────────────────────────────

  describe("Full lifecycle integration: init through complete", () => {
    it("completes the entire Scientific Calculator workflow", { timeout: 30_000 }, () => {
      // ── Phase 0: Init + Architecture ──
      const initResult = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "sci-calculator" })
      );
      expect(initResult.success).toBe(true);

      const archResult = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "Scientific Calculator",
          description:
            "Scientific calculator with trig, log, power, factorial — vanilla TS, no framework",
          language: "TypeScript",
          framework: "none",
          features: [
            "basic arithmetic",
            "scientific functions",
            "expression history",
          ],
          dataModel: "none — in-memory",
          apiDesign: "none — client-side",
        })
      );
      expect(archResult.success).toBe(true);

      // ── Phase 1: Plan ──
      const planResult = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "calc-engine",
              name: "Calculator Engine",
              description: "Core math engine with scientific functions",
              acceptanceCriteria: [
                "Evaluates arithmetic",
                "Supports trig/log/pow/factorial",
              ],
              testStrategy: "vitest",
              dependencies: [],
            },
            {
              id: "calc-ui",
              name: "Calculator UI",
              description: "Vanilla HTML/CSS/JS interface",
              acceptanceCriteria: [
                "Button grid renders",
                "Keyboard input works",
              ],
              testStrategy: "vitest + jsdom",
              dependencies: ["calc-engine"],
            },
          ],
        })
      );
      expect(planResult.success).toBe(true);
      expect(planResult.sliceCount).toBe(2);

      // ── Phase 2: Build (TDD) ──
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Engine slice: full TDD cycle
      walkSliceToDone(sm, "calc-engine", [
        "src/engine.ts",
        "src/engine.test.ts",
      ]);

      // UI slice: full TDD cycle
      walkSliceToDone(sm, "calc-ui", [
        "src/ui.ts",
        "src/ui.test.ts",
        "index.html",
        "styles.css",
      ]);

      // Build signoff
      const signoffResult = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "Calculator engine + UI tested — all operations verified",
        })
      );
      expect(signoffResult.success).toBe(true);

      addQualityAudit(sm);

      // ── Phase 3: Security ──
      sm.setPhase("security");

      const securityState = parse(handleGetState({ projectPath: tmpDir }));
      expect(securityState.phase).toBe("security");

      sm.markFullSastRun(0);
      addPassingWhitebox(sm);

      // Bug 1 verification: baseline securityOverview exists
      const stateBeforeShakeBreak = sm.read();
      expect(stateBeforeShakeBreak.securityOverview).not.toBeNull();

      const blBefore = stateBeforeShakeBreak.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;
      const ioBefore = stateBeforeShakeBreak.securityOverview!.coverageByArea.find(
        (a) => a.id === "input-output"
      )!;

      // Add shake-break targeting business_logic + injection_runtime
      sm.addShakeBreakResult({
        id: `SB-CALC-${Date.now()}`,
        timestamp: new Date().toISOString(),
        durationMinutes: 20,
        categoriesTested: ["business_logic", "injection_runtime"],
        findingsRecorded: 1,
        note: "Tested expression injection via crafted input and logic bypass on factorial edge cases",
      });

      // Bug 1 verification: coverage increased for mapped areas
      const stateAfterShakeBreak = sm.read();
      const blAfter = stateAfterShakeBreak.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      )!;
      const ioAfter = stateAfterShakeBreak.securityOverview!.coverageByArea.find(
        (a) => a.id === "input-output"
      )!;

      expect(blAfter.coverageEstimate).toBeGreaterThan(blBefore.coverageEstimate);
      expect(ioAfter.coverageEstimate).toBeGreaterThan(ioBefore.coverageEstimate);
      expect(blAfter.coverageEstimate).toBeGreaterThan(0);
      expect(ioAfter.coverageEstimate).toBeGreaterThan(0);

      // Release audit + active verification
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // ── Phase 4: Deployment ──
      sm.setPhase("deployment");

      const deployState = parse(handleGetState({ projectPath: tmpDir }));
      expect(deployState.phase).toBe("deployment");

      // Bug 2 verification: no tier → tierComparison with 4 entries
      const noTierResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(noTierResult.error).toContain("Secret management tier not chosen");
      expect(noTierResult.tierComparison).toBeDefined();
      expect(noTierResult.tierComparison.length).toBe(4);
      for (const tier of noTierResult.tierComparison) {
        expect(Array.isArray(tier.pros)).toBe(true);
        expect(Array.isArray(tier.cons)).toBe(true);
      }

      // Set tier + approval
      const tierResult = parse(
        handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" })
      );
      expect(tierResult.success).toBe(true);

      const approvalResult = parse(
        handleDeployApproval({
          projectPath: tmpDir,
          note: "Scientific calculator approved for deployment",
        })
      );
      expect(approvalResult.success).toBe(true);

      // Generate deployment (succeeds now)
      const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(deployResult.projectName).toBe("sci-calculator");
      expect(deployResult.techStack.language).toBe("TypeScript");
      expect(deployResult.deploymentGuide).toBeDefined();
      expect(deployResult.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);

      // Bug 3 verification: cannot complete without SSL
      expect(() => sm.setPhase("complete")).toThrow(/MANDATORY HARD STOP/);

      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "calc.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);

      // ── Phase 5: Complete ──
      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");

      // Final state verification
      const endState = parse(handleGetState({ projectPath: tmpDir }));
      expect(endState.phase).toBe("complete");
      expect(endState.progress.totalSlices).toBe(2);
      expect(endState.progress.doneSlices).toBe(2);
      expect(endState.projectName).toBe("sci-calculator");
    });
  });
});
