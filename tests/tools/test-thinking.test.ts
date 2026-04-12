import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createBuildPlanSchema } from "../../src/tools/create-build-plan.js";
import { addSliceSchema } from "../../src/tools/add-slice.js";
import { handleAddSlice } from "../../src/tools/add-slice.js";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import { PLANNING_PROMPT } from "../../src/prompts/planning.js";
import { makeTmpDir, cleanTmpDir, parse, initWithSlices } from "../helpers/setup.js";

// ─── Schema gates: acceptance criteria and test strategy ─────────────────────

describe("Schema: acceptanceCriteria requires min 1", () => {
  it("rejects empty acceptanceCriteria in create-build-plan", () => {
    const result = createBuildPlanSchema.safeParse({
      projectPath: "/tmp/test",
      slices: [{
        id: "s1",
        name: "Test",
        description: "Test",
        acceptanceCriteria: [],
        testStrategy: "unit tests",
        dependencies: [],
      }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts 1 acceptance criterion in create-build-plan", () => {
    const result = createBuildPlanSchema.safeParse({
      projectPath: "/tmp/test",
      slices: [{
        id: "s1",
        name: "Test",
        description: "Test",
        acceptanceCriteria: ["it works"],
        testStrategy: "unit tests",
        dependencies: [],
      }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty acceptanceCriteria in add-slice", () => {
    const result = addSliceSchema.safeParse({
      projectPath: "/tmp/test",
      slice: {
        id: "s1",
        name: "Test",
        description: "Test",
        acceptanceCriteria: [],
        testStrategy: "unit tests",
        dependencies: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty testStrategy in create-build-plan", () => {
    const result = createBuildPlanSchema.safeParse({
      projectPath: "/tmp/test",
      slices: [{
        id: "s1",
        name: "Test",
        description: "Test",
        acceptanceCriteria: ["it works"],
        testStrategy: "",
        dependencies: [],
      }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty testStrategy in add-slice", () => {
    const result = addSliceSchema.safeParse({
      projectPath: "/tmp/test",
      slice: {
        id: "s1",
        name: "Test",
        description: "Test",
        acceptanceCriteria: ["it works"],
        testStrategy: "",
        dependencies: [],
      },
    });
    expect(result.success).toBe(false);
  });
});

// ─── add-slice response includes testHint ────────────────────────────────────

describe("add-slice response includes testHint", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir("a2p-testhint");
    initWithSlices(dir, 2);
  });
  afterEach(() => { cleanTmpDir(dir); });

  it("append includes testHint", () => {
    const result = parse(handleAddSlice({
      projectPath: dir,
      slice: {
        id: "s99",
        name: "New slice",
        description: "Test",
        acceptanceCriteria: ["works"],
        testStrategy: "unit",
        dependencies: [],
      },
    }));
    expect(result.success).toBe(true);
    expect(result.testHint).toContain("happy-path");
  });

  it("insert includes testHint", () => {
    const result = parse(handleAddSlice({
      projectPath: dir,
      slice: {
        id: "s99",
        name: "New slice",
        description: "Test",
        acceptanceCriteria: ["works"],
        testStrategy: "unit",
        dependencies: [],
      },
      insertAfterSliceId: "s01",
    }));
    expect(result.success).toBe(true);
    expect(result.testHint).toContain("happy-path");
  });
});

// ─── Planning prompt: test-thinking structure ────────────────────────────────

describe("Planning prompt requires structured test thinking", () => {
  it("mentions happy-path test in slice requirements", () => {
    expect(PLANNING_PROMPT).toContain("happy path test");
  });

  it("mentions error cases in slice requirements", () => {
    expect(PLANNING_PROMPT).toContain("error cases");
  });

  it("mentions real service tests for integration/UI slices", () => {
    expect(PLANNING_PROMPT).toMatch(/integration.*real/i);
  });

  it("mentions done-criteria in test strategy", () => {
    expect(PLANNING_PROMPT).toContain("Done metric");
  });
});

// ─── Build-slice prompt: test-hardening + test-first guard ─────────────────
//
// The old "RED Refinement" block has been replaced by the Native Slice Flow's
// TEST HARDENING step + the a2p_verify_test_first guard tool, which together
// enforce AC-to-test mapping and test-first discipline in code.

describe("Build-slice prompt enforces test hardening + test-first guard", () => {
  it("has a TEST HARDENING step before RED in the native flow", () => {
    const testHardeningPos = BUILD_SLICE_PROMPT.indexOf("TEST HARDENING");
    const redPos = BUILD_SLICE_PROMPT.indexOf("RED");
    expect(testHardeningPos).toBeGreaterThan(-1);
    expect(testHardeningPos).toBeLessThan(redPos);
  });

  it("test hardening section references AC mapping and negative/edge/regression cases", () => {
    const testHardeningPos = BUILD_SLICE_PROMPT.indexOf("TEST HARDENING");
    const planPos = BUILD_SLICE_PROMPT.indexOf("PLAN HARDENING");
    const section = BUILD_SLICE_PROMPT.slice(testHardeningPos, planPos);
    expect(section).toMatch(/AC|acceptance criteri/i);
    expect(section).toMatch(/negative/i);
    expect(section).toMatch(/edge/i);
  });

  it("references a2p_verify_test_first as the enforced test-first guard", () => {
    expect(BUILD_SLICE_PROMPT).toContain("a2p_verify_test_first");
    expect(BUILD_SLICE_PROMPT).toMatch(/test file/i);
    expect(BUILD_SLICE_PROMPT).toMatch(/production file/i);
  });
});
