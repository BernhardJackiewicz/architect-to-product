import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleGetChecklist } from "../../src/tools/get-checklist.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { StateManager } from "../../src/state/state-manager.js";
import { ProjectStateSchema } from "../../src/state/validators.js";
import { makeTmpDir, cleanTmpDir, parse, walkSliceToStatus, addPassingTests, addSastEvidence, forcePhase, addQualityAudit, addReleaseAudit, addPassingVerification, addPassingWhitebox } from "../helpers/setup.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Set up project in deployment phase with deploy approval */
function setDeployReady(dir: string): void {
  forcePhase(dir, "deployment");
  const statePath = join(dir, ".a2p", "state.json");
  const raw = JSON.parse(readFileSync(statePath, "utf-8"));
  raw.deployApprovalAt = new Date().toISOString();
  raw.deployApprovalStateHash = "test";
  writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
}

function initWithArch(dir: string, overrides: Record<string, unknown> = {}) {
  handleInitProject({ projectPath: dir, projectName: "test-app" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Test",
    description: "Test",
    language: "Python",
    framework: "FastAPI",
    features: ["CRUD"],
    dataModel: "items",
    apiDesign: "REST",
    ...overrides,
  });
}

describe("Backup Integration", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-backup");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // === Backward Compat + Defaults (3) ===

  describe("backward compatibility + defaults", () => {
    it("old state without backupConfig loads with defaults", () => {
      // Simulate old state without backupConfig/backupStatus
      const raw = {
        version: 1,
        projectName: "old-project",
        architecture: null,
        slices: [],
        currentSliceIndex: -1,
        phase: "onboarding",
        config: {
          projectPath: tmpDir,
          testCommand: "",
          lintCommand: "",
          buildCommand: "",
          formatCommand: "",
        },
        companions: [],
        qualityIssues: [],
        buildHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = ProjectStateSchema.parse(raw);
      expect(result.backupConfig.enabled).toBe(true);
      expect(result.backupConfig.required).toBe(false);
      expect(result.backupConfig.targets).toEqual(["deploy_artifacts"]);
      expect(result.backupConfig.retentionDays).toBe(14);
    });

    it("state with backupConfig round-trips through write/read", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
      // Round-trip: read again
      const state2 = sm.read();
      expect(state2.backupConfig).toEqual(state.backupConfig);
    });

    it("backupStatus defaults: configured=false, no schedulerType", () => {
      const raw = {
        version: 1,
        projectName: "old",
        architecture: null,
        slices: [],
        currentSliceIndex: -1,
        phase: "onboarding",
        config: { projectPath: tmpDir, testCommand: "", lintCommand: "", buildCommand: "", formatCommand: "" },
        companions: [],
        qualityIssues: [],
        buildHistory: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const result = ProjectStateSchema.parse(raw);
      expect(result.backupStatus.configured).toBe(false);
      expect(result.backupStatus.schedulerType).toBeUndefined();
    });
  });

  // === Inference (8) ===

  describe("backup inference from architecture", () => {
    it("PostgreSQL → required=true, targets includes database", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
      expect(state.backupConfig.verifyAfterBackup).toBe(true);
    });

    it("SQLite → required=true, targets includes database", () => {
      initWithArch(tmpDir, { database: "SQLite" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
    });

    it("MongoDB → required=true, targets includes database", () => {
      initWithArch(tmpDir, { database: "MongoDB" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
    });

    it("no database, no uploads → required=false, enabled=true, targets=[deploy_artifacts]", () => {
      initWithArch(tmpDir, { database: undefined });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.enabled).toBe(true);
      expect(state.backupConfig.required).toBe(false);
      expect(state.backupConfig.targets).toEqual(["deploy_artifacts"]);
    });

    it("no database but feature 'file upload' → required=true, targets includes uploads + local_media", () => {
      initWithArch(tmpDir, { database: undefined, features: ["file upload system"] });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("uploads");
      expect(state.backupConfig.targets).toContain("local_media");
    });

    it("Hetzner hosting → offsiteProvider=hetzner_storage", () => {
      initWithArch(tmpDir, { hosting: "Hetzner VPS" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.offsiteProvider).toBe("hetzner_storage");
    });

    it("AWS hosting → offsiteProvider=s3", () => {
      initWithArch(tmpDir, { hosting: "AWS EC2" });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.offsiteProvider).toBe("s3");
    });

    it("no hosting → offsiteProvider=none", () => {
      initWithArch(tmpDir, { hosting: undefined });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.offsiteProvider).toBe("none");
    });
  });

  // === generate-deployment (6) ===

  describe("generate-deployment backup output", () => {
    it("stateful project → filesToGenerate includes backup.sh, restore.sh, backup-verify.sh, BACKUP.md", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      const files = result.deploymentGuide.filesToGenerate.join(" ");
      expect(files).toContain("backup.sh");
      expect(files).toContain("restore.sh");
      expect(files).toContain("backup-verify.sh");
      expect(files).toContain("BACKUP.md");
    });

    it("stateful + postgres → backupGuide.dbCommand contains pg_dump", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.deploymentGuide.backupGuide.dbCommand).toContain("pg_dump");
    });

    it("stateful + sqlite → backupGuide.restoreCommand contains Stop application", () => {
      initWithArch(tmpDir, { database: "SQLite" });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.deploymentGuide.backupGuide.restoreCommand).toContain("Stop application");
    });

    it("stateless project → filesToGenerate includes backup.sh (deploy artifact), NO dbCommand in backupGuide", () => {
      initWithArch(tmpDir, { database: undefined });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      const files = result.deploymentGuide.filesToGenerate.join(" ");
      expect(files).toContain("backup.sh");
      expect(result.deploymentGuide.backupGuide.dbCommand).toBeUndefined();
    });

    it("backup required + not configured → backupWarning present", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.deploymentGuide.backupWarning).toBeDefined();
      expect(result.deploymentGuide.backupWarning.stateful).toBe(true);
      expect(result.deploymentGuide.backupWarning.missingTargets).toContain("database");
    });

    it("MySQL → backup/restore commands use --defaults-file, NOT -p$DB_PASS", () => {
      initWithArch(tmpDir, { database: "MySQL" });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.deploymentGuide.backupGuide.dbCommand).toContain("--defaults-file");
      expect(result.deploymentGuide.backupGuide.dbCommand).not.toContain("-p$");
      expect(result.deploymentGuide.backupGuide.restoreCommand).toContain("--defaults-file");
      expect(result.deploymentGuide.backupGuide.restoreCommand).not.toContain("-p$");
    });
  });

  // === get-checklist (3) ===

  describe("get-checklist backup items", () => {
    it("stateful project → backup infrastructure items (scheduler, retention, restore docs)", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      const result = parse(handleGetChecklist({ projectPath: tmpDir }));
      const infraItems = result.checklist.infrastructure.map((i: any) => i.item);
      expect(infraItems).toContain("Backup scripts generated and tested locally");
      expect(infraItems.some((i: string) => i.includes("Retention configured"))).toBe(true);
      expect(infraItems).toContain("Restore documentation present (BACKUP.md)");
    });

    it("stateful project with offsite → offsite checklist item present", () => {
      initWithArch(tmpDir, { database: "PostgreSQL", hosting: "Hetzner VPS" });
      const result = parse(handleGetChecklist({ projectPath: tmpDir }));
      const infraItems = result.checklist.infrastructure.map((i: any) => i.item);
      expect(infraItems.some((i: string) => i.includes("Offsite backup to hetzner_storage"))).toBe(true);
    });

    it("stateless project → generic 'Backup script/cron active' still present", () => {
      initWithArch(tmpDir, { database: undefined });
      const result = parse(handleGetChecklist({ projectPath: tmpDir }));
      const postItems = result.checklist.postDeployment.map((i: any) => i.item);
      expect(postItems.some((i: string) => i.startsWith("Backup script/cron"))).toBe(true);
    });
  });

  // === Deployment gate (2) ===

  describe("deployment gate backup blocking", () => {
    it("stateful app without backup configured → blocked on security→deployment", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      const sm = new StateManager(tmpDir);

      // Create and complete slices, walk through proper phase transitions
      sm.setPhase("planning");
      sm.setSlices([{
        id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
        testStrategy: "unit", dependencies: [], status: "pending",
        files: [], testResults: [], sastFindings: [],
      }]);
      sm.setPhase("building");
      walkSliceToStatus(sm, "s1", "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      expect(() => sm.setPhase("deployment")).toThrow("backup configuration");
    });

    it("stateful app with backup configured → allowed through security→deployment", () => {
      initWithArch(tmpDir, { database: "PostgreSQL" });
      const sm = new StateManager(tmpDir);

      sm.setBackupStatus({ configured: true, schedulerType: "cron" });

      sm.setPhase("planning");
      sm.setSlices([{
        id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
        testStrategy: "unit", dependencies: [], status: "pending",
        files: [], testResults: [], sastFindings: [],
      }]);
      sm.setPhase("building");
      walkSliceToStatus(sm, "s1", "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);
      sm.setPhase("deployment");

      const state = sm.read();
      expect(state.phase).toBe("deployment");
    });
  });

  // === Edge cases (3) ===

  describe("edge cases", () => {
    it("stateless app → enabled=true, required=false, targets=[deploy_artifacts]", () => {
      initWithArch(tmpDir, { database: undefined, features: ["API endpoint"] });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.enabled).toBe(true);
      expect(state.backupConfig.required).toBe(false);
      expect(state.backupConfig.targets).toEqual(["deploy_artifacts"]);
    });

    it("deployment generation without DB → no DB backup command in output", () => {
      initWithArch(tmpDir, { database: undefined });
      setDeployReady(tmpDir);
      const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
      expect(result.deploymentGuide.backupGuide.dbCommand).toBeUndefined();
      expect(result.deploymentGuide.backupGuide.restoreCommand).toBeUndefined();
    });

    it("feature 'media storage' → targets includes local_media", () => {
      initWithArch(tmpDir, { database: undefined, features: ["media storage system"] });
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.targets).toContain("local_media");
      expect(state.backupConfig.required).toBe(true);
    });
  });

  // === Full-flow regression: tool-layer init→setArchitecture→read (3) ===

  describe("full-flow regression: handleInitProject → handleSetArchitecture → sm.read()", () => {
    it("SQLite → required=true persisted through full tool flow", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "sqlite-app" });
      const output = parse(handleSetArchitecture({
        projectPath: tmpDir,
        name: "SQLite App", description: "App with SQLite",
        language: "TypeScript", framework: "Express",
        database: "SQLite",
        features: ["CRUD notes"],
        dataModel: "notes table", apiDesign: "REST",
      }));
      expect(output.backupConfig.required).toBe(true);

      // Re-read from disk to confirm persistence
      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
    });

    it("PostgreSQL → required=true persisted through full tool flow", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "pg-app" });
      const output = parse(handleSetArchitecture({
        projectPath: tmpDir,
        name: "PG App", description: "App with Postgres",
        language: "Python", framework: "FastAPI",
        database: "PostgreSQL",
        features: ["user management"],
        dataModel: "users table", apiDesign: "REST",
      }));
      expect(output.backupConfig.required).toBe(true);

      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
    });

    it("MySQL → required=true persisted through full tool flow", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "mysql-app" });
      const output = parse(handleSetArchitecture({
        projectPath: tmpDir,
        name: "MySQL App", description: "App with MySQL",
        language: "TypeScript", framework: "Express",
        database: "MySQL",
        features: ["inventory"],
        dataModel: "products table", apiDesign: "REST",
      }));
      expect(output.backupConfig.required).toBe(true);

      const sm = new StateManager(tmpDir);
      const state = sm.read();
      expect(state.backupConfig.required).toBe(true);
      expect(state.backupConfig.targets).toContain("database");
    });
  });

  // === Deployment gate full-flow regression (1) ===

  describe("deployment gate full-flow: stateful app blocked then allowed", () => {
    it("SQLite app → deployment blocked → setBackupStatus → deployment allowed", () => {
      handleInitProject({ projectPath: tmpDir, projectName: "sqlite-gate" });
      handleSetArchitecture({
        projectPath: tmpDir,
        name: "Gate Test", description: "SQLite gate test",
        language: "TypeScript", framework: "Express",
        database: "SQLite",
        features: ["CRUD"],
        dataModel: "items", apiDesign: "REST",
      });
      const sm = new StateManager(tmpDir);

      // Walk through all phases to deployment
      sm.setPhase("planning");
      sm.setSlices([{
        id: "s1", name: "S1", description: "s", acceptanceCriteria: ["ac"],
        testStrategy: "unit", dependencies: [], status: "pending",
        files: [], testResults: [], sastFindings: [],
      }]);
      sm.setPhase("building");
      walkSliceToStatus(sm, "s1", "done");
      sm.setBuildSignoff();
      addQualityAudit(sm);
      sm.setPhase("security");
      sm.markFullSastRun(0);
      addPassingWhitebox(sm);
      addReleaseAudit(sm);
      addPassingVerification(sm);

      // Should be blocked — backup not configured
      expect(() => sm.setPhase("deployment")).toThrow("backup configuration");

      // Configure backup
      sm.setBackupStatus({ configured: true, schedulerType: "cron" });

      // Should now succeed
      sm.setPhase("deployment");
      expect(sm.read().phase).toBe("deployment");
    });
  });
});
