import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleGetChecklist } from "../../src/tools/get-checklist.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-deploy-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

function initWithArch(
  dir: string,
  overrides: Record<string, unknown> = {}
) {
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

describe("handleGenerateDeployment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Python stack -> Python-specific recommendations", () => {
    initWithArch(tmpDir, { language: "Python" });
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("python");
  });

  it("TypeScript stack -> Node-specific recommendations", () => {
    initWithArch(tmpDir, { language: "TypeScript", framework: "Express" });
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("node");
  });

  it("SQLite -> WAL recommendation", () => {
    initWithArch(tmpDir, { database: "SQLite" });
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("WAL");
  });

  it("Hetzner -> Hetzner recommendation", () => {
    initWithArch(tmpDir, { hosting: "Hetzner" });
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("Hetzner");
  });

  it("Frontend -> static assets recommendation", () => {
    initWithArch(tmpDir, { frontend: "React" });
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("static");
  });

  it("returns error without architecture", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    // No set-architecture
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    expect(result.error).toContain("architecture");
  });
});

describe("handleGetChecklist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("SQLite -> WAL-related items in checklist", () => {
    initWithArch(tmpDir, { database: "SQLite" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.postDeployment,
    ];
    expect(allItems.some((i: any) => i.item.includes("WAL"))).toBe(true);
  });

  it("Stripe -> Stripe-specific items", () => {
    initWithArch(tmpDir, { otherTech: ["Stripe"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment;
    expect(preItems.some((i: any) => i.item.includes("Stripe"))).toBe(true);
  });

  it("Firebase -> Firebase-specific items", () => {
    initWithArch(tmpDir, { otherTech: ["Firebase Auth"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment;
    expect(preItems.some((i: any) => i.item.includes("Firebase"))).toBe(true);
  });

  it("base items always present with minimum counts", () => {
    initWithArch(tmpDir);
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    expect(result.checklist.preDeployment.length).toBeGreaterThanOrEqual(8);
    expect(result.checklist.infrastructure.length).toBeGreaterThanOrEqual(6);
    expect(result.checklist.postDeployment.length).toBeGreaterThanOrEqual(8);
  });

  it("done flags correct when all slices completed and 0 findings", () => {
    initWithArch(tmpDir);
    handleCreateBuildPlan({
      projectPath: tmpDir,
      slices: [
        {
          id: "s01",
          name: "X",
          description: "X",
          acceptanceCriteria: ["x"],
          testStrategy: "x",
          dependencies: [],
        },
      ],
    });

    // Complete the slice through TDD cycle
    const sm = new StateManager(tmpDir);
    sm.setSliceStatus("s01", "red");
    sm.setSliceStatus("s01", "green");
    sm.setSliceStatus("s01", "refactor");
    sm.setSliceStatus("s01", "sast");
    sm.setSliceStatus("s01", "done");

    const result = parse(handleGetChecklist({ projectPath: tmpDir }));

    // "All slices completed" should be done=true
    const slicesDone = result.checklist.preDeployment.find(
      (i: any) => i.item === "All slices completed"
    );
    expect(slicesDone.done).toBe(true);

    // "No open CRITICAL/HIGH SAST findings" should be done=true (0 findings)
    const noFindings = result.checklist.preDeployment.find(
      (i: any) => i.item.includes("SAST")
    );
    expect(noFindings.done).toBe(true);
  });

  it("returns error without project", () => {
    const otherDir = makeTmpDir();
    const result = parse(handleGetChecklist({ projectPath: otherDir }));
    expect(result.error).toBeTruthy();
    rmSync(otherDir, { recursive: true, force: true });
  });
});
