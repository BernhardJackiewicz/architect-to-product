import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { handleGenerateDeployment } from "../../src/tools/generate-deployment.js";
import { handleGetChecklist } from "../../src/tools/get-checklist.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleCreateBuildPlan } from "../../src/tools/create-build-plan.js";
import { StateManager } from "../../src/state/state-manager.js";
import { makeTmpDir, cleanTmpDir, parse, walkSliceToStatus, forcePhase } from "../helpers/setup.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function initWithArchOverrides(
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

/** Set up project in deployment phase with deploy approval for generate-deployment tests */
function setDeployReady(dir: string): void {
  forcePhase(dir, "deployment");
  const statePath = join(dir, ".a2p", "state.json");
  const raw = JSON.parse(readFileSync(statePath, "utf-8"));
  raw.deployApprovalAt = new Date().toISOString();
  raw.deployApprovalStateHash = "test";
  writeFileSync(statePath, JSON.stringify(raw, null, 2), "utf-8");
}

describe("handleGenerateDeployment", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-deploy");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("Python stack -> Python-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "Python" });
    setDeployReady(tmpDir);
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("python");
  });

  it("TypeScript stack -> Node-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "TypeScript", framework: "Express" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("node");
  });

  it("SQLite -> WAL recommendation", () => {
    initWithArchOverrides(tmpDir, { database: "SQLite" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("WAL");
  });

  it("Hetzner -> Hetzner recommendation", () => {
    initWithArchOverrides(tmpDir, { hosting: "Hetzner" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("Hetzner");
  });

  it("Frontend -> static assets recommendation", () => {
    initWithArchOverrides(tmpDir, { frontend: "React" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("static");
  });

  it("Go stack -> Go-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "Go", framework: "Gin" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("static");
  });

  it("Rust stack -> Rust-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "Rust", framework: "Actix" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("release");
  });

  it("Java stack -> Java-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "Java", framework: "Spring Boot" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("temurin");
  });

  it("Ruby stack -> Ruby-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "Ruby", framework: "Rails" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("puma");
  });

  it("PHP stack -> PHP-specific recommendations", () => {
    initWithArchOverrides(tmpDir, { language: "PHP", framework: "Laravel" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("fpm");
  });

  it("PostgreSQL -> PostgreSQL recommendations", () => {
    initWithArchOverrides(tmpDir, { database: "PostgreSQL" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("pg_dump");
  });

  it("MySQL -> MySQL recommendations", () => {
    initWithArchOverrides(tmpDir, { database: "MySQL" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("mysqldump");
  });

  it("MongoDB -> MongoDB recommendations", () => {
    initWithArchOverrides(tmpDir, { database: "MongoDB" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("replica");
  });

  it("Redis -> Redis recommendations", () => {
    initWithArchOverrides(tmpDir, { database: "Redis" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("maxmemory");
  });

  it("DigitalOcean -> DO recommendations", () => {
    initWithArchOverrides(tmpDir, { hosting: "DigitalOcean" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("Droplet");
  });

  it("AWS -> AWS recommendations", () => {
    initWithArchOverrides(tmpDir, { hosting: "AWS" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toMatch(/EC2|ECS/);
  });

  it("Fly.io -> Fly recommendations", () => {
    initWithArchOverrides(tmpDir, { hosting: "Fly.io" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("fly");
  });

  it("Railway -> Railway recommendations", () => {
    initWithArchOverrides(tmpDir, { hosting: "Railway" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("railway");
  });

  it("Debian VPS -> Linux recommendations", () => {
    initWithArchOverrides(tmpDir, { hosting: "Debian VPS" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("unattended");
  });

  it("returns error without architecture", () => {
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
    // No set-architecture — force to deployment phase to test the architecture check
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    expect(result.error).toBeTruthy();
  });
});

describe("handleGetChecklist", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir("a2p-deploy");
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it("SQLite -> WAL-related items in checklist", () => {
    initWithArchOverrides(tmpDir, { database: "SQLite" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.postDeployment,
    ];
    expect(allItems.some((i: any) => i.item.includes("WAL"))).toBe(true);
  });

  it("Stripe -> Stripe-specific items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Stripe"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment;
    expect(preItems.some((i: any) => i.item.includes("Stripe"))).toBe(true);
  });

  it("Firebase -> Firebase-specific items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Firebase Auth"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment;
    expect(preItems.some((i: any) => i.item.includes("Firebase"))).toBe(true);
  });

  it("base items always present with minimum counts", () => {
    initWithArchOverrides(tmpDir);
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    expect(result.checklist.preDeployment.length).toBeGreaterThanOrEqual(8);
    expect(result.checklist.infrastructure.length).toBeGreaterThanOrEqual(6);
    expect(result.checklist.postDeployment.length).toBeGreaterThanOrEqual(8);
  });

  it("done flags correct when all slices completed and 0 findings", () => {
    initWithArchOverrides(tmpDir);
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

    // Complete the slice through TDD cycle with proper evidence
    const sm = new StateManager(tmpDir);
    walkSliceToStatus(sm, "s01", "done");

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

  it("PostgreSQL -> PostgreSQL checklist items", () => {
    initWithArchOverrides(tmpDir, { database: "PostgreSQL" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = result.checklist.postDeployment.map((i: any) => i.item).join(" ");
    expect(allItems).toContain("pg_dump");
  });

  it("Redis in other -> Redis checklist items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Redis"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = result.checklist.postDeployment.map((i: any) => i.item).join(" ");
    expect(allItems).toContain("maxmemory");
  });

  it("Debian VPS -> Linux checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Debian VPS" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("unattended-upgrades");
  });

  it("Clerk -> Clerk checklist items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Clerk"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Clerk");
    expect(preItems).toContain("callback");
  });

  it("Resend -> Resend checklist items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Resend"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Resend");
    expect(preItems).toContain("SPF");
  });

  it("Upstash -> Upstash checklist items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Upstash"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Upstash");
  });

  it("Sentry -> Sentry checklist items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["Sentry"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Sentry");
    expect(preItems).toContain("DSN");
  });

  it("Render hosting -> Render checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Render" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("Render");
    expect(infraItems).toContain("Blueprint");
  });

  it("Vercel hosting -> Vercel checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Vercel" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("Vercel");
  });

  it("Cloudflare hosting -> Cloudflare checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Cloudflare" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("Cloudflare");
    expect(infraItems).toContain("SSL");
  });

  it("Fly.io hosting -> Fly checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Fly.io" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("Fly");
  });

  it("Railway hosting -> Railway checklist items", () => {
    initWithArchOverrides(tmpDir, { hosting: "Railway" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    expect(infraItems).toContain("Railway");
  });

  it("Render hosting -> Render recommendations in deployment", () => {
    initWithArchOverrides(tmpDir, { hosting: "Render" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("render");
    expect(recs).toContain("blueprint");
  });

  it("Cloudflare hosting -> Cloudflare recommendations in deployment", () => {
    initWithArchOverrides(tmpDir, { hosting: "Cloudflare" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ").toLowerCase();
    expect(recs).toContain("cloudflare");
    expect(recs).toContain("wrangler");
  });

  it("returns error without project", () => {
    const otherDir = makeTmpDir("a2p-deploy");
    const result = parse(handleGetChecklist({ projectPath: otherDir }));
    expect(result.error).toBeTruthy();
    cleanTmpDir(otherDir);
  });

  // ─── Mobile platform checklist items ──────────────────────────────────

  it("mobile platform -> code signing and mobile items", () => {
    initWithArchOverrides(tmpDir, { language: "Dart", framework: "Flutter", platform: "mobile" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    const infraItems = result.checklist.infrastructure.map((i: any) => i.item).join(" ");
    const postItems = result.checklist.postDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Code signing");
    expect(preItems).toContain("App ID");
    expect(preItems).toContain("No secrets in shipped client artifact");
    expect(preItems).toContain("Release build hardening");
    expect(preItems).toContain("non-debug mode");
    expect(infraItems).toContain("TestFlight");
    expect(postItems).toContain("Deep links");
    expect(postItems).toContain("Push notification");
    expect(postItems).toContain("local storage");
    expect(postItems).toContain("TLS");
  });

  it("cross-platform -> mobile + desktop items", () => {
    initWithArchOverrides(tmpDir, { language: "TypeScript", framework: "Electron", platform: "cross-platform" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Code signing");
    expect(preItems).toContain("Desktop release packaging");
    expect(preItems).toContain("notarization");
  });

  it("web platform -> no mobile items", () => {
    initWithArchOverrides(tmpDir, { frontend: "React", platform: "web" });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.infrastructure,
      ...result.checklist.postDeployment,
    ].map((i: any) => i.item).join(" ");
    expect(allItems).not.toContain("Code signing");
    expect(allItems).not.toContain("TestFlight");
  });

  it("no platform (default web) -> no mobile items", () => {
    initWithArchOverrides(tmpDir);
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.infrastructure,
      ...result.checklist.postDeployment,
    ].map((i: any) => i.item).join(" ");
    expect(allItems).not.toContain("Code signing");
  });

  // ─── Compliance checklist items ───────────────────────────────────────

  it("GoBD in features -> compliance items", () => {
    initWithArchOverrides(tmpDir, { features: ["CRUD", "GoBD Archivierung"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    const postItems = result.checklist.postDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Append-only");
    expect(preItems).toContain("Retention policy");
    expect(postItems).toContain("Audit trail");
    expect(postItems).toContain("GDPR");
  });

  it("GDPR in otherTech -> compliance items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["GDPR Compliance Module"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("Retention policy");
  });

  it("no compliance keywords -> no compliance items", () => {
    initWithArchOverrides(tmpDir);
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.postDeployment,
    ].map((i: any) => i.item).join(" ");
    expect(allItems).not.toContain("Append-only");
    expect(allItems).not.toContain("Audit trail");
  });

  it("'architecture' in features does NOT trigger compliance (no false positive)", () => {
    initWithArchOverrides(tmpDir, { features: ["CRUD", "microservice architecture"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).not.toContain("Append-only");
  });

  // ─── External validator checklist items ───────────────────────────────

  it("KoSIT in otherTech -> validator items", () => {
    initWithArchOverrides(tmpDir, { otherTech: ["KoSIT XML-Validator"] });
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const preItems = result.checklist.preDeployment.map((i: any) => i.item).join(" ");
    const postItems = result.checklist.postDeployment.map((i: any) => i.item).join(" ");
    expect(preItems).toContain("External validator installed");
    expect(preItems).toContain("reject-cases");
    expect(postItems).toContain("Validator version");
  });

  it("no validator keywords -> no validator items", () => {
    initWithArchOverrides(tmpDir);
    const result = parse(handleGetChecklist({ projectPath: tmpDir }));
    const allItems = [
      ...result.checklist.preDeployment,
      ...result.checklist.postDeployment,
    ].map((i: any) => i.item).join(" ");
    expect(allItems).not.toContain("External validator");
  });

  // ─── Mobile deployment recommendations ────────────────────────────────

  it("Flutter mobile + Hetzner backend -> server artifacts + mobile recs + mobile note", () => {
    initWithArchOverrides(tmpDir, { language: "Dart", framework: "Flutter", platform: "mobile", hosting: "Hetzner" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("flutter build");
    expect(recs).toContain("TestFlight");
    expect(recs).toContain("API base URL");
    expect(recs).toContain("API versioning");
    // Server artifacts present because hosting is set
    const files = result.deploymentGuide.filesToGenerate.join(" ");
    expect(files).toContain("Dockerfile");
    expect(files).toContain("DEPLOYMENT.md");
    // No false mobile artifact promises
    expect(files.toLowerCase()).not.toContain("fastlane");
    expect(files.toLowerCase()).not.toContain("build-mobile");
    // Mobile deployment note present
    expect(result.deploymentGuide.mobileDeploymentNote).toContain("outside A2P");
    // Server security hardening present
    expect(result.deploymentGuide.securityHardening).toBeDefined();
    expect(result.deploymentGuide.securityHardening.length).toBeGreaterThan(0);
  });

  it("Flutter mobile-only (no hosting, no DB) -> NO server artifacts, HAS mobile note", () => {
    initWithArchOverrides(tmpDir, { language: "Dart", framework: "Flutter", platform: "mobile" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const files = result.deploymentGuide.filesToGenerate.join(" ");
    // No Docker/Caddy/backup server artifacts
    expect(files).not.toContain("Dockerfile");
    expect(files).not.toContain("docker-compose");
    expect(files).not.toContain("Caddyfile");
    expect(files).not.toContain("backup.sh");
    // Deployment docs still present
    expect(files).toContain("DEPLOYMENT.md");
    expect(files).toContain("LAUNCH_CHECKLIST.md");
    // No server security hardening
    expect(result.deploymentGuide.securityHardening).toBeUndefined();
    // No backup guide
    expect(result.deploymentGuide.backupGuide).toBeUndefined();
    // Mobile deployment note present
    expect(result.deploymentGuide.mobileDeploymentNote).toBeDefined();
    // Mobile recommendations present
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).toContain("flutter build");
    // No Docker-specific language recs for mobile-only
    expect(recs).not.toContain("Multi-stage");
    // Hint reflects mobile context
    expect(result.hint).toContain("mobile");
  });

  it("Kotlin mobile-only -> no JRE/temurin Docker recs", () => {
    initWithArchOverrides(tmpDir, { language: "Kotlin", framework: "Jetpack Compose", platform: "mobile" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).not.toContain("temurin");
    expect(recs).not.toContain("Multi-stage");
    expect(recs).toContain("TestFlight");
  });

  it("web platform -> no mobile recommendations, has server artifacts", () => {
    initWithArchOverrides(tmpDir, { frontend: "React", platform: "web" });
    setDeployReady(tmpDir);
    const result = parse(handleGenerateDeployment({ projectPath: tmpDir }));
    const recs = result.deploymentGuide.recommendations.join(" ");
    expect(recs).not.toContain("TestFlight");
    expect(recs).not.toContain("flutter build");
    // Server artifacts present
    const files = result.deploymentGuide.filesToGenerate.join(" ");
    expect(files).toContain("Dockerfile");
    // No mobile note
    expect(result.deploymentGuide.mobileDeploymentNote).toBeUndefined();
  });
});
