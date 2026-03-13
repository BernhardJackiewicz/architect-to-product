import { describe, it, expect } from "vitest";
import { BUILD_SLICE_PROMPT } from "../../src/prompts/build-slice.js";
import { PLANNING_PROMPT } from "../../src/prompts/planning.js";
import { REFACTOR_PROMPT } from "../../src/prompts/refactor.js";
import { SECURITY_GATE_PROMPT } from "../../src/prompts/security-gate.js";
import { E2E_TESTING_PROMPT } from "../../src/prompts/e2e-testing.js";
import { DEPLOY_PROMPT } from "../../src/prompts/deploy.js";
import { ONBOARDING_PROMPT } from "../../src/prompts/onboarding.js";

// ─── codebase-memory-mcp ─────────────────────────────────────────────────────
// Akzeptanzkriterium: codebase-memory wird in jedem relevanten Prompt
// mit konkreten Tool-Aufrufen referenziert, nicht nur als vage Erwähnung.

describe("codebase-memory-mcp integration", () => {
  describe("build-slice", () => {
    it("calls index_repository BEFORE starting TDD cycle", () => {
      const indexPos = BUILD_SLICE_PROMPT.indexOf("index_repository");
      const tddPos = BUILD_SLICE_PROMPT.indexOf("TDD-Zyklus");
      expect(indexPos).toBeGreaterThan(-1);
      expect(indexPos).toBeLessThan(tddPos);
    });

    it("uses search_code to find existing code before building", () => {
      expect(BUILD_SLICE_PROMPT).toContain("search_code");
      // Must appear before RED phase
      const searchPos = BUILD_SLICE_PROMPT.indexOf("search_code");
      const redPos = BUILD_SLICE_PROMPT.indexOf("Phase RED");
      expect(searchPos).toBeLessThan(redPos);
    });

    it("uses trace_call_path to understand code relationships", () => {
      expect(BUILD_SLICE_PROMPT).toContain("trace_call_path");
    });

    it("calls index_repository AFTER each slice for graph freshness", () => {
      // Should appear in the "Nach jedem Slice" section
      const afterSliceSection = BUILD_SLICE_PROMPT.indexOf("Nach jedem Slice");
      const indexAfter = BUILD_SLICE_PROMPT.indexOf("index_repository", afterSliceSection);
      expect(indexAfter).toBeGreaterThan(afterSliceSection);
    });
  });

  describe("planning", () => {
    it("calls index_repository before planning slices", () => {
      expect(PLANNING_PROMPT).toContain("index_repository");
    });

    it("uses search_graph to find existing functions", () => {
      expect(PLANNING_PROMPT).toContain("search_graph");
      expect(PLANNING_PROMPT).toContain('type="function"');
    });

    it("warns against creating slices for already-built functionality", () => {
      expect(PLANNING_PROMPT).toMatch(/bereits (gebaut|existiert)/i);
    });
  });

  describe("refactor", () => {
    it("calls index_repository as step 0 before analysis", () => {
      const indexPos = REFACTOR_PROMPT.indexOf("index_repository");
      const deadCodePos = REFACTOR_PROMPT.indexOf("Dead Code Detection");
      expect(indexPos).toBeGreaterThan(-1);
      expect(indexPos).toBeLessThan(deadCodePos);
    });

    it("uses search_graph for dead code detection", () => {
      expect(REFACTOR_PROMPT).toContain("search_graph");
    });

    it("uses trace_call_path to check if functions have callers", () => {
      expect(REFACTOR_PROMPT).toContain("trace_call_path");
    });

    it("uses search_graph for redundancy detection", () => {
      // search_graph should appear in the redundancy section
      const redundancyPos = REFACTOR_PROMPT.indexOf("Redundanz");
      const searchAfter = REFACTOR_PROMPT.indexOf("search_graph", redundancyPos);
      expect(searchAfter).toBeGreaterThan(redundancyPos);
    });
  });

  describe("security-gate", () => {
    it("calls index_repository before security scans", () => {
      const indexPos = SECURITY_GATE_PROMPT.indexOf("index_repository");
      const phase1Pos = SECURITY_GATE_PROMPT.indexOf("Phase 1");
      expect(indexPos).toBeGreaterThan(-1);
      expect(indexPos).toBeLessThan(phase1Pos);
    });

    it("uses search_code for security-sensitive patterns", () => {
      expect(SECURITY_GATE_PROMPT).toContain("search_code");
    });

    it("searches for password handling patterns", () => {
      expect(SECURITY_GATE_PROMPT).toContain("password");
      expect(SECURITY_GATE_PROMPT).toContain("bcrypt");
    });

    it("searches for auth patterns", () => {
      expect(SECURITY_GATE_PROMPT).toContain("token");
      expect(SECURITY_GATE_PROMPT).toContain("jwt");
      expect(SECURITY_GATE_PROMPT).toContain("session");
    });

    it("searches for injection patterns", () => {
      expect(SECURITY_GATE_PROMPT).toContain("query");
      expect(SECURITY_GATE_PROMPT).toContain("execute");
    });
  });
});

// ─── DB-MCP ──────────────────────────────────────────────────────────────────
// Akzeptanzkriterium: DB-MCP wird bei jedem datenbank-relevanten Schritt
// mit konkreten Aktionen referenziert (Schema prüfen, Daten verifizieren).

describe("DB-MCP integration", () => {
  describe("build-slice", () => {
    it("references DB-MCP for database slices", () => {
      expect(BUILD_SLICE_PROMPT).toContain("DB-MCP");
    });

    it("checks schema with list_tables and describe_table", () => {
      expect(BUILD_SLICE_PROMPT).toContain("list_tables");
      expect(BUILD_SLICE_PROMPT).toContain("describe_table");
    });

    it("verifies migrations and seed data", () => {
      expect(BUILD_SLICE_PROMPT).toMatch(/[Mm]igration/);
      expect(BUILD_SLICE_PROMPT).toContain("Seed-Data");
    });

    it("tests CRUD with real DB queries", () => {
      expect(BUILD_SLICE_PROMPT).toContain("CRUD");
      expect(BUILD_SLICE_PROMPT).toMatch(/DB-Quer/i);
    });
  });

  describe("planning", () => {
    it("checks existing DB schema before planning", () => {
      expect(PLANNING_PROMPT).toContain("DB-MCP");
      expect(PLANNING_PROMPT).toContain("DB-Schema");
    });

    it("considers existing tables in planning", () => {
      expect(PLANNING_PROMPT).toMatch(/Tabellen.*existieren/);
    });
  });

  describe("security-gate", () => {
    it("checks password fields are hashed", () => {
      const dbSection = SECURITY_GATE_PROMPT.indexOf("Datenbank prüfen");
      expect(dbSection).toBeGreaterThan(-1);
      expect(SECURITY_GATE_PROMPT).toMatch(/Passwort.*gehasht/);
    });

    it("checks PII handling", () => {
      expect(SECURITY_GATE_PROMPT).toContain("PII");
    });

    it("checks foreign keys and constraints", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Foreign Keys");
      expect(SECURITY_GATE_PROMPT).toContain("Constraints");
    });
  });

  describe("e2e-testing", () => {
    it("prepares test data via DB-MCP before tests", () => {
      expect(E2E_TESTING_PROMPT).toContain("DB-MCP");
      const dbSection = E2E_TESTING_PROMPT.indexOf("Testdaten vorbereiten");
      const scenariosSection = E2E_TESTING_PROMPT.indexOf("Test-Szenarien");
      expect(dbSection).toBeGreaterThan(-1);
      expect(dbSection).toBeLessThan(scenariosSection);
    });

    it("verifies data persistence after E2E tests", () => {
      expect(E2E_TESTING_PROMPT).toMatch(/[Dd]aten.*korrekt.*DB/);
    });
  });

  describe("deploy", () => {
    it("checks migrations before deployment", () => {
      expect(DEPLOY_PROMPT).toContain("DB-MCP");
      expect(DEPLOY_PROMPT).toContain("Migrations");
    });

    it("verifies schema matches expected state", () => {
      expect(DEPLOY_PROMPT).toContain("Schema");
    });

    it("checks backup mechanisms", () => {
      expect(DEPLOY_PROMPT).toContain("Backup");
    });

    it("DB checks appear before deployment steps", () => {
      const dbCheckPos = DEPLOY_PROMPT.indexOf("Datenbank prüfen");
      const step1Pos = DEPLOY_PROMPT.indexOf("Schritt 1");
      expect(dbCheckPos).toBeGreaterThan(-1);
      expect(dbCheckPos).toBeLessThan(step1Pos);
    });
  });
});

// ─── Semgrep + Bandit (SAST CLI Tools) ──────────────────────────────────────
// Akzeptanzkriterium: Semgrep/Bandit werden im Onboarding installiert
// und im Security-Gate mit Fallback-Logik referenziert.

describe("Semgrep + Bandit integration", () => {
  describe("onboarding", () => {
    it("includes semgrep installation instructions", () => {
      expect(ONBOARDING_PROMPT).toContain("pip install semgrep");
    });

    it("includes bandit installation for Python projects", () => {
      expect(ONBOARDING_PROMPT).toContain("pip install bandit");
    });

    it("includes verification commands", () => {
      expect(ONBOARDING_PROMPT).toContain("which semgrep");
      expect(ONBOARDING_PROMPT).toContain("which bandit");
    });

    it("provides fallback message if installation fails", () => {
      expect(ONBOARDING_PROMPT).toMatch(/[Ii]nstallation.*fehl/);
    });

    it("SAST tools section comes after companion MCPs setup", () => {
      const companionPos = ONBOARDING_PROMPT.indexOf("a2p_setup_companions");
      const sastPos = ONBOARDING_PROMPT.indexOf("SAST-Tools installieren");
      expect(companionPos).toBeGreaterThan(-1);
      expect(sastPos).toBeGreaterThan(companionPos);
    });
  });

  describe("security-gate", () => {
    it("references a2p_run_sast for automated scanning", () => {
      expect(SECURITY_GATE_PROMPT).toContain("a2p_run_sast");
    });

    it("mentions semgrep as SAST tool", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Semgrep");
    });

    it("mentions bandit for Python projects", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Bandit");
    });

    it("provides install fallback if tools are missing", () => {
      expect(SECURITY_GATE_PROMPT).toContain("pip install semgrep bandit");
    });

    it("instructs to retry a2p_run_sast after installation", () => {
      const installPos = SECURITY_GATE_PROMPT.indexOf("pip install semgrep bandit");
      const retryPos = SECURITY_GATE_PROMPT.indexOf("a2p_run_sast", installPos);
      expect(retryPos).toBeGreaterThan(installPos);
    });
  });
});

// ─── Playwright MCP ─────────────────────────────────────────────────────────
// Akzeptanzkriterium: Playwright wird im Onboarding konfiguriert und
// in build-slice + e2e-testing mit konkreten browser_* Aufrufen genutzt.

describe("Playwright MCP integration", () => {
  describe("onboarding", () => {
    it("configures Playwright MCP for frontend projects", () => {
      expect(ONBOARDING_PROMPT).toContain("Playwright MCP");
      expect(ONBOARDING_PROMPT).toContain("@anthropic/mcp-playwright");
    });
  });

  describe("build-slice", () => {
    it("uses browser_navigate for visual verification", () => {
      expect(BUILD_SLICE_PROMPT).toContain("browser_navigate");
    });

    it("uses browser_take_screenshot for visual checks", () => {
      expect(BUILD_SLICE_PROMPT).toContain("browser_take_screenshot");
    });

    it("uses browser_click for interaction testing", () => {
      expect(BUILD_SLICE_PROMPT).toContain("browser_click");
    });

    it("uses browser_resize for responsive testing", () => {
      expect(BUILD_SLICE_PROMPT).toContain("browser_resize");
    });

    it("uses browser_console_messages for error checking", () => {
      expect(BUILD_SLICE_PROMPT).toContain("browser_console_messages");
    });
  });

  describe("e2e-testing", () => {
    it("requires Playwright MCP as prerequisite", () => {
      expect(E2E_TESTING_PROMPT).toContain("Playwright MCP");
    });

    it("uses browser_navigate for smoke tests", () => {
      expect(E2E_TESTING_PROMPT).toContain("browser_navigate");
    });

    it("uses browser_snapshot for accessibility checks", () => {
      expect(E2E_TESTING_PROMPT).toContain("browser_snapshot");
    });

    it("uses browser_take_screenshot for visual quality", () => {
      expect(E2E_TESTING_PROMPT).toContain("browser_take_screenshot");
    });

    it("uses browser_click for interaction tests", () => {
      expect(E2E_TESTING_PROMPT).toContain("browser_click");
    });

    it("uses browser_resize for responsive checks", () => {
      expect(E2E_TESTING_PROMPT).toContain("browser_resize");
    });
  });
});

// ─── Onboarding: Companion-Vollständigkeit ──────────────────────────────────
// Akzeptanzkriterium: Das Onboarding konfiguriert ALLE benötigten
// Companions und Tools, nicht nur eine Teilmenge.

describe("Onboarding completeness", () => {
  it("always sets up codebase-memory-mcp", () => {
    expect(ONBOARDING_PROMPT).toContain("codebase-memory-mcp");
    expect(ONBOARDING_PROMPT).toMatch(/IMMER/);
  });

  it("sets up database MCP for Supabase", () => {
    expect(ONBOARDING_PROMPT).toContain("https://mcp.supabase.com/mcp");
  });

  it("sets up database MCP for PostgreSQL", () => {
    expect(ONBOARDING_PROMPT).toContain("@modelcontextprotocol/server-postgres");
  });

  it("sets up database MCP for SQLite", () => {
    expect(ONBOARDING_PROMPT).toContain("@modelcontextprotocol/server-sqlite");
  });

  it("sets up Playwright MCP for frontend projects", () => {
    expect(ONBOARDING_PROMPT).toContain("@anthropic/mcp-playwright");
  });

  it("installs Semgrep for all projects", () => {
    expect(ONBOARDING_PROMPT).toContain("pip install semgrep");
  });

  it("installs Bandit for Python projects", () => {
    expect(ONBOARDING_PROMPT).toContain("pip install bandit");
  });

  it("writes .mcp.json automatically", () => {
    expect(ONBOARDING_PROMPT).toContain(".mcp.json");
  });

  it("instructs user to restart Claude Code", () => {
    expect(ONBOARDING_PROMPT).toMatch(/[Ss]tarte Claude Code.*neu/);
  });
});
