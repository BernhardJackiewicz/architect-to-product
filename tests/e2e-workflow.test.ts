import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import all tool handlers directly
import { handleInitProject } from "../src/tools/init-project.js";
import { handleGetState } from "../src/tools/get-state.js";
import { handleSetArchitecture } from "../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../src/tools/create-build-plan.js";
import { handleUpdateSlice } from "../src/tools/update-slice.js";
import { handleRunQuality } from "../src/tools/run-quality.js";
import { handleRunE2e } from "../src/tools/run-e2e.js";
import { handleRecordFinding } from "../src/tools/record-finding.js";
import { handleGenerateDeployment } from "../src/tools/generate-deployment.js";
import { handleGetChecklist } from "../src/tools/get-checklist.js";
import { handleSetupCompanions } from "../src/tools/setup-companions.js";
import { handleRunSast } from "../src/tools/run-sast.js";
import { StateManager } from "../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-e2e-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

describe("E2E Workflow: Full project lifecycle", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Phase 0: Onboarding", () => {
    it("a2p_get_state returns error when no project exists", () => {
      const result = parse(handleGetState({ projectPath: tmpDir }));
      expect(result.error).toBe("No project found");
      expect(result.hint).toContain("a2p_init_project");
    });

    it("a2p_init_project creates all required files", () => {
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "test-app" })
      );

      expect(result.success).toBe(true);
      expect(result.filesCreated).toContain("CLAUDE.md");
      expect(result.filesCreated).toContain(".claude/settings.json");
      expect(result.filesCreated).toContain(".claude/agents/test-writer.md");
      expect(result.filesCreated).toContain(".claude/agents/security-reviewer.md");
      expect(result.filesCreated).toContain(".gitignore");
      expect(result.filesCreated).toContain(".a2p/state.json");

      // Verify files actually exist on disk
      expect(existsSync(join(tmpDir, "CLAUDE.md"))).toBe(true);
      expect(existsSync(join(tmpDir, ".claude", "settings.json"))).toBe(true);
      expect(existsSync(join(tmpDir, ".claude", "agents", "test-writer.md"))).toBe(true);
      expect(existsSync(join(tmpDir, ".claude", "agents", "security-reviewer.md"))).toBe(true);
      expect(existsSync(join(tmpDir, ".gitignore"))).toBe(true);
      expect(existsSync(join(tmpDir, ".a2p", "state.json"))).toBe(true);
    });

    it("a2p_init_project writes project name into CLAUDE.md", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "my-cool-app" });
      const claude = readFileSync(join(tmpDir, "CLAUDE.md"), "utf-8");
      expect(claude).toContain("my-cool-app");
    });

    it("a2p_init_project rejects double init", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "test" });
      const result = parse(
        handleInitProject({ projectPath: tmpDir, projectName: "test" })
      );
      expect(result.error).toContain("already initialized");
    });

    it("a2p_get_state returns correct initial state after init", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "test-app" });
      const result = parse(handleGetState({ projectPath: tmpDir }));

      expect(result.projectName).toBe("test-app");
      expect(result.phase).toBe("onboarding");
      expect(result.architecture).toBeNull();
      expect(result.progress.totalSlices).toBe(0);
      expect(result.progress.doneSlices).toBe(0);
      expect(result.companions).toEqual([]);
    });
  });

  describe("Phase 0: Architecture & Companions", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "todo-app" });
    });

    it("a2p_set_architecture stores architecture and suggests companions", () => {
      const result = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "Todo App",
          description: "Simple todo list with auth",
          language: "Python",
          framework: "FastAPI",
          database: "Supabase",
          frontend: "React",
          hosting: "Hetzner",
          otherTech: ["Stripe"],
          features: ["CRUD todos", "User auth", "Stripe payments"],
          dataModel: "users, todos, payments tables",
          apiDesign: "REST",
        })
      );

      expect(result.success).toBe(true);
      expect(result.architecture.name).toBe("Todo App");
      expect(result.architecture.techStack.database).toBe("Supabase");
      expect(result.suggestedCompanions).toContain("codebase-memory-mcp");
      expect(result.suggestedCompanions.some((c: string) => c.includes("supabase"))).toBe(true);
      expect(result.suggestedCompanions.some((c: string) => c.includes("playwright"))).toBe(true);
    });

    it("a2p_set_architecture suggests supabase as default when no DB", () => {
      const result = parse(
        handleSetArchitecture({
          projectPath: tmpDir,
          name: "API",
          description: "Simple API",
          language: "TypeScript",
          framework: "Express",
          features: ["health check"],
          dataModel: "none",
          apiDesign: "REST",
        })
      );

      expect(result.suggestedCompanions.some((c: string) => c.includes("supabase"))).toBe(true);
    });

    it("a2p_set_architecture without init returns error", () => {
      const otherDir = makeTmpDir();
      const result = parse(
        handleSetArchitecture({
          projectPath: otherDir,
          name: "X",
          description: "X",
          language: "Python",
          framework: "FastAPI",
          features: ["x"],
          dataModel: "x",
          apiDesign: "REST",
        })
      );
      expect(result.error).toContain("No project found");
      rmSync(otherDir, { recursive: true, force: true });
    });

    it("a2p_setup_companions records companions in state", () => {
      const result = parse(
        handleSetupCompanions({
          projectPath: tmpDir,
          companions: [
            {
              type: "codebase_memory",
              name: "codebase-memory-mcp",
              command: "codebase-memory-mcp",
            },
            {
              type: "database",
              name: "supabase-mcp",
              command: "https://mcp.supabase.com/mcp",
              config: { project_ref: "abc123" },
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.companions.length).toBe(2);

      // Verify in state
      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.companions.length).toBe(2);
      expect(state.companions[0].type).toBe("codebase_memory");
      expect(state.companions[1].type).toBe("database");
    });
  });

  describe("Phase 1: Planning", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "todo-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Todo App",
        description: "Todo app",
        language: "Python",
        framework: "FastAPI",
        database: "SQLite",
        features: ["CRUD", "Auth"],
        dataModel: "todos table",
        apiDesign: "REST",
      });
    });

    it("a2p_create_build_plan creates ordered slices", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "s01",
              name: "Project Setup",
              description: "Init FastAPI + health endpoint",
              acceptanceCriteria: ["GET /health returns 200"],
              testStrategy: "pytest",
              dependencies: [],
            },
            {
              id: "s02",
              name: "Database Models",
              description: "SQLAlchemy models + migrations",
              acceptanceCriteria: ["Todo model exists", "DB created on startup"],
              testStrategy: "pytest with test DB",
              dependencies: ["s01"],
            },
            {
              id: "s03",
              name: "CRUD API",
              description: "Todo CRUD endpoints",
              acceptanceCriteria: [
                "POST /todos creates todo",
                "GET /todos lists todos",
              ],
              testStrategy: "pytest + httpx",
              dependencies: ["s02"],
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.sliceCount).toBe(3);
      expect(result.slices[0].id).toBe("s01");
      expect(result.slices[0].order).toBe(1);
    });

    it("a2p_create_build_plan rejects without architecture", () => {
      const otherDir = makeTmpDir();
      const sm = new StateManager(otherDir);
      sm.init("no-arch", otherDir);

      const result = parse(
        handleCreateBuildPlan({
          projectPath: otherDir,
          slices: [
            {
              id: "s01",
              name: "X",
              description: "X",
              acceptanceCriteria: ["x"],
              testStrategy: "x",
              dependencies: [],
            },
          ],
        })
      );

      expect(result.error).toContain("No architecture");
      rmSync(otherDir, { recursive: true, force: true });
    });

    it("a2p_create_build_plan rejects invalid dependencies", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "s01",
              name: "X",
              description: "X",
              acceptanceCriteria: ["x"],
              testStrategy: "x",
              dependencies: ["nonexistent"],
            },
          ],
        })
      );

      expect(result.error).toContain("nonexistent");
    });

    it("a2p_create_build_plan rejects circular dependencies", () => {
      const result = parse(
        handleCreateBuildPlan({
          projectPath: tmpDir,
          slices: [
            {
              id: "s01",
              name: "A",
              description: "A",
              acceptanceCriteria: ["a"],
              testStrategy: "a",
              dependencies: ["s02"],
            },
            {
              id: "s02",
              name: "B",
              description: "B",
              acceptanceCriteria: ["b"],
              testStrategy: "b",
              dependencies: ["s01"],
            },
          ],
        })
      );

      expect(result.error).toContain("Circular");
    });
  });

  describe("Phase 2: TDD Build Loop", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "todo-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Todo",
        description: "Todo",
        language: "Python",
        framework: "FastAPI",
        database: "SQLite",
        features: ["CRUD"],
        dataModel: "todos",
        apiDesign: "REST",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          {
            id: "s01",
            name: "Setup",
            description: "Setup",
            acceptanceCriteria: ["works"],
            testStrategy: "pytest",
            dependencies: [],
          },
          {
            id: "s02",
            name: "CRUD",
            description: "CRUD",
            acceptanceCriteria: ["CRUD works"],
            testStrategy: "pytest",
            dependencies: ["s01"],
          },
        ],
      });
    });

    it("a2p_update_slice follows TDD cycle: pending → red → green → refactor → sast → done", () => {
      // RED
      let result = parse(handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "red" }));
      expect(result.success).toBe(true);
      expect(result.newStatus).toBe("red");
      expect(result.nextStep).toContain("implementation");

      // GREEN
      result = parse(handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "green" }));
      expect(result.newStatus).toBe("green");
      expect(result.nextStep).toContain("refactor");

      // REFACTOR
      result = parse(handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "refactor" }));
      expect(result.newStatus).toBe("refactor");
      expect(result.nextStep).toContain("SAST");

      // SAST
      result = parse(handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "sast" }));
      expect(result.newStatus).toBe("sast");

      // DONE
      result = parse(handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "done" }));
      expect(result.newStatus).toBe("done");
      expect(result.nextStep).toContain("complete");
    });

    it("a2p_update_slice rejects skipping phases", () => {
      // Cannot go directly pending → green
      const result = parse(
        handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "green" })
      );
      expect(result.error).toContain("cannot transition");
    });

    it("a2p_update_slice tracks files", () => {
      handleUpdateSlice({
        projectPath: tmpDir,
        sliceId: "s01",
        status: "red",
        files: ["tests/test_main.py"],
      });
      const result = parse(
        handleUpdateSlice({
          projectPath: tmpDir,
          sliceId: "s01",
          status: "green",
          files: ["src/main.py", "src/models.py"],
        })
      );
      // Files should accumulate
      expect(result.files.length).toBeGreaterThanOrEqual(2);
    });

    it("a2p_update_slice rejects unknown slice", () => {
      const result = parse(
        handleUpdateSlice({ projectPath: tmpDir, sliceId: "nonexistent", status: "red" })
      );
      expect(result.error).toContain("not found");
    });
  });

  describe("Phase 2.5: Quality Analysis", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "test" });
    });

    it("a2p_run_quality records dead code and redundancy issues", () => {
      const result = parse(
        handleRunQuality({
          projectPath: tmpDir,
          issues: [
            {
              type: "dead_code",
              file: "src/old.py",
              symbol: "unused_helper",
              description: "Function has no callers in codebase-memory graph",
            },
            {
              type: "redundant",
              file: "src/utils.py",
              symbol: "validate_email",
              description: "Duplicate of validators.check_email — same logic",
            },
            {
              type: "high_coupling",
              file: "src/api.py",
              symbol: "handle_request",
              description: "Fan-out of 12 — calls too many functions",
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.totalIssues).toBe(3);
      expect(result.byType.dead_code).toBe(1);
      expect(result.byType.redundant).toBe(1);
      expect(result.byType.high_coupling).toBe(1);
      expect(result.issues[0].id).toBe("Q001");
      expect(result.hint).toContain("Fix");
    });

    it("a2p_run_quality returns clean message when no issues", () => {
      const result = parse(handleRunQuality({ projectPath: tmpDir, issues: [] }));
      expect(result.totalIssues).toBe(0);
      expect(result.hint).toContain("clean");
    });
  });

  describe("Phase 2.6: E2E Testing", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "test" });
    });

    it("a2p_run_e2e records passing scenarios", () => {
      const result = parse(
        handleRunE2e({
          projectPath: tmpDir,
          baseUrl: "http://localhost:3000",
          scenarios: [
            {
              name: "Home page loads",
              steps: ["navigate to /", "check title"],
              passed: true,
              screenshotPath: "/tmp/home.png",
            },
            {
              name: "Login flow",
              steps: ["navigate to /login", "fill form", "submit"],
              passed: true,
            },
          ],
        })
      );

      expect(result.success).toBe(true);
      expect(result.passed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("a2p_run_e2e reports failures", () => {
      const result = parse(
        handleRunE2e({
          projectPath: tmpDir,
          baseUrl: "http://localhost:3000",
          scenarios: [
            { name: "Broken page", steps: ["navigate"], passed: false, notes: "404 error" },
            { name: "Good page", steps: ["navigate"], passed: true },
          ],
        })
      );

      expect(result.success).toBe(false);
      expect(result.passed).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.hint).toContain("failed");
    });
  });

  describe("Phase 3: Security Gate", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "test" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Test",
        description: "Test",
        language: "Python",
        framework: "FastAPI",
        features: ["x"],
        dataModel: "x",
        apiDesign: "REST",
      });
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          { id: "s01", name: "X", description: "X", acceptanceCriteria: ["x"], testStrategy: "x", dependencies: [] },
        ],
      });
    });

    it("a2p_record_finding stores finding on slice", () => {
      const result = parse(
        handleRecordFinding({
          projectPath: tmpDir,
          sliceId: "s01",
          id: "MANUAL-001",
          tool: "manual",
          severity: "high",
          status: "open",
          title: "SQL Injection in query builder",
          file: "src/db.py",
          line: 42,
          description: "f-string used in SQL query",
          fix: "Use parameterized query",
        })
      );

      expect(result.success).toBe(true);
      expect(result.finding.severity).toBe("high");

      // Verify it's in the state
      const state = parse(handleGetState({ projectPath: tmpDir }));
      expect(state.progress.openFindings).toBe(1);
    });

    it("a2p_run_sast handles missing tools gracefully", { timeout: 15_000 }, () => {
      const result = parse(
        handleRunSast({
          projectPath: tmpDir,
          sliceId: "s01",
          mode: "slice",
          files: ["src/main.py"],
        })
      );

      expect(result.success).toBe(true);
      // Should report tools as unavailable, not crash
      for (const tool of result.toolsRun) {
        if (!tool.available) {
          expect(typeof tool.tool).toBe("string");
        }
      }
    });
  });

  describe("Phase 4: Deployment", () => {
    beforeEach(() => {
      handleInitProject({ projectPath: tmpDir, projectName: "todo-app" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Todo App",
        description: "Todo",
        language: "Python",
        framework: "FastAPI",
        database: "SQLite",
        frontend: "React",
        hosting: "Hetzner",
        otherTech: ["Stripe", "Firebase Auth"],
        features: ["CRUD"],
        dataModel: "todos",
        apiDesign: "REST",
      });
    });

    it("a2p_generate_deployment returns stack-specific guidance", () => {
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));

      expect(result.projectName).toBe("todo-app");
      expect(result.techStack.language).toBe("Python");
      expect(result.deploymentGuide.filesToGenerate.length).toBeGreaterThan(5);
      expect(result.deploymentGuide.securityHardening.length).toBeGreaterThan(3);

      // Python-specific recommendations
      expect(result.deploymentGuide.recommendations.some((r: string) => r.includes("python"))).toBe(true);
      // SQLite-specific
      expect(result.deploymentGuide.recommendations.some((r: string) => r.includes("WAL"))).toBe(true);
      // Hetzner-specific
      expect(result.deploymentGuide.recommendations.some((r: string) => r.includes("Hetzner"))).toBe(true);
    });

    it("a2p_generate_deployment fails without architecture", () => {
      const otherDir = makeTmpDir();
      const sm = new StateManager(otherDir);
      sm.init("no-arch", otherDir);
      const result = parse(handleGenerateDeployment({ projectPath: otherDir }));
      expect(result.error).toContain("No architecture");
      rmSync(otherDir, { recursive: true, force: true });
    });

    it("a2p_get_checklist includes tech-specific items", () => {
      const result = parse(handleGetChecklist({ projectPath: tmpDir }));

      expect(result.projectName).toBe("todo-app");
      expect(result.checklist.preDeployment.length).toBeGreaterThan(5);
      expect(result.checklist.infrastructure.length).toBeGreaterThan(3);
      expect(result.checklist.postDeployment.length).toBeGreaterThan(5);

      // SQLite-specific
      const allItems = [...result.checklist.postDeployment];
      expect(allItems.some((i: any) => i.item.includes("WAL"))).toBe(true);

      // Stripe-specific
      const preItems = result.checklist.preDeployment;
      expect(preItems.some((i: any) => i.item.includes("Stripe"))).toBe(true);

      // Firebase-specific
      expect(preItems.some((i: any) => i.item.includes("Firebase"))).toBe(true);
    });

    it("a2p_get_checklist marks automated checks correctly", () => {
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          { id: "s01", name: "X", description: "X", acceptanceCriteria: ["x"], testStrategy: "x", dependencies: [] },
        ],
      });

      // Complete the slice
      const sm = new StateManager(tmpDir);
      sm.setSliceStatus("s01", "red");
      sm.setSliceStatus("s01", "green");
      sm.setSliceStatus("s01", "refactor");
      sm.setSliceStatus("s01", "sast");
      sm.setSliceStatus("s01", "done");

      const result = parse(handleGetChecklist({ projectPath: tmpDir }));
      // "All slices completed" should be true
      const sliceItem = result.checklist.preDeployment.find(
        (i: any) => i.item === "All slices completed"
      );
      expect(sliceItem.done).toBe(true);
    });
  });

  describe("Full lifecycle integration", () => {
    it("complete project flow: init → arch → plan → build → quality → security → deploy", () => {
      // Phase 0: Init
      handleInitProject({ projectPath: tmpDir, projectName: "lifecycle-test" });

      // Phase 0: Architecture
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Lifecycle Test",
        description: "Integration test",
        language: "Python",
        framework: "FastAPI",
        database: "SQLite",
        features: ["health", "CRUD"],
        dataModel: "items table",
        apiDesign: "REST",
      });

      // Phase 1: Plan
      handleCreateBuildPlan({
        projectPath: tmpDir,
        slices: [
          { id: "s01", name: "Setup", description: "Setup", acceptanceCriteria: ["health works"], testStrategy: "pytest", dependencies: [] },
          { id: "s02", name: "CRUD", description: "CRUD", acceptanceCriteria: ["CRUD works"], testStrategy: "pytest", dependencies: ["s01"] },
        ],
      });

      // Phase 2: Build slice 1 (TDD)
      const sm = new StateManager(tmpDir);
      sm.setPhase("building");
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "red", files: ["tests/test_health.py"] });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "green", files: ["src/main.py"] });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "refactor" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "sast" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s01", status: "done" });

      // Build slice 2
      sm.advanceSlice();
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s02", status: "red" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s02", status: "green" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s02", status: "refactor" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s02", status: "sast" });
      handleUpdateSlice({ projectPath: tmpDir, sliceId: "s02", status: "done" });

      // Phase 2.5: Quality
      handleRunQuality({
        projectPath: tmpDir,
        issues: [
          { type: "unused_import", file: "src/main.py", symbol: "os", description: "Unused import" },
        ],
      });

      // Phase 3: Security
      handleRecordFinding({
        projectPath: tmpDir,
        sliceId: "s01",
        id: "M001",
        tool: "manual",
        severity: "low",
        status: "accepted",
        title: "Debug endpoint",
        file: "src/main.py",
        line: 10,
        description: "Debug endpoint exists",
        fix: "Remove before production",
      });

      // Phase 4: Deployment
      const deployResult = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(deployResult.techStack.language).toBe("Python");

      const checklistResult = parse(handleGetChecklist({ projectPath: tmpDir }));
      const slicesComplete = checklistResult.checklist.preDeployment.find(
        (i: any) => i.item === "All slices completed"
      );
      expect(slicesComplete.done).toBe(true);

      // Final progress check
      const progress = parse(handleGetState({ projectPath: tmpDir }));
      expect(progress.progress.doneSlices).toBe(2);
      expect(progress.progress.totalSlices).toBe(2);
      expect(progress.progress.qualityIssues).toBe(1);
    });
  });
});
