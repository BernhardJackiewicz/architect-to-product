import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StateManager } from "../../src/state/state-manager.js";
import {
  makeTmpDir, cleanTmpDir, forcePhase, initWithStateManager, forceField,
} from "../helpers/setup.js";

describe("SSL Gate Enforcement", () => {
  let dir: string;

  beforeEach(() => { dir = makeTmpDir("a2p-ssl-gate"); });
  afterEach(() => { cleanTmpDir(dir); });

  it("deployment→complete blocked without sslVerifiedAt", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    const sm = new StateManager(dir);
    expect(() => sm.setPhase("complete")).toThrow("SSL/HTTPS verification");
  });

  it("deployment→complete allowed with sslVerifiedAt", () => {
    initWithStateManager(dir);
    forcePhase(dir, "deployment");
    forceField(dir, "sslVerifiedAt", new Date().toISOString());
    const sm = new StateManager(dir);
    const state = sm.setPhase("complete");
    expect(state.phase).toBe("complete");
  });

  it("completeProductPhase (last phase) blocked without SSL", () => {
    const sm = initWithStateManager(dir);
    // Set up phases
    const state = sm.read();
    state.architecture!.phases = [
      { id: "phase-0", name: "MVP", description: "test", deliverables: [], timeline: "now" },
    ];
    // Mark all slices for this phase
    for (const s of state.slices) {
      s.productPhaseId = "phase-0";
    }
    state.phase = "deployment";
    state.currentProductPhase = 0;
    const statePath = require("node:path").join(dir, ".a2p", "state.json");
    require("node:fs").writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

    // Walk slices to done
    const sm2 = new StateManager(dir);
    const s2 = sm2.read();
    for (const sl of s2.slices) {
      sl.status = "done";
    }
    require("node:fs").writeFileSync(statePath, JSON.stringify(s2, null, 2), "utf-8");

    const sm3 = new StateManager(dir);
    expect(() => sm3.completeProductPhase()).toThrow("SSL/HTTPS verification");
  });

  it("completeProductPhase (not last phase) allowed without SSL", () => {
    const sm = initWithStateManager(dir);
    const state = sm.read();
    state.architecture!.phases = [
      { id: "phase-0", name: "MVP", description: "test", deliverables: [], timeline: "now" },
      { id: "phase-1", name: "Phase 2", description: "test", deliverables: [], timeline: "later" },
    ];
    for (const s of state.slices) {
      s.productPhaseId = "phase-0";
      s.status = "done";
    }
    state.phase = "deployment";
    state.currentProductPhase = 0;
    const statePath = require("node:path").join(dir, ".a2p", "state.json");
    require("node:fs").writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");

    const sm2 = new StateManager(dir);
    // Should not throw — it's not the last phase
    const result = sm2.completeProductPhase();
    expect(result.phase).toBe("planning");
  });

  it("SSL invalidated when infrastructure domain changes", () => {
    const sm = initWithStateManager(dir);
    forcePhase(dir, "deployment");
    sm.setInfrastructure({
      provider: "hetzner", serverId: "1", serverName: "test", serverIp: "1.2.3.4",
      serverType: "cx22", location: "nbg1", sshUser: "deploy",
      sshKeyFingerprint: "abc", domain: "old.com", provisionedAt: new Date().toISOString(),
      lastDeployedAt: null,
    });
    sm.setSslVerification({
      domain: "old.com", verifiedAt: new Date().toISOString(),
      method: "caddy-auto", issuer: "Let's Encrypt",
      expiresAt: null, autoRenewal: true, httpsRedirect: true, hstsPresent: true,
    });

    // Change domain
    sm.setInfrastructure({
      provider: "hetzner", serverId: "1", serverName: "test", serverIp: "1.2.3.4",
      serverType: "cx22", location: "nbg1", sshUser: "deploy",
      sshKeyFingerprint: "abc", domain: "new.com", provisionedAt: new Date().toISOString(),
      lastDeployedAt: null,
    });

    const state = sm.read();
    expect(state.sslVerifiedAt).toBeNull();
    expect(state.sslVerification).toBeNull();
  });
});
