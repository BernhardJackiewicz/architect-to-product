import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleRecordServer } from "../../src/tools/record-server.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";

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

const validInput = (dir: string) => ({
  projectPath: dir,
  provider: "hetzner" as const,
  serverId: "12345678",
  serverName: "test-app-prod",
  serverIp: "116.203.0.1",
  serverType: "cx22",
  location: "nbg1",
  firewallId: "99999",
  sshUser: "deploy",
  sshKeyFingerprint: "SHA256:abc123",
});

describe("handleRecordServer", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir("a2p-record"); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("stores infrastructure in state correctly", () => {
    initProject(tmpDir);
    forcePhase(tmpDir, "deployment");
    const result = parse(handleRecordServer(validInput(tmpDir)));
    expect(result.success).toBe(true);
    expect(result.infrastructure.provider).toBe("hetzner");
    expect(result.infrastructure.serverId).toBe("12345678");
    expect(result.infrastructure.serverIp).toBe("116.203.0.1");
    expect(result.infrastructure.sshUser).toBe("deploy");
    expect(result.infrastructure.lastDeployedAt).toBeNull();

    // Verify it's persisted in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.infrastructure).not.toBeNull();
    expect(state.infrastructure!.serverIp).toBe("116.203.0.1");
  });

  it("phase gate: deployment phase only", () => {
    initProject(tmpDir);
    // phase is still onboarding
    const result = parse(handleRecordServer(validInput(tmpDir)));
    expect(result.error).toContain("deployment");
  });

  it("logs build event", () => {
    initProject(tmpDir);
    forcePhase(tmpDir, "deployment");
    handleRecordServer(validInput(tmpDir));

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    const infraEvents = state.buildHistory.filter(e => e.action === "infrastructure_set");
    expect(infraEvents.length).toBeGreaterThan(0);
    expect(infraEvents[0].details).toContain("test-app-prod");
  });

  it("stores optional fields (domain, ipv6, firewallId)", () => {
    initProject(tmpDir);
    forcePhase(tmpDir, "deployment");
    const result = parse(handleRecordServer({
      ...validInput(tmpDir),
      serverIpv6: "2a01:4f8::1",
      domain: "example.com",
    }));
    expect(result.infrastructure.serverIpv6).toBe("2a01:4f8::1");
    expect(result.infrastructure.domain).toBe("example.com");
    expect(result.infrastructure.firewallId).toBe("99999");
  });

  it("returns error for non-existent project", () => {
    const result = parse(handleRecordServer(validInput("/nonexistent/path")));
    expect(result.error).toBeTruthy();
  });
});
