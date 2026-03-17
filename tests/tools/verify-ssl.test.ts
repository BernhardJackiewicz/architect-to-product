import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleVerifySsl } from "../../src/tools/verify-ssl.js";
import {
  makeTmpDir, cleanTmpDir, parse, forcePhase, initWithStateManager,
} from "../helpers/setup.js";
import { StateManager } from "../../src/state/state-manager.js";

describe("a2p_verify_ssl", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir("a2p-ssl"); });
  afterEach(() => { cleanTmpDir(dir); });

  function makeInput(overrides: Partial<Parameters<typeof handleVerifySsl>[0]> = {}) {
    return {
      projectPath: dir,
      domain: "example.com",
      method: "caddy-auto" as const,
      issuer: "Let's Encrypt",
      autoRenewal: true,
      httpsRedirect: true,
      hstsPresent: true,
      ...overrides,
    };
  }

  it("rejects outside deployment phase", () => {
    initWithStateManager(dir);
    forcePhase(dir, "building");
    const result = parse(handleVerifySsl(makeInput()));
    expect(result.error).toContain("deployment");
  });

  it("happy path: caddy-auto sets sslVerifiedAt + sslVerification", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    const result = parse(handleVerifySsl(makeInput()));
    expect(result.success).toBe(true);
    expect(result.verification.domain).toBe("example.com");
    expect(result.verification.method).toBe("caddy-auto");
    expect(result.verification.issuer).toBe("Let's Encrypt");
    expect(result.verification.autoRenewal).toBe(true);
    expect(result.renewalNote).toContain("Caddy");

    // Verify state was updated
    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.sslVerifiedAt).toBeTruthy();
    expect(state.sslVerification).toBeTruthy();
    expect(state.sslVerification!.domain).toBe("example.com");
  });

  it("happy path: paas-auto works with PaaS method", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    const result = parse(handleVerifySsl(makeInput({
      method: "paas-auto",
      issuer: "Vercel",
    })));
    expect(result.success).toBe(true);
    expect(result.verification.method).toBe("paas-auto");
    expect(result.verification.issuer).toBe("Vercel");
    expect(result.renewalNote).toContain("PaaS");
  });

  it("idempotent: second call overwrites", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    handleVerifySsl(makeInput({ domain: "old.com" }));
    handleVerifySsl(makeInput({ domain: "new.com" }));

    const sm = new StateManager(dir);
    const state = sm.read();
    expect(state.sslVerification!.domain).toBe("new.com");
  });

  it("logs ssl_verification event in buildHistory", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    handleVerifySsl(makeInput());

    const sm = new StateManager(dir);
    const state = sm.read();
    const sslEvents = state.buildHistory.filter(e => e.action === "ssl_verification");
    expect(sslEvents.length).toBeGreaterThanOrEqual(1);
    expect(sslEvents[0].details).toContain("example.com");
  });

  it("warns when domain mismatches infrastructure", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "deployment");
    sm.setInfrastructure({
      provider: "hetzner", serverId: "1", serverName: "test", serverIp: "1.2.3.4",
      serverType: "cx22", location: "nbg1", sshUser: "deploy",
      sshKeyFingerprint: "abc", domain: "infra.com", provisionedAt: new Date().toISOString(),
      lastDeployedAt: null,
    });
    const result = parse(handleVerifySsl(makeInput({ domain: "other.com" })));
    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings[0]).toContain("mismatch");
  });

  it("includes expiresAt when provided", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    const result = parse(handleVerifySsl(makeInput({ expiresAt: "2026-06-18T00:00:00Z" })));
    expect(result.verification.expiresAt).toBe("2026-06-18T00:00:00Z");
  });
});
