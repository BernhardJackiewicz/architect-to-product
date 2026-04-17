import { describe, it, expect } from "vitest";
import { PLANNING_PROMPT } from "../../src/prompts/planning.js";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import { SYSTEMS_CONCERN_IDS } from "../../src/state/types.js";

/**
 * A2P v2 prompt-content tests — first-of-its-kind in this repo.
 *
 * Prompts are not pure data; they drive agent behavior. These assertions
 * target stable, canonical strings (concern IDs sourced from
 * SYSTEMS_CONCERN_IDS) so they catch accidental deletion of the v2 content
 * without being brittle to English-prose edits.
 *
 * Rule of thumb when adding assertions here: assert on identifiers that
 * already appear in the source of truth (enums, constants). If the canonical
 * string changes, TypeScript will force a correlated edit.
 */

describe("A2P v2 prompt content — systems engineering sections", () => {
  it("build-slice prompt mentions all 13 canonical concern IDs", () => {
    for (const concern of SYSTEMS_CONCERN_IDS) {
      expect(BUILD_SLICE_PROMPT).toContain(concern);
    }
  });

  it("build-slice prompt cross-references the Security-Surface Checklist", () => {
    expect(BUILD_SLICE_PROMPT).toMatch(/Security-Surface Checklist/);
    expect(BUILD_SLICE_PROMPT).toMatch(/subsumed by the `security` and `data_model`/);
  });

  it("build-slice prompt cross-references Structured Logging as observability HOW-TO", () => {
    expect(BUILD_SLICE_PROMPT).toMatch(/Structured Logging/);
    expect(BUILD_SLICE_PROMPT).toMatch(/observability.*HOW|HOW.*observability/);
  });

  it("build-slice prompt specifies the anti-gaming rule (linkedAcIds required)", () => {
    expect(BUILD_SLICE_PROMPT).toMatch(/linkedAcIds/);
    expect(BUILD_SLICE_PROMPT).toMatch(/anti-gaming/i);
  });

  it("build-slice prompt points at the applicability utility file", () => {
    expect(BUILD_SLICE_PROMPT).toContain("src/utils/systems-applicability.ts");
  });

  it("planning prompt introduces systemsClassification as an optional slice field", () => {
    expect(PLANNING_PROMPT).toContain("systemsClassification");
  });

  it("planning prompt mentions all 13 canonical concern IDs", () => {
    for (const concern of SYSTEMS_CONCERN_IDS) {
      expect(PLANNING_PROMPT).toContain(concern);
    }
  });

  it("planning prompt clarifies resolution happens during hardening, not planning", () => {
    expect(PLANNING_PROMPT).toMatch(/NOT resolve concerns during planning/);
    expect(PLANNING_PROMPT).toMatch(/a2p_harden_requirements/);
  });
});
