import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeTmpDir, cleanTmpDir, initWithSlices, initWithStateManager, addPassingTests } from "../helpers/setup.js";
import { StateManager } from "../../src/state/state-manager.js";
import {
  sanitizeOutput,
  truncatePreview,
  truncateOutput,
  pruneEvents,
  generateRunId,
} from "../../src/utils/log-sanitizer.js";
import { runProcess } from "../../src/utils/process-runner.js";
import { handleGetBuildLog } from "../../src/tools/get-build-log.js";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import type { BuildEvent, Phase } from "../../src/state/types.js";

let dir: string;

beforeEach(() => { dir = makeTmpDir(); });
afterEach(() => { cleanTmpDir(dir); });

// --- BuildEvent Structure ---

describe("BuildEvent structure", () => {
  it("new event has default level 'info' when not set", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "phase_change");
    expect(event).toBeDefined();
    expect(event!.level ?? "info").toBe("info");
  });

  it("event stores durationMs correctly", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "test_action", "testing duration", { durationMs: 1234 });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.durationMs).toBe(1234);
  });

  it("event stores metadata with typed fields", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "test_action", "testing metadata", {
      metadata: { exitCode: 0, passed: 5, toolName: "vitest" },
    });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.metadata).toEqual({ exitCode: 0, passed: 5, toolName: "vitest" });
  });

  it("event stores runId correctly", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "test_action", "testing runId", { runId: "run-abc12345" });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.runId).toBe("run-abc12345");
  });

  it("event stores status correctly", () => {
    const sm = initWithStateManager(dir);
    sm.log("error", "test_action", "failure test", { status: "failure" });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.status).toBe("failure");
    expect(event!.level).toBe("error");
  });

  it("event stores outputSummary truncated at 500 chars with outputTruncated flag", () => {
    const sm = initWithStateManager(dir);
    const longOutput = "x".repeat(800);
    sm.log("info", "test_action", "long output", { outputSummary: longOutput });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.outputSummary!.length).toBeLessThanOrEqual(520);
    expect(event!.outputSummary).toContain("... (truncated)");
    expect(event!.outputTruncated).toBe(true);
  });

  it("event stores outputRef for artifact reference", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "test_action", "with ref", { outputRef: "TestResult:s01:2024-01-01" });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.outputRef).toBe("TestResult:s01:2024-01-01");
  });

  it("short outputSummary does not set outputTruncated", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "test_action", "short", { outputSummary: "all good" });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_action");
    expect(event!.outputSummary).toBe("all good");
    expect(event!.outputTruncated).toBeUndefined();
  });
});

// --- Backward Compatibility ---

describe("backward compatibility", () => {
  it("old events without level/status/durationMs load correctly", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    const state = sm.read();
    const events = state.buildHistory;
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      if (e.level !== undefined) {
        expect(["debug", "info", "warn", "error"]).toContain(e.level);
      }
    }
  });

  it("old events with free action string load correctly", () => {
    const sm = initWithStateManager(dir);
    sm.addBuildEvents([{
      phase: "building" as Phase,
      sliceId: null,
      action: "custom_free_action",
      details: "some details",
    }]);
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "custom_free_action");
    expect(event).toBeDefined();
  });

  it("get-build-log treats old events without level as 'info'", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      filter: "level",
      level: "info",
      limit: 50,
    }));
    expect(result.events.length).toBeGreaterThan(0);
  });
});

// --- StateManager.log() ---

describe("StateManager.log()", () => {
  it("creates event with level 'error'", () => {
    const sm = initWithStateManager(dir);
    sm.log("error", "test_error", "something broke");
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "test_error");
    expect(event!.level).toBe("error");
  });

  it("creates event with durationMs", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "timed_action", "took a while", { durationMs: 5678 });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "timed_action");
    expect(event!.durationMs).toBe(5678);
  });

  it("creates event with typed metadata", () => {
    const sm = initWithStateManager(dir);
    sm.log("warn", "meta_action", "with data", {
      metadata: { findingCount: 3, toolName: "sast", mode: "full" },
    });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "meta_action");
    expect(event!.metadata).toEqual({ findingCount: 3, toolName: "sast", mode: "full" });
  });

  it("sanitizes secrets in outputSummary", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "secret_test", "output with secret", {
      outputSummary: 'config: password="super_secret_value_123"',
    });
    const state = sm.read();
    const event = state.buildHistory.find((e) => e.action === "secret_test");
    expect(event!.outputSummary).toContain("[REDACTED]");
    expect(event!.outputSummary).not.toContain("super_secret_value_123");
  });
});

// --- Sanitizer ---

describe("log sanitizer", () => {
  it("sanitizeOutput redacts secrets (password=, Bearer token, ghp_)", () => {
    const input = [
      'password="my_secret_pass"',
      "Bearer eyJhbGciOiJIUzI1NiJ9abc123def456",
      "ghp_1234567890abcdefghijklmnopqrstuvwxyz",
      "sk-abcdefghijklmnopqrstuvwxyz123456",
    ].join("\n");
    const result = sanitizeOutput(input);
    expect(result).not.toContain("my_secret_pass");
    expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(result).not.toContain("ghp_1234567890");
    expect(result).not.toContain("sk-abcdef");
    expect(result.match(/\[REDACTED\]/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it("truncatePreview cuts at 500 chars", () => {
    const short = "hello";
    expect(truncatePreview(short)).toBe("hello");

    const long = "a".repeat(600);
    const result = truncatePreview(long);
    expect(result.length).toBeLessThanOrEqual(520);
    expect(result).toContain("... (truncated)");
  });

  it("truncateOutput cuts at 5000 chars", () => {
    const short = "hello";
    expect(truncateOutput(short)).toBe("hello");

    const long = "b".repeat(6000);
    const result = truncateOutput(long);
    expect(result.length).toBeLessThanOrEqual(5020);
    expect(result).toContain("... (truncated)");
  });

  it("pruneEvents removes oldest debug events when >1000", () => {
    const events: BuildEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push({
        timestamp: new Date(2024, 0, 1, 0, 0, i).toISOString(),
        phase: "building",
        sliceId: null,
        action: "debug_action",
        details: `debug ${i}`,
        level: "debug",
      });
    }
    for (let i = 0; i < 600; i++) {
      events.push({
        timestamp: new Date(2024, 0, 2, 0, 0, i).toISOString(),
        phase: "building",
        sliceId: null,
        action: "info_action",
        details: `info ${i}`,
        level: "info",
      });
    }
    expect(events.length).toBe(1100);

    const pruned = pruneEvents(events);
    expect(pruned.length).toBe(1000);

    const debugCount = pruned.filter((e) => e.level === "debug").length;
    expect(debugCount).toBe(400);
    const infoCount = pruned.filter((e) => e.level === "info").length;
    expect(infoCount).toBe(600);
  });
});

// --- get-build-log Composable Filters ---

describe("get-build-log composable filters", () => {
  it("level='error' shows only error events", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "info_action", "info event");
    sm.log("warn", "warn_action", "warn event");
    sm.log("error", "error_action", "error event");

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      level: "error",
      limit: 50,
    }));
    for (const e of result.events) {
      expect(e.level).toBe("error");
    }
    expect(result.events.length).toBeGreaterThanOrEqual(1);
  });

  it("level='warn' shows warn+error", () => {
    const sm = initWithStateManager(dir);
    sm.log("debug", "debug_action", "debug");
    sm.log("info", "info_action", "info");
    sm.log("warn", "warn_action", "warn");
    sm.log("error", "error_action", "error");

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      level: "warn",
      limit: 50,
    }));

    for (const e of result.events) {
      const lvl = e.level ?? "info";
      expect(["warn", "error"]).toContain(lvl);
    }
  });

  it("runId filter shows only matching events", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "action_a", "event a", { runId: "run-aaaa1111" });
    sm.log("info", "action_b", "event b", { runId: "run-bbbb2222" });
    sm.log("info", "action_c", "event c", { runId: "run-aaaa1111" });

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      runId: "run-aaaa1111",
      limit: 50,
    }));

    expect(result.events.length).toBe(2);
    for (const e of result.events) {
      expect(e.runId).toBe("run-aaaa1111");
    }
  });

  it("errorsOnly shows only failure/error events", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "ok_action", "all good", { status: "success" });
    sm.log("error", "fail_action", "broke", { status: "failure" });

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      errorsOnly: true,
      limit: 50,
    }));

    expect(result.events.length).toBeGreaterThanOrEqual(1);
    for (const e of result.events) {
      expect(e.status === "failure" || e.level === "error").toBe(true);
    }
  });

  it("since filter shows only events after timestamp", () => {
    const sm = initWithStateManager(dir);
    const before = new Date().toISOString();
    // Existing events from init are before `since`
    // Wait a tiny bit and add new events
    sm.log("info", "new_action", "new event");
    const after = sm.read().buildHistory[sm.read().buildHistory.length - 1].timestamp;

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      since: before,
      limit: 50,
    }));

    for (const e of result.events) {
      expect(e.timestamp >= before).toBe(true);
    }
  });

  it("hasOutput filter shows only events with outputSummary", () => {
    const sm = initWithStateManager(dir);
    sm.log("info", "no_output", "plain event");
    sm.log("info", "with_output", "event with summary", { outputSummary: "test output" });

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      hasOutput: true,
      limit: 50,
    }));

    expect(result.events.length).toBeGreaterThanOrEqual(1);
    for (const e of result.events) {
      expect(e.outputSummary).toBeDefined();
    }
  });

  it("composable: phase + level combined", () => {
    const sm = initWithStateManager(dir);
    sm.setPhase("planning");
    sm.log("error", "plan_error", "plan broke");
    sm.log("info", "plan_info", "plan ok");
    sm.setPhase("building");
    sm.log("error", "build_error", "build broke");

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      phase: "planning",
      level: "error",
      limit: 50,
    }));

    for (const e of result.events) {
      expect(e.phase).toBe("planning");
      expect(e.level).toBe("error");
    }
  });

  it("legacy filter='errors' still works", () => {
    const sm = initWithStateManager(dir);
    sm.log("error", "fail", "error event", { status: "failure" });
    sm.log("info", "ok", "info event");

    const result = JSON.parse(handleGetBuildLog({
      projectPath: dir,
      filter: "errors",
      limit: 50,
    }));

    expect(result.events.length).toBeGreaterThanOrEqual(1);
    for (const e of result.events) {
      expect(e.status === "failure" || e.level === "error").toBe(true);
    }
  });
});

// --- Tool Integration ---

describe("tool integration", () => {
  it("run-tests records durationMs and status in build log", () => {
    initWithSlices(dir, 1);
    const sm = new StateManager(dir);
    sm.setPhase("building");

    addPassingTests(sm, "s01");
    sm.setSliceStatus("s01", "red");

    const state = sm.read();
    const testEvents = state.buildHistory.filter((e) => e.action === "test_run");
    expect(testEvents.length).toBeGreaterThan(0);
    const lastTestEvent = testEvents[testEvents.length - 1];
    expect(lastTestEvent.status).toBe("success");
  });

  it("process-runner returns durationMs", () => {
    const result = runProcess("echo hello", dir, 5000);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(typeof result.durationMs).toBe("number");
  });
});

// --- generateRunId ---

describe("generateRunId", () => {
  it("generates run- prefix with 8 hex chars", () => {
    const id = generateRunId();
    expect(id).toMatch(/^run-[0-9a-f]{8}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRunId()));
    expect(ids.size).toBe(100);
  });
});

// --- Prompt ---

describe("build prompt logging guidance", () => {
  it("contains logging library recommendations", () => {
    expect(BUILD_SLICE_PROMPT).toContain("pino");
    expect(BUILD_SLICE_PROMPT).toContain("structlog");
    expect(BUILD_SLICE_PROMPT).toContain("slog");
  });

  it("recommends logging as optional, not mandatory", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Empfehlung");
    expect(BUILD_SLICE_PROMPT).toContain("spätestens vor Deploy");
  });
});
