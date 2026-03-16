import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleDeployToServer } from "../../src/tools/deploy-to-server.js";
import { handleRecordServer } from "../../src/tools/record-server.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function initProject(dir: string) {
  handleInitProject({ projectPath: dir, projectName: "test-app" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Test",
    description: "Test",
    language: "TypeScript",
    framework: "Express",
    features: ["CRUD"],
    dataModel: "items",
    apiDesign: "REST",
  });
}

function setDeployReady(dir: string): void {
  forcePhase(dir, "deployment");
  const statePath = join(dir, ".a2p", "state.json");
  const raw = JSON.parse(readFileSync(statePath, "utf-8"));
  raw.deployApprovalAt = new Date().toISOString();
  raw.deployApprovalStateHash = "test";
  writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
}

function addInfra(dir: string, domain?: string) {
  handleRecordServer({
    projectPath: dir,
    provider: "hetzner",
    serverId: "12345",
    serverName: "test-app-prod",
    serverIp: "116.203.0.1",
    serverType: "cx22",
    location: "nbg1",
    sshUser: "deploy",
    sshKeyFingerprint: "SHA256:abc",
    domain,
  });
}

describe("handleDeployToServer", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir("a2p-deploy-server"); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("requires infrastructure to be set", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    expect(result.error).toContain("No infrastructure");
  });

  it("commands include rsync excludes", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    const rsyncStep = result.deploymentSteps.find((s: any) => s.description.includes("Sync"));
    expect(rsyncStep.command).toContain("--exclude='.git'");
    expect(rsyncStep.command).toContain("--exclude='node_modules'");
    expect(rsyncStep.command).toContain("--exclude='.a2p'");
    expect(rsyncStep.command).toContain("--exclude='.env'");
  });

  it("commands include docker compose up", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    const dockerStep = result.deploymentSteps.find((s: any) => s.description.includes("Build and start"));
    expect(dockerStep.command).toContain("docker compose -f docker-compose.prod.yml up -d --build");
  });

  it("health check URL uses serverIp when no domain", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    const healthStep = result.deploymentSteps.find((s: any) => s.description.includes("Health"));
    expect(healthStep.command).toContain("116.203.0.1");
  });

  it("health check URL uses domain when set", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir, "example.com");
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    const healthStep = result.deploymentSteps.find((s: any) => s.description.includes("Health"));
    expect(healthStep.command).toContain("example.com");
  });

  it("post-deploy checks include sensitive path blocking", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    const checks = result.postDeployChecks.join(" ");
    expect(checks).toContain(".env");
    expect(checks).toContain(".git");
  });

  it("updates lastDeployedAt in state", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    handleDeployToServer({ projectPath: tmpDir });

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.infrastructure!.lastDeployedAt).not.toBeNull();
  });

  it("phase gate: deployment phase only", () => {
    initProject(tmpDir);
    // phase is onboarding
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    expect(result.error).toContain("deployment");
  });

  it("requires deploy approval", () => {
    initProject(tmpDir);
    forcePhase(tmpDir, "deployment");
    addInfra(tmpDir);
    // Remove deploy approval
    const statePath = join(tmpDir, ".a2p", "state.json");
    const raw = JSON.parse(readFileSync(statePath, "utf-8"));
    raw.deployApprovalAt = null;
    writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");

    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    expect(result.error).toContain("Deploy approval");
  });

  it("domain setup note when domain configured", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir, "myapp.com");
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    expect(result.domainSetup).toContain("myapp.com");
    expect(result.domainSetup).toContain("Let's Encrypt");
  });

  it("domain setup note when no domain", () => {
    initProject(tmpDir);
    setDeployReady(tmpDir);
    addInfra(tmpDir);
    const result = parse(handleDeployToServer({ projectPath: tmpDir }));
    expect(result.domainSetup).toContain("No domain configured");
    expect(result.domainSetup).toContain("116.203.0.1");
  });
});
