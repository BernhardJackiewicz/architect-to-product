import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handlePlanInfrastructure } from "../../src/tools/plan-infrastructure.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { makeTmpDir, cleanTmpDir, parse, forcePhase } from "../helpers/setup.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function initWithLang(dir: string, overrides: Record<string, unknown> = {}) {
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

function setDeployReady(dir: string): void {
  forcePhase(dir, "deployment");
  const statePath = join(dir, ".a2p", "state.json");
  const raw = JSON.parse(readFileSync(statePath, "utf-8"));
  raw.deployApprovalAt = new Date().toISOString();
  raw.deployApprovalStateHash = "test";
  writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
}

describe("handlePlanInfrastructure", () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir("a2p-infra"); });
  afterEach(() => { cleanTmpDir(tmpDir); });

  it("Java project -> cx32 (JVM overhead)", () => {
    initWithLang(tmpDir, { language: "Java", framework: "Spring Boot" });
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx32");
    expect(result.serverType.ram).toBe("8GB");
    expect(result.serverType.reasoning).toContain("JVM");
  });

  it("Kotlin project -> cx32 (JVM overhead)", () => {
    initWithLang(tmpDir, { language: "Kotlin", framework: "Ktor" });
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx32");
  });

  it("Node project -> cx22", () => {
    initWithLang(tmpDir, { language: "TypeScript", framework: "Express" });
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx22");
    expect(result.serverType.ram).toBe("4GB");
  });

  it("Python project -> cx22", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx22");
  });

  it("Go project -> cx22", () => {
    initWithLang(tmpDir, { language: "Go", framework: "Gin" });
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx22");
  });

  it("cloud-init contains docker, ufw, fail2ban, ssh hardening", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    const ci = result.cloudInitScript;
    expect(ci).toContain("docker-ce");
    expect(ci).toContain("ufw");
    expect(ci).toContain("fail2ban");
    expect(ci).toContain("PasswordAuthentication no");
    expect(ci).toContain("PermitRootLogin no");
    expect(ci).toContain("unattended-upgrades");
  });

  it("firewall rules include SSH, HTTP, HTTPS", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    const ports = result.firewallRules.map((r: any) => r.port);
    expect(ports).toContain("22");
    expect(ports).toContain("80");
    expect(ports).toContain("443");
  });

  it("provisioning commands reference $HETZNER_TOKEN (never hardcoded)", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    for (const step of result.provisioningSteps) {
      if (step.command.includes("hetzner.cloud")) {
        expect(step.command).toContain("$HETZNER_TOKEN");
      }
    }
  });

  it("phase gate: not callable outside deployment phase", () => {
    initWithLang(tmpDir);
    // phase is still onboarding
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.error).toContain("deployment");
  });

  it("phase gate: requires deployApprovalAt", () => {
    initWithLang(tmpDir);
    forcePhase(tmpDir, "deployment");
    // no deployApprovalAt set
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.error).toContain("Deploy approval");
  });

  it("multi-service stack (DB + Redis) -> cx32", () => {
    initWithLang(tmpDir, { language: "Python", framework: "FastAPI", database: "PostgreSQL", otherTech: ["Redis"] });
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverType.type).toBe("cx32");
  });

  it("returns serverName derived from projectName", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.serverName).toBe("test-app-prod");
  });

  it("returns security note about token handling", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.securityNote).toContain("Never persisted");
  });

  it("cloud-init contains daemon.json for Docker log rotation", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).toContain("daemon.json");
    expect(result.cloudInitScript).toContain("max-size");
  });

  it("cloud-init contains kernel hardening sysctl with tcp_syncookies", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).toContain("tcp_syncookies");
    expect(result.cloudInitScript).toContain("99-hardening.conf");
  });

  it("cloud-init does NOT disable ip_forward (Docker needs it)", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).not.toContain("ip_forward = 0");
  });

  it("cloud-init contains swap with 2G default", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).toContain("swapfile");
    expect(result.cloudInitScript).toContain("2G");
  });

  it("cloud-init contains logwatch in packages", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).toContain("logwatch");
  });

  it("cloud-init contains explicit auto-reboot disable", () => {
    initWithLang(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handlePlanInfrastructure({ projectPath: tmpDir, provider: "hetzner", location: "nbg1" }));
    expect(result.cloudInitScript).toContain('Automatic-Reboot "false"');
  });
});
