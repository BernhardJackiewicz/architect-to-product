import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { handleInitProject } from "../../src/tools/init-project.js";
import { handleGetState } from "../../src/tools/get-state.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { handleUpdateSlice } from "../../src/tools/update-slice.js";
import { handleBuildSignoff } from "../../src/tools/build-signoff.js";
import { handleRunSast } from "../../src/tools/run-sast.js";
import { handleRunWhiteboxAudit } from "../../src/tools/run-whitebox-audit.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { handleCompletePhase } from "../../src/tools/complete-phase.js";
import { handleSetSecretManagement } from "../../src/tools/set-secret-management.js";
import { handleDeployApproval } from "../../src/tools/deploy-approval.js";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleDeployToServer } from "../../src/tools/deploy-to-server.js";
import { handleRecordServer } from "../../src/tools/record-server.js";
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
  addWhiteboxOnly,
} from "../helpers/setup.js";

/**
 * Full-cycle E2E test for an HSL Color Picker app project.
 *
 * Exercises the A2P workflow with:
 *   - Multiple slices (color-picker-ui, copy-to-clipboard)
 *   - Bug 2 via deploy-to-server: tier comparison with 4 entries when no tier set
 *   - Complete phase gate: SSL enforcement on multi-slice project via handleCompletePhase
 *   - Security overview: coverage dashboard with non-zero coverage after multiple activities
 */
describe("Full Cycle E2E: HSL Color Picker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-colorpicker");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Helpers ────────────────────────────────────────────────────

  /** Initialize the ColorPicker project with architecture. */
  function initProject(): void {
    handleInitProject({ projectPath: tmpDir, projectName: "hsl-color-picker" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "HSL Color Picker",
      description: "Interactive HSL color picker with copy-to-clipboard",
      language: "TypeScript",
      framework: "React",
      features: [
        "HSL slider controls",
        "live color preview",
        "hex/rgb/hsl output",
        "copy to clipboard",
      ],
      dataModel: "none — local state only",
      apiDesign: "none — client-side only",
      hosting: "Vercel",
    });
  }

  /** Create the two-slice build plan. */
  function createTwoSlicePlan(): void {
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "color-picker-ui",
          name: "Color Picker UI",
          description:
            "HSL sliders (hue, saturation, lightness) with live color preview and hex/rgb/hsl output",
          acceptanceCriteria: [
            "Three sliders for H (0-360), S (0-100%), L (0-100%)",
            "Live color swatch updates on slider change",
            "Displays hex, rgb, and hsl string values",
          ],
          testStrategy: "vitest + react-testing-library",
          dependencies: [],
        },
        {
          id: "copy-to-clipboard",
          name: "Copy to Clipboard",
          description:
            "Button to copy selected color value (hex, rgb, or hsl) to clipboard with feedback",
          acceptanceCriteria: [
            "Copy button writes to clipboard",
            "Visual feedback on successful copy",
          ],
          testStrategy: "vitest + react-testing-library (mock clipboard API)",
          dependencies: ["color-picker-ui"],
        },
      ],
    });
  }

  /** Walk a single slice through the full TDD cycle. */
  function walkSliceToDone(sm: StateManager, sliceId: string): void {
    // RED
    handleUpdateSlice({
      projectPath: tmpDir,
      sliceId,
      status: "red",
      files: [`src/${sliceId}.test.tsx`],
    });

    // GREEN
    addPassingTests(sm, sliceId);
    handleUpdateSlice({
      projectPath: tmpDir,
      sliceId,
      status: "green",
      files: [`src/${sliceId}.tsx`],
    });

    // REFACTOR
    handleUpdateSlice({
      projectPath: tmpDir,
      sliceId,
      status: "refactor",
    });

    // SAST
    addSastEvidence(sm, sliceId);
    handleUpdateSlice({
      projectPath: tmpDir,
      sliceId,
      status: "sast",
    });

    // DONE
    addPassingTests(sm, sliceId);
    handleUpdateSlice({
      projectPath: tmpDir,
      sliceId,
      status: "done",
    });
  }

  /** Bring the project from init through security phase, ready for deployment transition. */
  function advanceToDeployment(): StateManager {
    initProject();
    createTwoSlicePlan();

    const sm = new StateManager(tmpDir);
    sm.setPhase("building");

    // Walk both slices through TDD
    walkSliceToDone(sm, "color-picker-ui");
    walkSliceToDone(sm, "copy-to-clipboard");

    // Build signoff + quality audit
    sm.setBuildSignoff("both slices tested");
    addQualityAudit(sm);
    sm.setPhase("security");

    // Security: full SAST + whitebox + adversarial + release audit + verification
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);

    // Transition to deployment
    sm.setPhase("deployment");
    return sm;
  }

  // ─── Phase 0: Onboarding ─────────────────────────────────────────

  describe("Phase 0: Onboarding", () => {
    it("initializes the HSL Color Picker project", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "hsl-color-picker" })
      );
      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".a2p/state.json");
    });

    it("sets architecture for React/TypeScript with Vercel hosting", () => {
      initProject();
      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.projectName).toBe("hsl-color-picker");
      expect(state.architecture.name).toBe("HSL Color Picker");
      expect(state.architecture.techStack.language).toBe("TypeScript");
      expect(state.architecture.techStack.framework).toBe("React");
      expect(state.architecture.techStack.hosting).toBe("Vercel");
    });
  });

  // ─── Phase 1: Planning — two slices ──────────────────────────────

  describe("Phase 1: Planning — two slices", () => {
    beforeEach(() => {
      initProject();
    });

    it("creates two slices: color-picker-ui and copy-to-clipboard", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "color-picker-ui",
              name: "Color Picker UI",
              description: "HSL sliders with live preview",
              acceptanceCriteria: ["sliders work", "preview updates"],
              testStrategy: "vitest",
              dependencies: [],
            },
            {
              id: "copy-to-clipboard",
              name: "Copy to Clipboard",
              description: "Copy color value to clipboard",
              acceptanceCriteria: ["clipboard works"],
              testStrategy: "vitest",
              dependencies: ["color-picker-ui"],
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.sliceCount).toBe(2);
      expect(result.slices[0].id).toBe("color-picker-ui");
      expect(result.slices[0].order).toBe(1);
      expect(result.slices[1].id).toBe("copy-to-clipboard");
      expect(result.slices[1].order).toBe(2);
      expect(result.slices[1].dependencies).toContain("color-picker-ui");
    });
  });

  // ─── Phase 2: Building — TDD for both slices ────────────────────

  describe("Phase 2: Building — TDD cycle for two slices", () => {
    let sm: StateManager;

    beforeEach(() => {
      initProject();
      createTwoSlicePlan();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");
    });

    it("walks color-picker-ui through pending → red → green → refactor → sast → done", () => {
      // RED
      let result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "color-picker-ui",
          status: "red",
          files: ["src/ColorPicker.test.tsx"],
        })
      );
      expect(result.newStatus).toBe("red");

      // GREEN
      addPassingTests(sm, "color-picker-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "color-picker-ui",
          status: "green",
          files: ["src/ColorPicker.tsx"],
        })
      );
      expect(result.newStatus).toBe("green");

      // REFACTOR
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "color-picker-ui",
          status: "refactor",
        })
      );
      expect(result.newStatus).toBe("refactor");

      // SAST
      addSastEvidence(sm, "color-picker-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "color-picker-ui",
          status: "sast",
        })
      );
      expect(result.newStatus).toBe("sast");

      // DONE
      addPassingTests(sm, "color-picker-ui");
      result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "color-picker-ui",
          status: "done",
        })
      );
      expect(result.newStatus).toBe("done");
    });

    it("walks both slices to done and signs off build", () => {
      walkSliceToDone(sm, "color-picker-ui");
      walkSliceToDone(sm, "copy-to-clipboard");

      const result = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "Both color picker slices tested — sliders + clipboard",
        })
      );
      expect(result.success).toBe(true);
      expect(result.signedOffAt).toBeTruthy();

      // Verify progress
      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.progress.totalSlices).toBe(2);
      expect(state.progress.doneSlices).toBe(2);
    });
  });

  // ─── Phase 3: Security — multiple activities + coverage dashboard ─

  describe("Phase 3: Security — coverage dashboard after multiple activities", () => {
    let sm: StateManager;

    beforeEach(() => {
      initProject();
      createTwoSlicePlan();
      sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "color-picker-ui");
      walkSliceToDone(sm, "copy-to-clipboard");

      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");
    });

    it("security overview shows non-zero coverage after SAST + whitebox + adversarial", () => {
      // Full SAST scan
      sm.markFullSastRun(0);

      // Whitebox audit (without adversarial completion)
      addWhiteboxOnly(sm);

      // Complete adversarial review with focused areas to get non-zero coverage
      // Round 1: focus on input-output
      sm.completeAdversarialReview(0, "reviewed input handling", "input-output");
      sm.clearPendingSecurityDecision();

      // Round 2: focus on business-logic
      sm.completeAdversarialReview(0, "reviewed business logic", "business-logic");
      sm.clearPendingSecurityDecision();

      // Verify the security overview coverage dashboard
      const state = sm.read();
      expect(state.securityOverview).not.toBeNull();
      expect(state.securityOverview!.totalSecurityRounds).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(state.securityOverview!.coverageByArea)).toBe(true);
      expect(state.securityOverview!.coverageByArea.length).toBeGreaterThan(0);

      // Count areas with non-zero coverage (focused areas should have 40% from wasFocused)
      const nonZeroAreas = state.securityOverview!.coverageByArea.filter(
        (area) => area.coverageEstimate > 0
      );
      expect(nonZeroAreas.length).toBeGreaterThan(0);

      // The focused areas should have non-zero coverage
      const inputOutput = state.securityOverview!.coverageByArea.find(
        (a) => a.id === "input-output"
      );
      expect(inputOutput).toBeDefined();
      expect(inputOutput!.coverageEstimate).toBeGreaterThan(0);

      const bizLogic = state.securityOverview!.coverageByArea.find(
        (a) => a.id === "business-logic"
      );
      expect(bizLogic).toBeDefined();
      expect(bizLogic!.coverageEstimate).toBeGreaterThan(0);

      // Each coverage entry has valid structure
      for (const area of state.securityOverview!.coverageByArea) {
        expect(typeof area.id).toBe("string");
        expect(typeof area.coverageEstimate).toBe("number");
        expect(area.coverageEstimate).toBeGreaterThanOrEqual(0);
        expect(area.coverageEstimate).toBeLessThanOrEqual(100);
        expect(typeof area.findingCount).toBe("number");
      }
    });

    it("security overview tracks multiple security activities", () => {
      sm.markFullSastRun(0);
      addWhiteboxOnly(sm);
      sm.completeAdversarialReview(0, "reviewed auth", "auth-session");
      sm.clearPendingSecurityDecision();

      const state = sm.read();
      const overview = state.securityOverview!;

      // After whitebox + adversarial, these timestamps should be set
      expect(overview.lastSecurityActivityAt).not.toBeNull();
      expect(overview.lastWhiteboxAt).not.toBeNull();

      // The overview should list hardened areas
      expect(Array.isArray(overview.areasExplicitlyHardened)).toBe(true);

      // Recommended next areas should be present (areas not yet hardened)
      expect(Array.isArray(overview.recommendedNextAreas)).toBe(true);
    });
  });

  // ─── Phase 4: Deployment — deploy-to-server tier comparison ──────

  describe("Phase 4: Deployment — deploy-to-server tier comparison (Bug 2)", () => {
    let sm: StateManager;

    beforeEach(() => {
      sm = advanceToDeployment();
    });

    it("deploy-to-server returns tierComparison with 4 entries when no secret tier set", () => {
      // Record infrastructure (required before deploy-to-server)
      handleRecordServer({
        projectPath: tmpDir,
        provider: "hetzner",
        serverId: "12345678",
        serverName: "colorpicker-prod",
        serverIp: "49.12.100.50",
        serverType: "cx22",
        location: "nbg1",
        sshUser: "deploy",
        sshKeyFingerprint: "SHA256:abc123",
        domain: "colorpicker.example.com",
      });

      // Call deploy-to-server without setting secret management tier
      const result = parse(handleDeployToServer({ projectPath: tmpDir }));

      // Should return error with tier comparison table
      expect(result.error).toContain("Secret management tier not chosen");
      expect(result.tierComparison).toBeDefined();
      expect(Array.isArray(result.tierComparison)).toBe(true);
      expect(result.tierComparison.length).toBe(4);

      // Verify all 4 tier IDs are present
      const tierIds = result.tierComparison.map((t: any) => t.id);
      expect(tierIds).toContain("env-file");
      expect(tierIds).toContain("docker-swarm");
      expect(tierIds).toContain("infisical");
      expect(tierIds).toContain("external");

      // Each tier must have pros and cons arrays with content
      for (const tier of result.tierComparison) {
        expect(tier.name).toBeTruthy();
        expect(Array.isArray(tier.pros)).toBe(true);
        expect(Array.isArray(tier.cons)).toBe(true);
        expect(tier.pros.length).toBeGreaterThan(0);
        expect(tier.cons.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Phase 4→5: Complete phase gate — SSL enforcement ────────────

  describe("Phase 4→5: Complete phase gate — SSL enforcement via handleCompletePhase", () => {
    it("handleCompletePhase enforces SSL on the final phase of a multi-phase project", () => {
      // Set up a multi-phase project (phases defined in architecture)
      handleInitProject({ projectPath: tmpDir, projectName: "hsl-color-picker" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "HSL Color Picker",
        description: "Interactive HSL color picker with copy-to-clipboard",
        language: "TypeScript",
        framework: "React",
        features: ["HSL sliders", "copy to clipboard"],
        dataModel: "none",
        apiDesign: "none",
        hosting: "Vercel",
        phases: [
          {
            id: "phase-0",
            name: "Core Color Picker",
            description: "HSL sliders with live preview",
            deliverables: ["ColorPicker component"],
            timeline: "1 week",
          },
          {
            id: "phase-1",
            name: "Clipboard & Polish",
            description: "Copy to clipboard + responsive design",
            deliverables: ["CopyButton component", "responsive layout"],
            timeline: "1 week",
          },
        ],
      });

      // Create slices for phase-0
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "color-picker-ui",
            name: "Color Picker UI",
            description: "HSL sliders with live preview",
            acceptanceCriteria: ["sliders work"],
            testStrategy: "vitest",
            dependencies: [],
            productPhaseId: "phase-0",
          },
        ],
      });

      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Walk slice to done
      walkSliceToDone(sm, "color-picker-ui");
      sm.setBuildSignoff("tested");
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);
      sm.setPhase("deployment");
      handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" });

      // Complete phase-0 (not the last phase — should succeed without SSL)
      const phase0Result = parse(handleCompletePhase({ projectPath: tmpDir }));
      expect(phase0Result.success).toBe(true);
      expect(phase0Result.completedPhase).toBe("Core Color Picker");
      expect(phase0Result.projectComplete).toBe(false);

      // Now add slices for phase-1 (append mode)
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "copy-to-clipboard",
            name: "Copy to Clipboard",
            description: "Copy color value to clipboard",
            acceptanceCriteria: ["clipboard works"],
            testStrategy: "vitest",
            dependencies: [],
            productPhaseId: "phase-1",
          },
        ],
        append: true,
      });

      sm.setPhase("building");
      walkSliceToDone(sm, "copy-to-clipboard");
      sm.setBuildSignoff("phase-1 tested");
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);
      sm.setPhase("deployment");

      // Attempt to complete the FINAL phase without SSL — should fail
      const phase1Result = parse(handleCompletePhase({ projectPath: tmpDir }));
      expect(phase1Result.error).toBeDefined();
      expect(phase1Result.error).toMatch(/MANDATORY HARD STOP/i);

      // Now verify SSL and try again
      handleVerifySsl({
        projectPath: tmpDir,
        domain: "colorpicker.example.com",
        method: "paas-auto",
        issuer: "Let's Encrypt",
        autoRenewal: true,
        httpsRedirect: true,
        hstsPresent: true,
      });

      const phase1RetryResult = parse(handleCompletePhase({ projectPath: tmpDir }));
      expect(phase1RetryResult.success).toBe(true);
      expect(phase1RetryResult.completedPhase).toBe("Clipboard & Polish");
      expect(phase1RetryResult.projectComplete).toBe(true);
    });
  });

  // ─── Full Integration: init → complete ────────────────────────────

  describe("Full lifecycle integration: init through complete", () => {
    it(
      "completes the entire HSL Color Picker workflow with 2 slices",
      { timeout: 30_000 },
      () => {
        // ── Phase 0: Init + Architecture ──
        initProject();
        const initState = parse(handleGetState({ projectPath: tmpDir }));
        expect(initState.projectName).toBe("hsl-color-picker");
        expect(initState.architecture.techStack.hosting).toBe("Vercel");

        // ── Phase 1: Plan with 2 slices ──
        createTwoSlicePlan();
        const planState = parse(handleGetState({ projectPath: tmpDir }));
        expect(planState.progress.totalSlices).toBe(2);

        // ── Phase 2: Build (TDD both slices) ──
        const sm = new StateManager(tmpDir);
        sm.setPhase("building");

        walkSliceToDone(sm, "color-picker-ui");
        walkSliceToDone(sm, "copy-to-clipboard");

        const buildState = parse(handleGetState({ projectPath: tmpDir }));
        expect(buildState.progress.doneSlices).toBe(2);

        // Build signoff
        const signoff = parse(
          handleBuildSignoff({
            projectPath: tmpDir,
            note: "Both slices complete — color picker + clipboard",
          })
        );
        expect(signoff.success).toBe(true);

        addQualityAudit(sm);

        // ── Phase 3: Security ──
        sm.setPhase("security");

        // Full SAST
        sm.markFullSastRun(0);

        // Whitebox + focused adversarial review rounds
        addWhiteboxOnly(sm);
        sm.completeAdversarialReview(0, "reviewed input handling", "input-output");
        sm.clearPendingSecurityDecision();
        sm.completeAdversarialReview(0, "reviewed business logic", "business-logic");
        sm.clearPendingSecurityDecision();

        // Verify coverage dashboard has non-zero coverage in multiple areas
        const stateAfterSecurity = sm.read();
        expect(stateAfterSecurity.securityOverview).not.toBeNull();
        const coverage = stateAfterSecurity.securityOverview!.coverageByArea;
        expect(coverage.length).toBeGreaterThan(0);
        const nonZero = coverage.filter((a) => a.coverageEstimate > 0);
        expect(nonZero.length).toBeGreaterThan(0);

        // Release audit + verification
        addReleaseAudit(sm);
        addPassingVerification(sm);

        // ── Phase 4: Deployment ──
        sm.setPhase("deployment");
        const deployState = parse(handleGetState({ projectPath: tmpDir }));
        expect(deployState.phase).toBe("deployment");

        // deploy-to-server tier comparison (Bug 2): need infrastructure first
        handleRecordServer({
          projectPath: tmpDir,
          provider: "hetzner",
          serverId: "99999",
          serverName: "colorpicker-prod",
          serverIp: "49.12.100.50",
          serverType: "cx22",
          location: "nbg1",
          sshUser: "deploy",
          sshKeyFingerprint: "SHA256:xyz789",
          domain: "colorpicker.example.com",
        });

        const noTierResult = parse(handleDeployToServer({ projectPath: tmpDir }));
        expect(noTierResult.error).toContain("Secret management tier not chosen");
        expect(noTierResult.tierComparison).toBeDefined();
        expect(noTierResult.tierComparison.length).toBe(4);

        // Set secret management + approve + generate deployment
        const tierResult = parse(
          handleSetSecretManagement({ projectPath: tmpDir, tier: "env-file" })
        );
        expect(tierResult.success).toBe(true);

        const approval = parse(
          handleDeployApproval({
            projectPath: tmpDir,
            note: "Color picker approved for deployment",
          })
        );
        expect(approval.success).toBe(true);

        const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
        expect(deployResult.projectName).toBe("hsl-color-picker");
        expect(deployResult.techStack.framework).toBe("React");

        // SSL gate: cannot complete without SSL
        expect(() => sm.setPhase("complete")).toThrow(/SSL/i);

        // Verify SSL
        const sslResult = parse(
          handleVerifySsl({
            projectPath: tmpDir,
            domain: "colorpicker.example.com",
            method: "paas-auto",
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

        // Final verification
        const endState = parse(handleGetState({ projectPath: tmpDir }));
        expect(endState.phase).toBe("complete");
        expect(endState.progress.totalSlices).toBe(2);
        expect(endState.progress.doneSlices).toBe(2);
      }
    );
  });
});
