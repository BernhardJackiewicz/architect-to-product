import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSetArchitecture } from "../../src/tools/set-architecture.js";
import { handleInitProject } from "../../src/tools/init-project.js";
import { StateManager } from "../../src/state/state-manager.js";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "a2p-arch-"));
}

function parse(json: string) {
  return JSON.parse(json);
}

const baseInput = {
  name: "Test App",
  description: "A test application",
  language: "Python",
  framework: "FastAPI",
  features: ["CRUD", "Auth"],
  dataModel: "users, items",
  apiDesign: "REST",
};

describe("handleSetArchitecture", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    handleInitProject({ projectPath: tmpDir, projectName: "test" });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("stores architecture correctly in state", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.name).toBe("Test App");
    expect(result.architecture.techStack.language).toBe("Python");
    expect(result.architecture.techStack.framework).toBe("FastAPI");

    // Verify persisted in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.name).toBe("Test App");
    expect(state.architecture?.description).toBe("A test application");
  });

  it("optional fields can be omitted without crash", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    // database, frontend, hosting are all undefined
    expect(result.success).toBe(true);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.techStack.database).toBeNull();
    expect(state.architecture?.techStack.frontend).toBeNull();
    expect(state.architecture?.techStack.hosting).toBeNull();
  });

  it("detects Supabase -> supabase-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "Supabase",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("supabase"))).toBe(true);
  });

  it("detects PostgreSQL -> postgres-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "PostgreSQL",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("postgres"))).toBe(true);
  });

  it("detects SQLite -> sqlite-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        database: "SQLite",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("sqlite"))).toBe(true);
  });

  it("suggests supabase as default when no database specified", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(
      result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("supabase"))
    ).toBe(true);
  });

  it("detects frontend -> playwright-mcp", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "React",
      })
    );
    expect(
      result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("playwright"))
    ).toBe(true);
  });

  it("always suggests codebase-memory-mcp", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions).toContain("codebase-memory-mcp");
  });

  it("returns error without init", () => {
    const otherDir = makeTmpDir();
    const result = parse(
      handleSetArchitecture({ projectPath: otherDir, ...baseInput })
    );
    expect(result.error).toContain("No project");
    rmSync(otherDir, { recursive: true, force: true });
  });

  it("counts features correctly", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["A", "B", "C"],
      })
    );
    expect(result.architecture.featureCount).toBe(3);
  });

  it("accepts and stores phases", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        phases: [
          { id: "phase-0", name: "Spikes", description: "Evaluate tools", deliverables: ["Spike A"], timeline: "Week 1" },
          { id: "phase-1", name: "MVP", description: "Build MVP", deliverables: ["Feature A", "Feature B"], timeline: "Weeks 2-8" },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.phasesDetected).toBe(2);
    expect(result.phaseNames).toEqual(["Spikes", "MVP"]);

    // Verify persisted in state
    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.phases?.length).toBe(2);
    expect(state.architecture?.phases?.[0].id).toBe("phase-0");
    expect(state.architecture?.phases?.[1].name).toBe("MVP");
  });

  it("stores reviewMode 'ui-only' in state and returns it", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        reviewMode: "ui-only",
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.reviewMode).toBe("ui-only");

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.reviewMode).toBe("ui-only");
  });

  it("stores reviewMode 'all' in state and returns it", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        reviewMode: "all",
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.reviewMode).toBe("all");

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.reviewMode).toBe("all");
  });

  it("stores reviewMode 'off' in state and returns it", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        reviewMode: "off",
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.reviewMode).toBe("off");

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.reviewMode).toBe("off");
  });

  it("works without reviewMode (default behavior)", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.reviewMode).toBeUndefined();

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.reviewMode).toBeUndefined();
  });

  it("stores uiDesign with text description", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "React",
        uiDesign: {
          description: "Dashboard mit Sidebar-Navigation und KPI-Cards",
          style: "minimal",
          references: [
            { type: "description", description: "Login-Page mit OAuth-Buttons und E-Mail-Feld" },
          ],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.hasUIDesign).toBe(true);
    expect(result.architecture.uiStyle).toBe("minimal");
    expect(result.architecture.uiReferenceCount).toBe(1);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.uiDesign?.description).toBe("Dashboard mit Sidebar-Navigation und KPI-Cards");
    expect(state.architecture?.uiDesign?.style).toBe("minimal");
    expect(state.architecture?.uiDesign?.references).toHaveLength(1);
    expect(state.architecture?.uiDesign?.references[0].type).toBe("description");
  });

  it("stores uiDesign with image references", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "React",
        uiDesign: {
          description: "E-Commerce mit Produktkarten und Warenkorb",
          references: [
            { type: "wireframe", path: "/designs/homepage.png", description: "Homepage mit Hero und Produktgrid" },
            { type: "mockup", path: "/designs/checkout.png", description: "Checkout-Flow 3 Schritte" },
            { type: "screenshot", path: "/designs/competitor.jpg", description: "Referenz: Competitor-Shop" },
          ],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.hasUIDesign).toBe(true);
    expect(result.architecture.uiReferenceCount).toBe(3);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    const refs = state.architecture?.uiDesign?.references;
    expect(refs).toHaveLength(3);
    expect(refs?.[0].type).toBe("wireframe");
    expect(refs?.[0].path).toBe("/designs/homepage.png");
    expect(refs?.[1].type).toBe("mockup");
    expect(refs?.[2].type).toBe("screenshot");
  });

  it("stores uiDesign with mixed references (text + images)", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "Vue",
        uiDesign: {
          description: "Admin-Panel",
          style: "corporate",
          references: [
            { type: "description", description: "Tabellen-Ansicht mit Filter und Sortierung" },
            { type: "wireframe", path: "/admin-wireframe.pdf", description: "Wireframe des Admin-Dashboards" },
          ],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.uiReferenceCount).toBe(2);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.uiDesign?.references[0].type).toBe("description");
    expect(state.architecture?.uiDesign?.references[1].type).toBe("wireframe");
    expect(state.architecture?.uiDesign?.references[1].path).toBe("/admin-wireframe.pdf");
  });

  it("stores uiDesign with empty references (AI-generated design)", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        frontend: "React",
        uiDesign: {
          description: "AI-generiertes Design: Modernes SaaS-Dashboard mit Dark-Mode, Sidebar-Nav, responsive",
          style: "dashboard",
          references: [],
        },
      })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.hasUIDesign).toBe(true);
    expect(result.architecture.uiReferenceCount).toBe(0);

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.uiDesign?.description).toContain("AI-generiertes Design");
    expect(state.architecture?.uiDesign?.style).toBe("dashboard");
  });

  it("works without uiDesign (backward compat)", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );

    expect(result.success).toBe(true);
    expect(result.architecture.hasUIDesign).toBeUndefined();

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.uiDesign).toBeUndefined();
  });

  it("works without phases (backward compat)", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.success).toBe(true);
    expect(result.phasesDetected).toBeUndefined();

    const sm = new StateManager(tmpDir);
    const state = sm.read();
    expect(state.architecture?.phases).toBeUndefined();
  });

  // ─── New MCP detection ────────────────────────────────────────────────

  it("always suggests git MCP", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("mcp-server-git"))).toBe(true);
  });

  it("always suggests filesystem MCP", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("server-filesystem"))).toBe(true);
  });

  it("always suggests sequential thinking MCP", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("sequential-thinking"))).toBe(true);
  });

  it("always suggests semgrep MCP", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("semgrep"))).toBe(true);
  });

  it("detects Vercel hosting -> vercel MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        hosting: "Vercel",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("vercel"))).toBe(true);
  });

  it("detects Next.js framework -> vercel MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        framework: "Next.js",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("vercel"))).toBe(true);
  });

  it("detects Cloudflare hosting -> cloudflare MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        hosting: "Cloudflare Workers",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("cloudflare"))).toBe(true);
  });

  it("detects Stripe in features -> stripe MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["User Auth", "Stripe Payment Integration"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("stripe"))).toBe(true);
  });

  it("detects payment in features -> stripe MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["Payment processing", "Subscriptions"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("stripe"))).toBe(true);
  });

  it("detects Jira in features -> atlassian MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["Jira Integration", "Task Sync"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("atlassian"))).toBe(true);
  });

  it("detects Sentry in features -> sentry MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["Sentry Error Tracking", "Monitoring"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("sentry"))).toBe(true);
  });

  it("detects Upstash in otherTech -> upstash MCP", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        otherTech: ["Upstash Redis"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("upstash"))).toBe(true);
  });

  it("detects Clerk in features -> non-MCP note", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["Clerk Auth", "User Management"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("Clerk"))).toBe(true);
  });

  it("detects Resend in features -> non-MCP note", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        features: ["Resend Email Notifications"],
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("Resend"))).toBe(true);
  });

  it("does not suggest Vercel MCP when hosting is not Vercel", () => {
    const result = parse(
      handleSetArchitecture({
        projectPath: tmpDir,
        ...baseInput,
        hosting: "Hetzner",
        framework: "FastAPI",
      })
    );
    expect(result.suggestedCompanions.some((c: string) => c.toLowerCase().includes("vercel"))).toBe(false);
  });

  it("suggests GitHub MCP for all projects", () => {
    const result = parse(
      handleSetArchitecture({ projectPath: tmpDir, ...baseInput })
    );
    expect(result.suggestedCompanions.some((c: string) => c.includes("github-mcp-server"))).toBe(true);
  });
});
