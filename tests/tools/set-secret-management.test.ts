import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleSetSecretManagement } from "../../src/tools/set-secret-management.js";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleDeployToServer } from "../../src/tools/deploy-to-server.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleRecordServer } from "../../src/tools/record-server.js";
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

function setDeployPhase(dir: string): void {
  forcePhase(dir, "deployment");
}

function setDeployReady(dir: string): void {
  forcePhase(dir, "deployment");
  const statePath = join(dir, ".a2p", "state.json");
  const raw = JSON.parse(readFileSync(statePath, "utf-8"));
  raw.deployApprovalAt = new Date().toISOString();
  raw.deployApprovalStateHash = "test";
  raw.secretManagementTier = "env-file";
  writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
}

let dir: string;
beforeEach(() => { dir = makeTmpDir("a2p-secret-mgmt"); });
afterEach(() => { cleanTmpDir(dir); });

describe("a2p_set_secret_management", () => {
  it("sets secret management tier in state", () => {
    initProject(dir);
    setDeployPhase(dir);

    const result = parse(handleSetSecretManagement({
      projectPath: dir,
      tier: "docker-swarm",
    }));

    expect(result.success).toBe(true);
    expect(result.tier).toBe("docker-swarm");
    expect(result.tierName).toContain("Swarm");

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.secretManagementTier).toBe("docker-swarm");
  });

  it("accepts all 4 tier values", () => {
    initProject(dir);
    setDeployPhase(dir);

    for (const tier of ["env-file", "docker-swarm", "infisical", "external"] as const) {
      const result = parse(handleSetSecretManagement({
        projectPath: dir,
        tier,
      }));
      expect(result.success).toBe(true);
      expect(result.tier).toBe(tier);
    }
  });

  it("returns next steps for infisical tier", () => {
    initProject(dir);
    setDeployPhase(dir);

    const result = parse(handleSetSecretManagement({
      projectPath: dir,
      tier: "infisical",
    }));

    expect(result.nextSteps).toBeDefined();
    expect(result.nextSteps.some((s: string) => s.includes("Machine Identity"))).toBe(true);
    expect(result.nextSteps.some((s: string) => s.includes("Infisical"))).toBe(true);
  });

  it("requires deployment phase", () => {
    initProject(dir);
    // Phase is onboarding
    const result = parse(handleSetSecretManagement({
      projectPath: dir,
      tier: "env-file",
    }));
    expect(result.error).toBeDefined();
  });

  it("records event in build history", () => {
    initProject(dir);
    setDeployPhase(dir);

    handleSetSecretManagement({ projectPath: dir, tier: "infisical" });

    const sm = new StateManager(dir);
    const state = sm.read();
    const event = state.buildHistory.find(e => e.details.includes("infisical"));
    expect(event).toBeDefined();
    expect(event!.action).toBe("config_update");
  });
});

describe("secret management gate enforcement", () => {
  it("generate-deployment blocked without secret management tier", () => {
    initProject(dir);
    setDeployPhase(dir);
    const statePath = join(dir, ".a2p", "state.json");
    const raw = JSON.parse(readFileSync(statePath, "utf-8"));
    raw.deployApprovalAt = new Date().toISOString();
    raw.deployApprovalStateHash = "test";
    // secretManagementTier intentionally NOT set
    writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");

    const result = parse(handleGenerateDeployment({ projectPath: dir }));
    expect(result.error).toContain("Secret management tier");
    expect(result.error).toContain("a2p_set_secret_management");
  });

  it("generate-deployment passes after setting tier", () => {
    initProject(dir);
    setDeployReady(dir);

    const result = parse(handleGenerateDeployment({ projectPath: dir }));
    expect(result.error).toBeUndefined();
    expect(result.deploymentGuide).toBeDefined();
  });

  it("deploy-to-server blocked without secret management tier", () => {
    initProject(dir);
    setDeployPhase(dir);
    handleRecordServer({
      projectPath: dir,
      provider: "hetzner",
      serverId: "12345",
      serverName: "test",
      serverIp: "1.2.3.4",
      serverType: "cx22",
      location: "nbg1",
      sshUser: "deploy",
      sshKeyFingerprint: "SHA256:abc",
    });
    const statePath = join(dir, ".a2p", "state.json");
    const raw = JSON.parse(readFileSync(statePath, "utf-8"));
    raw.deployApprovalAt = new Date().toISOString();
    raw.deployApprovalStateHash = "test";
    // secretManagementTier intentionally NOT set
    writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");

    const result = parse(handleDeployToServer({ projectPath: dir }));
    expect(result.error).toContain("Secret management tier");
  });

  it("generate-deployment output contains chosen tier", () => {
    initProject(dir);
    setDeployPhase(dir);

    handleSetSecretManagement({ projectPath: dir, tier: "docker-swarm" });

    const statePath = join(dir, ".a2p", "state.json");
    const raw = JSON.parse(readFileSync(statePath, "utf-8"));
    raw.deployApprovalAt = new Date().toISOString();
    raw.deployApprovalStateHash = "test";
    writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");

    const result = parse(handleGenerateDeployment({ projectPath: dir }));
    expect(result.deploymentGuide.secretManagement.chosenTier).toBe("docker-swarm");
  });
});
