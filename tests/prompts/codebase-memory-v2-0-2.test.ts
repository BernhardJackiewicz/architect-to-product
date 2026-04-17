/**
 * A2P v2.0.2 — regression guard for codebase-memory enforcement in
 * prompt surface.
 *
 * The prompts are the bridge between the main Claude and everything it
 * does — including whether it spawns the built-in Explore subagent
 * (which falls back to bash grep) or calls codebase-memory tools
 * directly. v2.0.2 flipped these references from conditional
 * ("if codebase-memory available") to mandatory ("use it"). This test
 * exists to make sure future prompt edits don't silently revert that.
 */
import { describe, it, expect } from "vitest";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import { PLANNING_PROMPT } from "../../src/prompts/planning.js";
import { REFACTOR_PROMPT } from "../../src/prompts/refactor.js";
import { SECURITY_GATE_PROMPT } from "../../src/prompts/security-gate.js";
import { ONBOARDING_PROMPT } from "../../src/prompts/onboarding.js";

describe("A2P v2.0.2 codebase-memory prompt enforcement", () => {
  const prompts: Array<[string, string]> = [
    ["build-slice", BUILD_SLICE_PROMPT],
    ["planning", PLANNING_PROMPT],
    ["refactor", REFACTOR_PROMPT],
    ["security-gate", SECURITY_GATE_PROMPT],
  ];

  for (const [name, body] of prompts) {
    it(`${name} prompt uses the mcp__codebase-memory__ call convention`, () => {
      expect(body).toMatch(/mcp__codebase-memory__(search_graph|search_code|trace_call_path|index_repository|list_projects)/);
    });

    it(`${name} prompt contains NO legacy conditional "companionReadiness.codebaseMemory" gate`, () => {
      expect(body).not.toContain("companionReadiness.codebaseMemory");
    });
  }

  it("build-slice prompt forbids spawning Explore for identifier/call-site lookups", () => {
    expect(BUILD_SLICE_PROMPT).toMatch(/Do NOT spawn the Explore subagent/);
  });

  it("planning prompt forbids spawning Explore for code reconnaissance", () => {
    expect(PLANNING_PROMPT).toMatch(/Do NOT spawn the Explore subagent/);
  });

  it("refactor prompt forbids spawning Explore for dead-code/coupling analysis", () => {
    expect(REFACTOR_PROMPT).toMatch(/Do NOT spawn the Explore subagent/);
  });

  it("security-gate prompt forbids spawning Explore for security reconnaissance", () => {
    // Prompt body may line-wrap between "Explore" and "subagent" — accept
    // any whitespace between the two so the test isn't brittle to format.
    expect(SECURITY_GATE_PROMPT).toMatch(/do NOT spawn the Explore\s+subagent/i);
  });

  it("onboarding prompt declares codebase-memory as REQUIRED (v2.0.2 gate)", () => {
    expect(ONBOARDING_PROMPT).toMatch(/codebase-memory-mcp is REQUIRED/);
    expect(ONBOARDING_PROMPT).toMatch(/v2\.0\.2/);
    // The gate error handle reference must be present — lets a user chasing
    // the error find the docs fast.
    expect(ONBOARDING_PROMPT).toMatch(/requireCodebaseMemoryRegistered|bypassCodebaseMemory/);
  });

  it("build-slice prompt instructs verify_codebase_memory_index for fresh index", () => {
    expect(BUILD_SLICE_PROMPT).toContain("a2p_verify_codebase_memory_index");
  });
});
