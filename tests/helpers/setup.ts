import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StateManager } from "../../src/state/state-manager.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";

/** Create a temporary directory for test isolation. */
export function makeTmpDir(prefix = "a2p-test"): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

/** Remove a temporary directory. */
export function cleanTmpDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** Shorthand for JSON.parse. */
export function parse(json: string): any {
  return JSON.parse(json);
}

/** Initialize a project with a basic architecture (no slices). */
export function initWithArch(dir: string, opts?: { language?: string; framework?: string }): void {
  handleInitProject({ projectPath: dir, projectName: "test" });
  handleSetArchitecture({
    projectPath: dir,
    name: "Test",
    description: "Test",
    language: opts?.language ?? "TypeScript",
    framework: opts?.framework ?? "Express",
    features: ["CRUD"],
    dataModel: "items",
    apiDesign: "REST",
  });
}

/** Initialize a project with architecture + slices. */
export function initWithSlices(
  dir: string,
  sliceCount = 2,
  opts?: { language?: string; framework?: string; testStrategy?: string },
): void {
  initWithArch(dir, opts);
  handleCreateBuildPlan({
    projectPath: dir,
    slices: Array.from({ length: sliceCount }, (_, i) => ({
      id: `s0${i + 1}`,
      name: i === 0 ? "Setup" : `Slice ${i + 1}`,
      description: i === 0 ? "Setup" : `Slice ${i + 1}`,
      acceptanceCriteria: ["works"],
      testStrategy: opts?.testStrategy ?? "unit",
      dependencies: i > 0 ? [`s0${i}`] : [],
    })),
  });
}

/** Initialize via StateManager directly with typed architecture (for hardening tests). */
export function initWithStateManager(dir: string, sliceCount = 3): StateManager {
  const sm = new StateManager(dir);
  sm.init("test-project", dir);
  sm.setArchitecture({
    name: "Test",
    description: "Test project",
    techStack: { language: "TypeScript", framework: "Express", database: null, frontend: null, hosting: null, other: [] },
    features: ["f1"],
    dataModel: "none",
    apiDesign: "REST",
    raw: "",
  });

  const slices = Array.from({ length: sliceCount }, (_, i) => ({
    id: `s${i + 1}`,
    name: `Slice ${i + 1}`,
    description: `Test slice ${i + 1}`,
    acceptanceCriteria: [`AC${i + 1}`],
    testStrategy: "unit",
    dependencies: i > 0 ? [`s${i}`] : [],
    status: "pending" as const,
    files: [],
    testResults: [],
    sastFindings: [],
  }));

  sm.setSlices(slices);
  return sm;
}
