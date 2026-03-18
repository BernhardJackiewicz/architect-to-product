import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { handleInitProject } from "../../src/tools/init-project.js";
import { handleGetState } from "../../src/tools/get-state.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleBuildSignoff } from "../../src/tools/build-signoff.js";
import { handleRunSast } from "../../src/tools/run-sast.js";
import { handleRunAudit } from "../../src/tools/run-audit.js";
import { handleRunWhiteboxAudit } from "../../src/tools/run-whitebox-audit.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { handleCompletePhase } from "../../src/tools/complete-phase.js";
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
} from "../helpers/setup.js";

/**
 * Full-cycle E2E test for a simple Counter app project.
 *
 * Exercises every A2P workflow phase from init through deployment,
 * verifying the three bug fixes:
 *   Bug 1: securityOverview coverage is calculated after adversarial review
 *   Bug 2: generateDeployment returns tier comparison when no tier set
 *   Bug 3: setPhase("complete") fails without SSL verification
 */
describe("Full Cycle E2E: Counter App", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-full-cycle");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Phase 0: Onboarding ─────────────────────────────────────────

  describe("Phase 0: Onboarding — init + architecture", () => {
    it("initializes the Counter project", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "counter-app" })
      );

      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".a2p/state.json");
    });

    it("sets architecture for a React/TypeScript Counter app", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });

      const result = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "Counter App",
          description: "Simple counter with increment/decrement/reset",
          language: "TypeScript",
          framework: "React",
          features: ["increment", "decrement", "reset", "display count"],
          dataModel: "none — local state only",
          apiDesign: "none — client-side only",
          hosting: "Hetzner",
        })
      );

      expect(result.success).toBe(true);
      expect(result.architecture.name).toBe("Counter App");
      expect(result.architecture.techStack.language).toBe("TypeScript");
      expect(result.architecture.techStack.framework).toBe("React");
      expect(result.architecture.techStack.hosting).toBe("Hetzner");
    });

    it("initial state is correct after init + arch", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment", "decrement", "reset"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });

      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.projectName).toBe("counter-app");
      expect(state.phase).toBe("onboarding");
      expect(state.architecture.name).toBe("Counter App");
      expect(state.progress.totalSlices).toBe(0);
    });
  });

  // ─── Phase 1: Planning ────────────────────────────────────────────

  describe("Phase 1: Planning — create build plan", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment", "decrement", "reset"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });
    });

    it("creates a single slice for the counter feature", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "counter-ui",
              name: "Counter UI",
              description:
                "React component with increment, decrement, and reset buttons displaying a count",
              acceptanceCriteria: [
                "Displays current count starting at 0",
                "Increment button increases count by 1",
                "Decrement button decreases count by 1",
                "Reset button sets count to 0",
              ],
              testStrategy: "vitest + react-testing-library",
              dependencies: [],
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.sliceCount).toBe(1);
      expect(result.slices[0].id).toBe("counter-ui");
      expect(result.slices[0].order).toBe(1);
    });
  });

  // ─── Phase 2: TDD Build Loop ─────────────────────────────────────

  describe("Phase 2: Building — TDD cycle for counter slice", () => {
    let sm: StateManager;

    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment", "decrement", "reset"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "counter-ui",
            name: "Counter UI",
            description: "Counter component",
            acceptanceCriteria: ["count works"],
            testStrategy: "vitest",
            dependencies: [],
          },
        ],
      });
      sm = new StateManager(tmpDir);
      sm.setPhase("building");
    });

    it("walks slice through pending → red → green → refactor → sast → done", () => {
      // RED: write failing tests
      let result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "red",
          files: ["src/Counter.test.tsx"],
        })
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("red");

      // GREEN: make tests pass
      addPassingTests(sm, "counter-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "green",
          files: ["src/Counter.tsx"],
        })
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("green");

      // REFACTOR: clean up code
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "refactor",
        })
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("refactor");

      // SAST: run security scan on slice
      addSastEvidence(sm, "counter-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "sast",
        })
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("sast");

      // DONE: final confirmation with passing tests
      addPassingTests(sm, "counter-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "done",
        })
      );
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("done");
    });

    it("build signoff works after all slices done", () => {
      // Walk slice to done
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "red" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "green" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "refactor" });
      addSastEvidence(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "sast" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "done" });

      const result = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "Counter UI tested manually — all buttons work",
        })
      );
      expect(result.success).toBe(true);
      expect(result.signedOffAt).toBeTruthy();
      expect(result.note).toBe("Counter UI tested manually — all buttons work");
    });
  });

  // ─── Phase 2→3: SAST scan (slice mode during building) ───────────

  describe("Phase 2.5: SAST scan during building", () => {
    it("runs slice-mode SAST scan", { timeout: 15_000 }, () => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "counter-ui",
            name: "Counter UI",
            description: "Counter",
            acceptanceCriteria: ["works"],
            testStrategy: "vitest",
            dependencies: [],
          },
        ],
      });
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      const result = parse(
        handleRunSast({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          mode: "slice",
          files: ["src/Counter.tsx"],
        })
      );

      expect(result.success).toBe(true);
      // Tools may or may not be available depending on the CI environment
      expect(Array.isArray(result.toolsRun)).toBe(true);
    });
  });

  // ─── Phase 3: Security Gate ───────────────────────────────────────

  describe("Phase 3: Security — whitebox + active verification", () => {
    let sm: StateManager;

    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment", "decrement", "reset"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "counter-ui",
            name: "Counter UI",
            description: "Counter",
            acceptanceCriteria: ["works"],
            testStrategy: "vitest",
            dependencies: [],
          },
        ],
      });
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Complete the slice through TDD
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "red" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "green" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "refactor" });
      addSastEvidence(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "sast" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "done" });

      // Build signoff + quality audit → transition to security
      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");
    });

    it("runs full SAST scan in security phase", { timeout: 15_000 }, () => {
      const result = parse(
        handleRunSast({
          projectPath: tmpDir,
          sliceId: null,
          mode: "full",
        })
      );
      expect(result.success).toBe(true);
    });

    it("runs whitebox audit in security phase", () => {
      sm.markFullSastRun(0);

      const result = parse(
        handleRunWhiteboxAudit({
          projectPath: tmpDir,
          mode: "full",
        })
      );

      // Whitebox may return success with findings, or a warning if no candidates
      if (result.success) {
        expect(typeof result.candidatesEvaluated).toBe("number");
        expect(Array.isArray(result.findings)).toBe(true);
      } else {
        // No candidates scenario returns a warning instead of success
        expect(result.warning).toBeDefined();
        expect(typeof result.candidatesEvaluated).toBe("number");
      }
    });

    it("runs active verification in security phase", () => {
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);

      // Active verification requires no pending security decision
      const result = parse(
        handleRunActiveVerification({
          projectPath: tmpDir,
          round: 1,
        })
      );

      expect(result.success).toBe(true);
      expect(result.testsPassed).toBeGreaterThanOrEqual(0);
    });

    it("Bug 1: securityOverview coverage is calculated after adversarial review", () => {
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);

      // After addPassingWhitebox, the adversarial review has been completed
      // and securityOverview should be populated
      const state = sm.read();
      expect(state.securityOverview).not.toBeNull();
      expect(state.securityOverview!.totalSecurityRounds).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(state.securityOverview!.coverageByArea)).toBe(true);
      expect(state.securityOverview!.coverageByArea.length).toBeGreaterThan(0);

      // Each coverage entry should have name, percentage, and findings count
      for (const area of state.securityOverview!.coverageByArea) {
        expect(typeof area.id).toBe("string");
        expect(typeof area.coverageEstimate).toBe("number");
        expect(area.coverageEstimate).toBeGreaterThanOrEqual(0);
        expect(area.coverageEstimate).toBeLessThanOrEqual(100);
      }
    });
  });

  // ─── Phase 4: Deployment ──────────────────────────────────────────

  describe("Phase 4: Deployment — secrets, approval, generation, SSL", () => {
    let sm: StateManager;

    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "counter-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Counter App",
        description: "Simple counter",
        language: "TypeScript",
        framework: "React",
        features: ["increment", "decrement", "reset"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Hetzner",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "counter-ui",
            name: "Counter UI",
            description: "Counter",
            acceptanceCriteria: ["works"],
            testStrategy: "vitest",
            dependencies: [],
          },
        ],
      });
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Complete slice
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "red" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "green" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "refactor" });
      addSastEvidence(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "sast" });
      addPassingTests(sm, "counter-ui");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "counter-ui", status: "done" });

      // Building → Security transition
      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");

      // Security phase: full SAST + whitebox + adversarial + release audit + verification
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // Security → Deployment transition
      sm.setPhase("deployment");
    });

    it("Bug 2: generateDeployment returns tier comparison when no tier set", () => {
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));

      // Should return error with tier comparison table
      expect(result.error).toContain("Secret management tier not chosen");
      expect(result.tierComparison).toBeDefined();
      expect(Array.isArray(result.tierComparison)).toBe(true);
      expect(result.tierComparison.length).toBe(4);

      // Verify all 4 tiers are present
      const tierIds = result.tierComparison.map((t: any) => t.id);
      expect(tierIds).toContain("env-file");
      expect(tierIds).toContain("docker-swarm");
      expect(tierIds).toContain("infisical");
      expect(tierIds).toContain("external");

      // Each tier should have pros and cons
      for (const tier of result.tierComparison) {
        expect(tier.name).toBeTruthy();
        expect(Array.isArray(tier.pros)).toBe(true);
        expect(Array.isArray(tier.cons)).toBe(true);
        expect(tier.pros.length).toBeGreaterThan(0);
        expect(tier.cons.length).toBeGreaterThan(0);
      }
    });

    it("sets secret management tier", () => {
      const result = parse(
        handleSetSecretManagement({
          projectPath: tmpDir,
          tier: "env-file",
        })
      );

      expect(result.success).toBe(true);
      expect(result.tier).toBe("env-file");
      expect(result.tierName).toContain("Tier 1");
      expect(Array.isArray(result.nextSteps)).toBe(true);
      expect(result.nextSteps.length).toBeGreaterThan(0);
    });

    it("deploy approval works after tier is set", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      const result = parse(
        handleDeployApproval({
          projectPath: tmpDir,
          note: "Counter app ready for Hetzner deployment",
        })
      );

      expect(result.success).toBe(true);
      expect(result.approvedAt).toBeTruthy();
      expect(result.stateHash).toBeTruthy();
    });

    it("generateDeployment succeeds after tier + approval", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });
      handleDeployApproval({ projectPath: tmpDir, note: "approved" });

      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));

      expect(result.projectName).toBe("counter-app");
      expect(result.techStack.language).toBe("TypeScript");
      expect(result.techStack.framework).toBe("React");
      expect(result.deploymentGuide).toBeDefined();
      expect(result.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);
      expect(result.deploymentGuide.securityHardening.length).toBeGreaterThan(0);

      // Hetzner-specific recommendations
      expect(
        result.deploymentGuide.recommendations.some((r: string) =>
          r.toLowerCase().includes("hetzner")
        )
      ).toBe(true);
    });

    it("Bug 3: setPhase('complete') fails without SSL verification", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      // Attempting to go to complete without SSL should throw
      expect(() => sm.setPhase("complete")).toThrow(/SSL/i);
    });

    it("setPhase('complete') succeeds after SSL verification", () => {
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "counter.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);

      // Now complete should work
      const state = sm.setPhase("complete");
      expect(state.phase).toBe("complete");
    });
  });

  // ─── Full Integration: init → complete ────────────────────────────

  describe("Full lifecycle integration: init through complete", () => {
    it("completes the entire Counter app workflow", { timeout: 30_000 }, () => {
      // ── Phase 0: Init ──
      const initResult = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "counter-app" })
      );
      expect(initResult.success).toBe(true);

      // ── Phase 0: Architecture ──
      const archResult = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "Counter App",
          description: "Simple counter with increment/decrement/reset",
          language: "TypeScript",
          framework: "React",
          features: ["increment", "decrement", "reset"],
          dataModel: "none — local state only",
          apiDesign: "none — client-side SPA",
          hosting: "Hetzner",
        })
      );
      expect(archResult.success).toBe(true);

      // ── Phase 1: Plan ──
      const planResult = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "counter-ui",
              name: "Counter UI Component",
              description: "React component with count display and 3 buttons",
              acceptanceCriteria: [
                "Shows count starting at 0",
                "Increment adds 1",
                "Decrement subtracts 1",
                "Reset sets to 0",
              ],
              testStrategy: "vitest + react-testing-library",
              dependencies: [],
            },
          ],
        })
      );
      expect(planResult.success).toBe(true);
      expect(planResult.sliceCount).toBe(1);

      // ── Phase 2: Build (TDD) ──
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // RED: write failing tests first
      let sliceResult = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "red",
          files: ["src/Counter.test.tsx"],
        })
      );
      expect(sliceResult.newStatus).toBe("red");

      // GREEN: implement to make tests pass
      addPassingTests(sm, "counter-ui");
      sliceResult = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "green",
          files: ["src/Counter.tsx", "src/App.tsx"],
        })
      );
      expect(sliceResult.newStatus).toBe("green");

      // REFACTOR: clean up
      sliceResult = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "refactor",
        })
      );
      expect(sliceResult.newStatus).toBe("refactor");

      // SAST: slice-level security scan
      addSastEvidence(sm, "counter-ui");
      sliceResult = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "sast",
        })
      );
      expect(sliceResult.newStatus).toBe("sast");

      // DONE: mark complete
      addPassingTests(sm, "counter-ui");
      sliceResult = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "counter-ui",
          status: "done",
        })
      );
      expect(sliceResult.newStatus).toBe("done");

      // Build signoff
      const signoffResult = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "All counter features tested",
        })
      );
      expect(signoffResult.success).toBe(true);

      // Quality audit (required for building→security gate)
      addQualityAudit(sm);

      // ── Phase 3: Security ──
      sm.setPhase("security");
      const securityState = parse(handleGetState({ projectPath: tmpDir }));
      expect(securityState.phase).toBe("security");

      // Full SAST scan
      sm.markFullSastRun(0);

      // Whitebox audit + adversarial review
      addPassingWhitebox(sm);

      // Bug 1 verification: securityOverview is calculated
      const stateAfterWhitebox = sm.read();
      expect(stateAfterWhitebox.securityOverview).not.toBeNull();
      expect(stateAfterWhitebox.securityOverview!.totalSecurityRounds).toBe(1);
      expect(stateAfterWhitebox.securityOverview!.coverageByArea.length).toBeGreaterThan(0);

      // Verify coverage areas have valid structure
      const coverageAreas = stateAfterWhitebox.securityOverview!.coverageByArea;
      for (const area of coverageAreas) {
        expect(typeof area.id).toBe("string");
        expect(typeof area.coverageEstimate).toBe("number");
      }

      // Release audit + active verification (required for security→deployment gate)
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // ── Phase 4: Deployment ──
      sm.setPhase("deployment");
      const deployState = parse(handleGetState({ projectPath: tmpDir }));
      expect(deployState.phase).toBe("deployment");

      // Bug 2 verification: generateDeployment without tier returns comparison
      const noTierResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(noTierResult.error).toContain("Secret management tier not chosen");
      expect(noTierResult.tierComparison).toBeDefined();
      expect(noTierResult.tierComparison.length).toBe(4);

      // Set secret management tier
      const tierResult = parse(
        handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" })
      );
      expect(tierResult.success).toBe(true);

      // Deploy approval
      const approvalResult = parse(
        handleDeployApproval({
          projectPath: tmpDir,
          note: "Counter app approved for Hetzner",
        })
      );
      expect(approvalResult.success).toBe(true);

      // Generate deployment (now succeeds with tier set)
      const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(deployResult.projectName).toBe("counter-app");
      expect(deployResult.techStack.language).toBe("TypeScript");
      expect(deployResult.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);

      // Bug 3 verification: cannot complete without SSL
      expect(() => sm.setPhase("complete")).toThrow(/SSL/i);

      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "counter.example.com",
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
      expect(endState.progress.totalSlices).toBe(1);
      expect(endState.progress.doneSlices).toBe(1);
    });
  });
});
