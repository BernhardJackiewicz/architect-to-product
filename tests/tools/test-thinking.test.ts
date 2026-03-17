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

// ─── Build-slice prompt: RED review step ─────────────────────────────────────

describe("Build-slice prompt has RED review step", () => {
  it("has RED Refinement section before GREEN", () => {
    const redReviewPos = BUILD_SLICE_PROMPT.indexOf("RED Refinement");
    const greenPos = BUILD_SLICE_PROMPT.indexOf("### Phase GREEN");
    expect(redReviewPos).toBeGreaterThan(-1);
    expect(redReviewPos).toBeLessThan(greenPos);
  });

  it("RED review checks AC coverage", () => {
    const section = BUILD_SLICE_PROMPT.slice(
      BUILD_SLICE_PROMPT.indexOf("RED Refinement"),
      BUILD_SLICE_PROMPT.indexOf("### Phase GREEN"),
    );
    expect(section).toContain("acceptance criterion");
    expect(section).toContain("error case");
    expect(section).toContain("Mock");
  });
});
