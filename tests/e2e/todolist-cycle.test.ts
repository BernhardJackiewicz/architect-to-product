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
import { handleRunWhiteboxAudit } from "../../src/tools/run-whitebox-audit.js";
import { handleRunActiveVerification } from "../../src/tools/run-active-verification.js";
import { handleCompletePhase } from "../../src/tools/complete-phase.js";
import { handleSetSecretManagement } from "../../src/tools/set-secret-management.js";
import { handleDeployApproval } from "../../src/tools/deploy-approval.js";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleVerifySsl } from "../../src/tools/verify-ssl.js";
import { handleDeployToServer } from "../../src/tools/deploy-to-server.js";
import { handleRecordServer } from "../../src/tools/record-server.js";
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
 * Full-cycle E2E test for a TodoList API project (stateful: SQLite database).
 *
 * Exercises every A2P workflow phase from init through deployment,
 * with focus on stateful-app-specific gates:
 *   - Backup required gate: SQLite → backupConfig.required=true, blocks deployment without backup configured
 *   - Deploy-to-server with infrastructure: rsync, SCP, docker compose commands
 *   - Secret management gate with tier selection: error without tier → set docker-swarm → Swarm-specific next steps
 *   - SSL gate with domain: domain-specific instructions in error
 *   - Security overview with all activities: SAST + whitebox + adversarial review coverage
 */
describe("Full Cycle E2E: TodoList API (Stateful — SQLite)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-todolist-cycle");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Helpers ──────────────────────────────────────────────────────

  /** Initialize the TodoList project with architecture */
  function initTodoProject() {
    handleInitProject({ projectPath: tmpDir, projectName: "todolist-api" });
    handleSetArchitecture({
      projectPath: tmpDir,
      name: "TodoList API",
      description: "RESTful TodoList API with SQLite persistence",
      language: "TypeScript",
      framework: "Express",
      database: "SQLite",
      features: [
        "CRUD todos",
        "filter by status",
        "due dates",
        "health endpoint",
      ],
      dataModel: "todos table: id, title, description, status, dueDate, createdAt",
      apiDesign: "REST: GET/POST/PUT/DELETE /api/todos",
      hosting: "Hetzner",
    });
  }

  /** Create build plan with two slices */
  function createTodoPlan() {
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "todo-api",
          name: "Todo CRUD API",
          description: "Express routes + SQLite for todo CRUD operations",
          acceptanceCriteria: [
            "GET /api/todos returns list",
            "POST /api/todos creates a todo",
            "PUT /api/todos/:id updates a todo",
            "DELETE /api/todos/:id removes a todo",
          ],
          testStrategy: "vitest + supertest",
          dependencies: [],
        },
        {
          id: "todo-filters",
          name: "Todo Filters & Due Dates",
          description: "Filter todos by status, sort by due date",
          acceptanceCriteria: [
            "GET /api/todos?status=done filters correctly",
            "GET /api/todos?sort=dueDate sorts by due date",
          ],
          testStrategy: "vitest + supertest",
          dependencies: ["todo-api"],
        },
      ],
    });
  }

  /** Walk a slice through the full TDD cycle */
  function walkSliceToDone(sm: StateManager, sliceId: string) {
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "red", files: [`src/${sliceId}.ts`] });
    addPassingTests(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "green", files: [`src/${sliceId}.ts`] });
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "refactor" });
    addSastEvidence(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "sast" });
    addPassingTests(sm, sliceId);
    handleUpdateSlice({ projectPath: tmpDir, sliceId, status: "done" });
  }

  /** Get a project through building to security phase */
  function setupToSecurity(): StateManager {
    initTodoProject();
    createTodoPlan();
    const sm = new StateManager(tmpDir);
    sm.setPhase("building");
    walkSliceToDone(sm, "todo-api");
    walkSliceToDone(sm, "todo-filters");
    sm.setBuildSignoff("TodoList API tested — all CRUD + filters work");
    addQualityAudit(sm);
    sm.setPhase("security");
    return sm;
  }

  /** Get a project through security to deployment phase */
  function setupToDeployment(): StateManager {
    const sm = setupToSecurity();
    sm.markFullSastRun(0);
    addPassingWhitebox(sm);
    addReleaseAudit(sm);
    addPassingVerification(sm);
    // Backup must be configured for stateful apps before deployment
    sm.setBackupStatus({ configured: true, schedulerType: "cron" });
    sm.setPhase("deployment");
    return sm;
  }

  // ─── Phase 0: Onboarding ─────────────────────────────────────────

  describe("Phase 0: Onboarding — init + architecture (stateful)", () => {
    it("initializes the TodoList project", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "todolist-api" })
      );
      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".a2p/state.json");
    });

    it("sets architecture with SQLite database", () => {
      initTodoProject();
      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.architecture.name).toBe("TodoList API");
      expect(state.architecture.techStack.language).toBe("TypeScript");
      expect(state.architecture.techStack.framework).toBe("Express");
      expect(state.architecture.techStack.database).toBe("SQLite");
      expect(state.architecture.techStack.hosting).toBe("Hetzner");
    });

    it("SQLite database → backupConfig.required is true", () => {
      initTodoProject();
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
      expect(state.backupConfig.enabled).toBe(true);
      expect(state.backupConfig.offsiteProvider).toBe("hetzner_storage");
    });
  });

  // ─── Phase 1: Planning ────────────────────────────────────────────

  describe("Phase 1: Planning — build plan with two slices", () => {
    it("creates two slices for the TodoList API", () => {
      initTodoProject();
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "todo-api",
              name: "Todo CRUD API",
              description: "Express routes + SQLite",
              acceptanceCriteria: ["CRUD works"],
              testStrategy: "vitest",
              dependencies: [],
            },
            {
              id: "todo-filters",
              name: "Todo Filters",
              description: "Filter and sort",
              acceptanceCriteria: ["filter works"],
              testStrategy: "vitest",
              dependencies: ["todo-api"],
            },
          ],
        })
      );
      expect(result.success).toBe(true);
      expect(result.sliceCount).toBe(2);
      expect(result.slices[0].id).toBe("todo-api");
      expect(result.slices[1].id).toBe("todo-filters");
    });
  });

  // ─── Phase 2: TDD Build Loop ─────────────────────────────────────

  describe("Phase 2: Building — TDD cycle for both slices", () => {
    it("walks both slices through red → green → refactor → sast → done", () => {
      initTodoProject();
      createTodoPlan();
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      walkSliceToDone(sm, "todo-api");
      walkSliceToDone(sm, "todo-filters");

      const state = sm.read();
      expect(state.slices[0].status).toBe("done");
      expect(state.slices[1].status).toBe("done");
    });

    it("build signoff works after all slices done", () => {
      initTodoProject();
      createTodoPlan();
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");
      walkSliceToDone(sm, "todo-api");
      walkSliceToDone(sm, "todo-filters");

      const result = parse(
        handleBuildSignoff({
          projectPath: tmpDir,
          note: "TodoList API tested — all CRUD + filters work",
        })
      );
      expect(result.success).toBe(true);
      expect(result.signedOffAt).toBeTruthy();
    });
  });

  // ─── Phase 3: Security Gate ───────────────────────────────────────

  describe("Phase 3: Security — SAST + whitebox + adversarial + verification", () => {
    it("security overview reflects all activities after adversarial review", () => {
      const sm = setupToSecurity();

      // Full SAST scan
      sm.markFullSastRun(0);

      // Whitebox audit + adversarial review
      addPassingWhitebox(sm);

      // Verify securityOverview is calculated
      const state = sm.read();
      expect(state.securityOverview).not.toBeNull();
      expect(state.securityOverview!.totalSecurityRounds).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(state.securityOverview!.coverageByArea)).toBe(true);
      expect(state.securityOverview!.coverageByArea.length).toBeGreaterThan(0);

      // Coverage areas have valid structure
      for (const area of state.securityOverview!.coverageByArea) {
        expect(typeof area.id).toBe("string");
        expect(typeof area.coverageEstimate).toBe("number");
        expect(area.coverageEstimate).toBeGreaterThanOrEqual(0);
        expect(area.coverageEstimate).toBeLessThanOrEqual(100);
        expect(typeof area.findingCount).toBe("number");
      }
    });

    it("adversarial review with focus area records correctly", () => {
      const sm = setupToSecurity();
      sm.markFullSastRun(0);

      // Add whitebox result first (required before adversarial review)
      sm.addWhiteboxResult({
        id: `WBA-${Date.now()}`,
        mode: "full",
        timestamp: new Date().toISOString(),
        candidates_evaluated: 3,
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 },
        blocking_count: 0,
      });

      // Complete adversarial review with a specific focus area
      sm.completeAdversarialReview(0, "Focused on data-access layer", "data-access");
      sm.clearPendingSecurityDecision();

      const state = sm.read();
      expect(state.adversarialReviewState).not.toBeNull();
      expect(state.adversarialReviewState!.roundHistory.length).toBe(1);
      expect(state.adversarialReviewState!.roundHistory[0].focusArea).toBe("data-access");

      // securityOverview should mention the hardened area
      expect(state.securityOverview).not.toBeNull();
      expect(state.securityOverview!.areasExplicitlyHardened).toContain("data-access");
    });
  });

  // ─── Backup Gate ──────────────────────────────────────────────────

  describe("Backup required gate (stateful app)", () => {
    it("blocks security→deployment when backup not configured for SQLite app", () => {
      const sm = setupToSecurity();
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // Backup NOT configured → should throw
      expect(() => sm.setPhase("deployment")).toThrow("backup configuration");
    });

    it("allows security→deployment when backup IS configured", () => {
      const sm = setupToSecurity();
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // Configure backup
      sm.setBackupStatus({ configured: true, schedulerType: "cron" });

      // Should now succeed
      sm.setPhase("deployment");
      const state = sm.read();
      expect(state.phase).toBe("deployment");
    });
  });

  // ─── Phase 4: Deployment ──────────────────────────────────────────

  describe("Phase 4: Deployment — secrets, infrastructure, deploy-to-server, SSL", () => {
    it("secret management gate: generateDeployment errors without tier, returns comparison table", () => {
      const sm = setupToDeployment();

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
    });

    it("secret management: set docker-swarm tier → Swarm-specific next steps", () => {
      const sm = setupToDeployment();

      const result = parse(
        handleSetSecretManagement({
          projectPath: tmpDir,
          tier: "docker-swarm",
        })
      );

      expect(result.success).toBe(true);
      expect(result.tier).toBe("docker-swarm");
      expect(result.tierName).toContain("Tier 2");
      expect(Array.isArray(result.nextSteps)).toBe(true);

      // Swarm-specific steps
      const steps = result.nextSteps.join(" ");
      expect(steps).toContain("docker swarm init");
      expect(steps).toContain("create-secrets.sh");
      expect(steps).toContain("docker stack deploy");
    });

    it("generateDeployment succeeds with docker-swarm tier + approval", () => {
      const sm = setupToDeployment();

      handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" });
      handleDeployApproval({ projectPath: tmpDir, note: "TodoList API approved" });

      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.projectName).toBe("todolist-api");
      expect(result.techStack.language).toBe("TypeScript");
      expect(result.techStack.framework).toBe("Express");
      expect(result.techStack.database).toBe("SQLite");

      // Deployment guide
      expect(result.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);
      expect(result.deploymentGuide.securityHardening.length).toBeGreaterThan(0);

      // SQLite-specific backup guide
      expect(result.deploymentGuide.backupGuide).toBeDefined();
      expect(result.deploymentGuide.backupGuide.dbCommand).toContain("sqlite3");
      expect(result.deploymentGuide.backupGuide.restoreCommand).toContain("Stop application");

      // Hetzner-specific recommendations
      expect(
        result.deploymentGuide.recommendations.some((r: string) =>
          r.toLowerCase().includes("hetzner")
        )
      ).toBe(true);

      // SQLite-specific recommendations
      expect(
        result.deploymentGuide.recommendations.some((r: string) =>
          r.toLowerCase().includes("sqlite") || r.toLowerCase().includes("wal")
        )
      ).toBe(true);

      // Secret management reflects docker-swarm
      expect(result.deploymentGuide.secretManagement.chosenTier).toBe("docker-swarm");
    });

    it("deploy-to-server: errors without infrastructure", () => {
      const sm = setupToDeployment();
      handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" });
      handleDeployApproval({ projectPath: tmpDir, note: "approved" });

      const result = parse(handleDeployToServer({ projectPath: tmpDir }));
      expect(result.error).toContain("No infrastructure");
    });

    it("deploy-to-server: returns proper commands with infrastructure", () => {
      const sm = setupToDeployment();
      handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" });
      handleDeployApproval({ projectPath: tmpDir, note: "approved" });

      // Record infrastructure
      handleRecordServer({
        projectPath: tmpDir,
        provider: "hetzner",
        serverId: "99999",
        serverName: "todolist-prod",
        serverIp: "116.203.10.50",
        serverType: "cx22",
        location: "nbg1",
        sshUser: "deploy",
        sshKeyFingerprint: "SHA256:todolist123",
        domain: "todo.example.com",
      });

      const result = parse(handleDeployToServer({ projectPath: tmpDir }));

      // Infrastructure recorded
      expect(result.infrastructure.provider).toBe("hetzner");
      expect(result.infrastructure.serverIp).toBe("116.203.10.50");
      expect(result.infrastructure.domain).toBe("todo.example.com");

      // Deployment steps: rsync, SCP, docker compose
      expect(result.deploymentSteps.length).toBeGreaterThan(0);

      const rsyncStep = result.deploymentSteps.find((s: any) => s.description.includes("Sync"));
      expect(rsyncStep).toBeDefined();
      expect(rsyncStep.command).toContain("rsync");
      expect(rsyncStep.command).toContain("deploy@116.203.10.50");
      expect(rsyncStep.command).toContain("--exclude='.git'");
      expect(rsyncStep.command).toContain("--exclude='.a2p'");

      const scpStep = result.deploymentSteps.find((s: any) => s.description.includes("Copy .env"));
      expect(scpStep).toBeDefined();
      expect(scpStep.command).toContain("scp");

      const dockerStep = result.deploymentSteps.find((s: any) => s.description.includes("Build and start"));
      expect(dockerStep).toBeDefined();
      expect(dockerStep.command).toContain("docker compose -f docker-compose.prod.yml up -d --build");

      // Health check uses domain
      const healthStep = result.deploymentSteps.find((s: any) => s.description.includes("Health"));
      expect(healthStep).toBeDefined();
      expect(healthStep.command).toContain("todo.example.com");

      // Domain setup note mentions the domain
      expect(result.domainSetup).toContain("todo.example.com");
      expect(result.domainSetup).toContain("Let's Encrypt");

      // Post-deploy checks include sensitive path blocking
      const checks = result.postDeployChecks.join(" ");
      expect(checks).toContain(".env");
      expect(checks).toContain(".git");
    });

    it("SSL gate: complete fails without SSL verification", () => {
      const sm = setupToDeployment();
      handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" });

      // SSL error message includes domain-relevant instructions
      expect(() => sm.setPhase("complete")).toThrow(/SSL/i);
    });

    it("SSL gate: complete succeeds after SSL verification", () => {
      const sm = setupToDeployment();
      handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" });

      // Record infrastructure with domain
      handleRecordServer({
        projectPath: tmpDir,
        provider: "hetzner",
        serverId: "99999",
        serverName: "todolist-prod",
        serverIp: "116.203.10.50",
        serverType: "cx22",
        location: "nbg1",
        sshUser: "deploy",
        sshKeyFingerprint: "SHA256:todolist123",
        domain: "todo.example.com",
      });

      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "todo.example.com",
          method: "caddy-auto",
          issuer: "Let's Encrypt",
          autoRenewal: true,
          httpsRedirect: true,
          hstsPresent: true,
        })
      );
      expect(sslResult.success).toBe(true);
      expect(sslResult.verification.domain).toBe("todo.example.com");

      // Now complete should work
      const finalState = sm.setPhase("complete");
      expect(finalState.phase).toBe("complete");
    });
  });

  // ─── Full Integration: init → complete ────────────────────────────

  describe("Full lifecycle integration: init through complete", () => {
    it("completes the entire TodoList API workflow", { timeout: 30_000 }, () => {
      // ── Phase 0: Init + Architecture ──
      const initResult = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "todolist-api" })
      );
      expect(initResult.success).toBe(true);

      const archResult = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "TodoList API",
          description: "RESTful TodoList API with SQLite persistence",
          language: "TypeScript",
          framework: "Express",
          database: "SQLite",
          features: ["CRUD todos", "filter by status", "due dates", "health endpoint"],
          dataModel: "todos table",
          apiDesign: "REST",
          hosting: "Hetzner",
        })
      );
      expect(archResult.success).toBe(true);
      // Verify backupConfig inferred from SQLite
      expect(archResult.backupConfig.required).toBe(true);
      expect(archResult.backupConfig.targets).toContain("database");

      // ── Phase 1: Plan ──
      const planResult = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "todo-api",
              name: "Todo CRUD API",
              description: "Express routes + SQLite CRUD",
              acceptanceCriteria: ["CRUD works", "health endpoint returns 200"],
              testStrategy: "vitest + supertest",
              dependencies: [],
            },
            {
              id: "todo-filters",
              name: "Todo Filters",
              description: "Query params for status filter and due date sort",
              acceptanceCriteria: ["?status=done filters", "?sort=dueDate sorts"],
              testStrategy: "vitest + supertest",
              dependencies: ["todo-api"],
            },
          ],
        })
      );
      expect(planResult.success).toBe(true);
      expect(planResult.sliceCount).toBe(2);

      // ── Phase 2: Build (TDD) ──
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");

      // Slice 1: todo-api
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-api", status: "red", files: ["src/routes/todos.ts"] });
      addPassingTests(sm, "todo-api");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-api", status: "green", files: ["src/routes/todos.ts", "src/db.ts"] });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-api", status: "refactor" });
      addSastEvidence(sm, "todo-api");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-api", status: "sast" });
      addPassingTests(sm, "todo-api");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-api", status: "done" });

      // Slice 2: todo-filters
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-filters", status: "red", files: ["src/routes/filters.ts"] });
      addPassingTests(sm, "todo-filters");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-filters", status: "green", files: ["src/routes/filters.ts"] });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-filters", status: "refactor" });
      addSastEvidence(sm, "todo-filters");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-filters", status: "sast" });
      addPassingTests(sm, "todo-filters");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "todo-filters", status: "done" });

      // Build signoff
      const signoffResult = parse(
        handleBuildSignoff({ projectPath: tmpDir, note: "TodoList API — all CRUD + filters tested" })
      );
      expect(signoffResult.success).toBe(true);

      // Quality audit (required for building→security gate)
      addQualityAudit(sm);

      // ── Phase 3: Security ──
      sm.setPhase("security");
      expect(sm.read().phase).toBe("security");

      // Full SAST scan
      sm.markFullSastRun(0);

      // Whitebox audit with focus area on data-access (SQLite is data-heavy)
      sm.addWhiteboxResult({
        id: `WBA-${Date.now()}`,
        mode: "full",
        timestamp: new Date().toISOString(),
        candidates_evaluated: 5,
        findings: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 },
        blocking_count: 0,
      });
      sm.completeAdversarialReview(0, "Focused on data-access for SQLite app", "data-access");
      sm.clearPendingSecurityDecision();

      // Verify securityOverview reflects all activities
      const stateAfterSecurity = sm.read();
      expect(stateAfterSecurity.securityOverview).not.toBeNull();
      expect(stateAfterSecurity.securityOverview!.totalSecurityRounds).toBe(1);
      expect(stateAfterSecurity.securityOverview!.coverageByArea.length).toBeGreaterThan(0);
      expect(stateAfterSecurity.securityOverview!.areasExplicitlyHardened).toContain("data-access");

      // Release audit + active verification
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // Backup gate: stateful app MUST have backup configured
      expect(() => sm.setPhase("deployment")).toThrow("backup configuration");
      sm.setBackupStatus({ configured: true, schedulerType: "cron" });

      // ── Phase 4: Deployment ──
      sm.setPhase("deployment");
      expect(sm.read().phase).toBe("deployment");

      // Secret management gate: no tier → error with comparison
      const noTierResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(noTierResult.error).toContain("Secret management tier not chosen");
      expect(noTierResult.tierComparison.length).toBe(4);

      // Set docker-swarm tier
      const tierResult = parse(
        handleSetSecretManagement({ projectPath: tmpDir, tier: "docker-swarm" })
      );
      expect(tierResult.success).toBe(true);
      expect(tierResult.tier).toBe("docker-swarm");
      expect(tierResult.nextSteps.join(" ")).toContain("docker swarm init");

      // Deploy approval
      const approvalResult = parse(
        handleDeployApproval({ projectPath: tmpDir, note: "TodoList API approved for Hetzner" })
      );
      expect(approvalResult.success).toBe(true);

      // Generate deployment (succeeds with tier + approval)
      const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(deployResult.projectName).toBe("todolist-api");
      expect(deployResult.deploymentGuide.filesToGenerate.length).toBeGreaterThan(0);
      expect(deployResult.deploymentGuide.backupGuide.dbCommand).toContain("sqlite3");
      expect(deployResult.deploymentGuide.secretManagement.chosenTier).toBe("docker-swarm");

      // Record infrastructure with domain
      handleRecordServer({
        projectPath: tmpDir,
        provider: "hetzner",
        serverId: "99999",
        serverName: "todolist-prod",
        serverIp: "116.203.10.50",
        serverType: "cx22",
        location: "nbg1",
        sshUser: "deploy",
        sshKeyFingerprint: "SHA256:todolist123",
        domain: "todo.example.com",
      });

      // Deploy to server
      const deployToServerResult = parse(handleDeployToServer({ projectPath: tmpDir }));
      expect(deployToServerResult.deploymentSteps.length).toBeGreaterThan(0);
      expect(deployToServerResult.infrastructure.domain).toBe("todo.example.com");

      const rsyncCmd = deployToServerResult.deploymentSteps.find((s: any) => s.description.includes("Sync"));
      expect(rsyncCmd.command).toContain("rsync");

      const dockerCmd = deployToServerResult.deploymentSteps.find((s: any) => s.description.includes("Build and start"));
      expect(dockerCmd.command).toContain("docker compose");

      // SSL gate: cannot complete without SSL
      expect(() => sm.setPhase("complete")).toThrow(/SSL/i);

      // Verify SSL
      const sslResult = parse(
        handleVerifySsl({
          projectPath: tmpDir,
          domain: "todo.example.com",
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
    });
  });
});
