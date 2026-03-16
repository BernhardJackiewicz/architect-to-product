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
      const tddPos = BUILD_SLICE_PROMPT.indexOf("Evidence-Driven Development Cycle");
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
      const deployPathPos = DEPLOY_PROMPT.indexOf("Deploy-Pfad wählen");
      expect(dbCheckPos).toBeGreaterThan(-1);
      expect(dbCheckPos).toBeLessThan(deployPathPos);
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
      expect(ONBOARDING_PROMPT).toContain("@playwright/mcp");
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

// ─── Git MCP ──────────────────────────────────────────────────────────────────
// Akzeptanzkriterium: Git MCP wird in build-slice und refactor mit
// konkreten Tool-Aufrufen (git_log, git_diff) referenziert.

describe("Git MCP integration", () => {
  describe("build-slice", () => {
    it("references Git MCP for commits after TDD phases", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Git MCP");
    });

    it("uses git_log to check commits", () => {
      expect(BUILD_SLICE_PROMPT).toContain("git_log");
    });

    it("uses git_diff to check changes", () => {
      expect(BUILD_SLICE_PROMPT).toContain("git_diff");
    });

    it("recommends conventional commit messages", () => {
      expect(BUILD_SLICE_PROMPT).toMatch(/feat:|test:|refactor:/);
    });
  });

  describe("refactor", () => {
    it("uses git_log for hotspot analysis", () => {
      expect(REFACTOR_PROMPT).toContain("git_log");
    });

    it("mentions change hotspots", () => {
      expect(REFACTOR_PROMPT).toMatch(/[Hh]otspot/);
    });
  });
});

// ─── Filesystem MCP ──────────────────────────────────────────────────────────
// Akzeptanzkriterium: Filesystem MCP wird in build-slice und e2e-testing
// mit konkreten Tool-Aufrufen referenziert.

describe("Filesystem MCP integration", () => {
  describe("build-slice", () => {
    it("references Filesystem MCP for migrations", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Filesystem MCP");
    });

    it("uses write_file for migration files", () => {
      expect(BUILD_SLICE_PROMPT).toContain("write_file");
    });

    it("uses list_directory to check existing migrations", () => {
      expect(BUILD_SLICE_PROMPT).toContain("list_directory");
    });
  });

  describe("e2e-testing", () => {
    it("references Filesystem MCP for test artifacts", () => {
      expect(E2E_TESTING_PROMPT).toContain("Filesystem MCP");
    });

    it("saves screenshots to tests/screenshots/", () => {
      expect(E2E_TESTING_PROMPT).toContain("tests/screenshots/");
    });

    it("saves accessibility reports as JSON", () => {
      expect(E2E_TESTING_PROMPT).toContain("accessibility");
      expect(E2E_TESTING_PROMPT).toContain("JSON");
    });
  });
});

// ─── Sequential Thinking MCP ──────────────────────────────────────────────────
// Akzeptanzkriterium: Sequential Thinking MCP wird in planning und refactor
// mit konkreten Aufrufen referenziert.

describe("Sequential Thinking MCP integration", () => {
  describe("planning", () => {
    it("uses sequentialthinking for complex dependency graphs", () => {
      expect(PLANNING_PROMPT).toContain("sequentialthinking");
    });

    it("mentions complex dependencies as trigger", () => {
      expect(PLANNING_PROMPT).toMatch(/komple.*Abhängigkeit/i);
    });
  });

  describe("refactor", () => {
    it("uses sequentialthinking for complex decoupling", () => {
      expect(REFACTOR_PROMPT).toContain("sequentialthinking");
    });

    it("mentions decoupling strategies", () => {
      expect(REFACTOR_PROMPT).toMatch(/[Ee]ntkoppl/);
    });
  });
});

// ─── Semgrep MCP ──────────────────────────────────────────────────────────────
// Akzeptanzkriterium: Semgrep MCP wird bevorzugt vor CLI aufgerufen,
// mit konkreten Tool-Namen.

describe("Semgrep MCP integration", () => {
  describe("build-slice", () => {
    it("prefers Semgrep MCP over CLI", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Semgrep MCP");
      expect(BUILD_SLICE_PROMPT).toContain("semgrep_scan");
    });

    it("uses security_check for security analysis", () => {
      expect(BUILD_SLICE_PROMPT).toContain("security_check");
    });

    it("uses get_abstract_syntax_tree for deep analysis", () => {
      expect(BUILD_SLICE_PROMPT).toContain("get_abstract_syntax_tree");
    });

    it("falls back to a2p_run_sast", () => {
      const semgrepSection = BUILD_SLICE_PROMPT.indexOf("Semgrep MCP bevorzugt");
      const fallback = BUILD_SLICE_PROMPT.indexOf("a2p_run_sast", semgrepSection);
      expect(fallback).toBeGreaterThan(semgrepSection);
    });
  });

  describe("security-gate", () => {
    it("prefers Semgrep MCP over CLI", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Semgrep MCP");
    });

    it("uses semgrep_scan for full scan", () => {
      expect(SECURITY_GATE_PROMPT).toContain("semgrep_scan");
    });

    it("uses security_check for security analysis", () => {
      expect(SECURITY_GATE_PROMPT).toContain("security_check");
    });

    it("uses get_abstract_syntax_tree for AST analysis", () => {
      expect(SECURITY_GATE_PROMPT).toContain("get_abstract_syntax_tree");
    });

    it("CLI fallback appears after MCP preference", () => {
      const mcpPos = SECURITY_GATE_PROMPT.indexOf("Semgrep MCP bevorzugt");
      const cliPos = SECURITY_GATE_PROMPT.indexOf("Standard: CLI via a2p_run_sast");
      expect(mcpPos).toBeGreaterThan(-1);
      expect(cliPos).toBeGreaterThan(mcpPos);
    });
  });
});

// ─── GitHub MCP ──────────────────────────────────────────────────────────────
// Akzeptanzkriterium: GitHub MCP wird in planning und security-gate
// mit konkreten Aktionen referenziert.

describe("GitHub MCP integration", () => {
  describe("planning", () => {
    it("references GitHub Issues as slice input", () => {
      expect(PLANNING_PROMPT).toContain("GitHub");
      expect(PLANNING_PROMPT).toMatch(/GitHub.*Issues/);
    });

    it("links issues with slices", () => {
      expect(PLANNING_PROMPT).toMatch(/Issue.*Slice/i);
    });
  });

  describe("security-gate", () => {
    it("checks Dependabot alerts", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Dependabot");
    });

    it("checks Code Scanning alerts", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Code Scanning");
    });

    it("integrates alerts as findings", () => {
      expect(SECURITY_GATE_PROMPT).toContain("a2p_record_finding");
    });
  });
});

// ─── Stripe MCP ──────────────────────────────────────────────────────────────

describe("Stripe MCP integration", () => {
  describe("build-slice", () => {
    it("references Stripe MCP for payment slices", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Stripe MCP");
    });

    it("mentions Products and Prices", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Products");
      expect(BUILD_SLICE_PROMPT).toContain("Prices");
    });

    it("mentions Webhooks", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Webhooks");
    });

    it("validates webhook signatures", () => {
      expect(BUILD_SLICE_PROMPT).toMatch(/[Ww]ebhook.*[Ss]ignatur/);
    });
  });
});

// ─── Atlassian MCP ──────────────────────────────────────────────────────────

describe("Atlassian MCP integration", () => {
  describe("planning", () => {
    it("references Jira tickets as slice input", () => {
      expect(PLANNING_PROMPT).toContain("Jira");
    });

    it("links tickets with slices", () => {
      expect(PLANNING_PROMPT).toMatch(/Ticket.*Slice/i);
    });

    it("uses Sprint planning for prioritization", () => {
      expect(PLANNING_PROMPT).toContain("Sprint");
    });
  });
});

// ─── Sentry MCP ──────────────────────────────────────────────────────────────

describe("Sentry MCP integration", () => {
  describe("build-slice", () => {
    it("configures error tracking after GREEN", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Sentry MCP");
    });

    it("sets Sentry tags for slices", () => {
      expect(BUILD_SLICE_PROMPT).toContain("Sentry-Tags");
    });

    it("checks source maps upload", () => {
      expect(BUILD_SLICE_PROMPT).toMatch(/[Ss]ource [Mm]aps/);
    });
  });

  describe("security-gate", () => {
    it("checks Sentry configuration", () => {
      expect(SECURITY_GATE_PROMPT).toContain("Sentry");
    });

    it("checks DSN configuration", () => {
      expect(SECURITY_GATE_PROMPT).toContain("DSN");
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
    expect(ONBOARDING_PROMPT).toContain("@playwright/mcp");
  });

  it("installs Semgrep for all projects", () => {
    expect(ONBOARDING_PROMPT).toContain("pip install semgrep");
  });

  it("installs Bandit for Python projects", () => {
    expect(ONBOARDING_PROMPT).toContain("pip install bandit");
  });

  it("always sets up Git MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("uvx mcp-server-git");
  });

  it("always sets up Filesystem MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@modelcontextprotocol/server-filesystem");
  });

  it("always sets up Sequential Thinking MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@modelcontextprotocol/server-sequential-thinking");
  });

  it("always sets up Semgrep MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("semgrep mcp");
  });

  it("conditionally sets up GitHub MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("github-mcp-server");
  });

  it("does not reference Vercel as MCP (it is CLI-only)", () => {
    // Vercel has no official MCP server — deploy prompt uses vercel CLI
    expect(ONBOARDING_PROMPT).not.toMatch(/Vercel MCP.*command/);
  });

  it("conditionally sets up Cloudflare MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@cloudflare/mcp-server-cloudflare");
  });

  it("conditionally sets up Stripe MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@stripe/mcp");
  });

  it("conditionally sets up Atlassian MCP", () => {
    expect(ONBOARDING_PROMPT).toMatch(/Atlassian MCP/);
  });

  it("conditionally sets up Sentry MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@sentry/mcp-server");
  });

  it("conditionally sets up Upstash MCP", () => {
    expect(ONBOARDING_PROMPT).toContain("@upstash/mcp-server");
  });

  it("mentions Clerk as non-MCP tech stack option", () => {
    expect(ONBOARDING_PROMPT).toContain("Clerk");
  });

  it("mentions Resend as non-MCP tech stack option", () => {
    expect(ONBOARDING_PROMPT).toContain("Resend");
  });

  it("writes .mcp.json automatically", () => {
    expect(ONBOARDING_PROMPT).toContain(".mcp.json");
  });

  it("instructs user to restart Claude Code", () => {
    expect(ONBOARDING_PROMPT).toMatch(/[Ss]tarte Claude Code.*neu/);
  });

  it("shows security warning about third-party MCPs", () => {
    expect(ONBOARDING_PROMPT).toContain("Sicherheitshinweis");
    expect(ONBOARDING_PROMPT).toContain(".mcp.json");
  });

  it("asks user to verify unknown packages before enabling", () => {
    expect(ONBOARDING_PROMPT).toMatch(/[Pp]rüfe/);
    expect(ONBOARDING_PROMPT).toMatch(/npm|GitHub/);
  });

  it("distinguishes official from community MCPs", () => {
    expect(ONBOARDING_PROMPT).toContain("@modelcontextprotocol/*");
    expect(ONBOARDING_PROMPT).toContain("@playwright/mcp");
    expect(ONBOARDING_PROMPT).toMatch(/[Cc]ommunity/);
  });

  it("requires explicit user confirmation after security note", () => {
    expect(ONBOARDING_PROMPT).toMatch(/[Bb]estätige/);
  });
});

// ─── Anthropic engineering patterns in build-slice ──────────────────────────
// Akzeptanzkriterium: Build-Slice folgt dem Anthropic-Engineering-Ansatz:
// Explore → Plan → Code → Verify, Rollen-Trennung, Scope-Lock, Evidence-based.

describe("Anthropic engineering patterns in build-slice", () => {
  it("has explore phase before TDD cycle", () => {
    const explorePos = BUILD_SLICE_PROMPT.indexOf("Phase EXPLORE");
    const tddPos = BUILD_SLICE_PROMPT.indexOf("Evidence-Driven Development Cycle");
    expect(explorePos).toBeGreaterThan(-1);
    expect(explorePos).toBeLessThan(tddPos);
  });

  it("has slice spec section between EXPLORE and RED", () => {
    const specPos = BUILD_SLICE_PROMPT.indexOf("Slice-Spezifikation");
    const redPos = BUILD_SLICE_PROMPT.indexOf("### Phase RED");
    const exploreEnd = BUILD_SLICE_PROMPT.indexOf("Evidence-Driven Development Cycle");
    expect(specPos).toBeGreaterThan(-1);
    expect(specPos).toBeLessThan(redPos);
    expect(specPos).toBeLessThan(exploreEnd);
  });

  it("slice spec requires spec-test-mapping and initial-rot-hypothese", () => {
    const specPos = BUILD_SLICE_PROMPT.indexOf("Slice-Spezifikation");
    const redPos = BUILD_SLICE_PROMPT.indexOf("### Phase RED");
    const section = BUILD_SLICE_PROMPT.slice(specPos, redPos);
    expect(section).toContain("Spec-Test-Mapping");
    expect(section).toContain("Initial-Rot-Hypothese");
    expect(section).toContain("Minimale grüne Änderung");
  });

  it("summary template includes TDD-Abweichungen and Spec-Test-Mapping", () => {
    const summaryPos = BUILD_SLICE_PROMPT.indexOf("Nach jedem abgeschlossenen Slice");
    const checkpointPos = BUILD_SLICE_PROMPT.indexOf("Checkpoint nach Slice-Completion");
    const section = BUILD_SLICE_PROMPT.slice(summaryPos, checkpointPos);
    expect(section).toContain("Spec-Test-Mapping");
    expect(section).toContain("TDD-Abweichungen");
  });

  it("invariants section separates code-enforced from prompt-guided", () => {
    const invPos = BUILD_SLICE_PROMPT.indexOf("## Invarianten");
    const section = BUILD_SLICE_PROMPT.slice(invPos);
    expect(section).toContain("Code-enforced");
    expect(section).toContain("Prompt-guided");
  });

  it("has scope-lock section that prevents feature creep", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Scope-Lock");
    expect(BUILD_SLICE_PROMPT).toContain("Keine neuen Features im GREEN");
    expect(BUILD_SLICE_PROMPT).toMatch(/Keine.*Umbauten.*REFACTOR/);
  });

  it("requires test-writer subagent for RED phase (not optional)", () => {
    const redSection = BUILD_SLICE_PROMPT.indexOf("Phase RED");
    const greenSection = BUILD_SLICE_PROMPT.indexOf("Phase GREEN");
    const section = BUILD_SLICE_PROMPT.slice(redSection, greenSection);
    expect(section).toContain("test-writer");
    // Must NOT say "idealerweise" — role separation is mandatory
    expect(section).not.toContain("idealerweise");
  });

  it("includes engineering loop with explore and evidence", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Engineering Loop");
    expect(BUILD_SLICE_PROMPT).toContain("Explore");
    expect(BUILD_SLICE_PROMPT).toContain("Evidence over narration");
  });

  it("preserves sequential TDD core: RED → GREEN → REFACTOR", () => {
    const redPos = BUILD_SLICE_PROMPT.indexOf("### Phase RED");
    const greenPos = BUILD_SLICE_PROMPT.indexOf("### Phase GREEN");
    const refactorPos = BUILD_SLICE_PROMPT.indexOf("### Phase REFACTOR");
    expect(redPos).toBeLessThan(greenPos);
    expect(greenPos).toBeLessThan(refactorPos);
  });

  it("SAST findings are fixed in place with re-verification", () => {
    const sastSection = BUILD_SLICE_PROMPT.indexOf("Phase SAST");
    const endSection = BUILD_SLICE_PROMPT.indexOf("## Nach jedem", sastSection);
    const section = BUILD_SLICE_PROMPT.slice(sastSection, endSection);
    expect(section).toContain("fixen");
    expect(section).toContain("wiederholen");
  });

  it("invariants section enforces scope rule", () => {
    expect(BUILD_SLICE_PROMPT).toContain("Invarianten");
    expect(BUILD_SLICE_PROMPT).toMatch(/Scope.*Slice/);
  });

  it("git commits are proper phase-end steps", () => {
    const gitSection = BUILD_SLICE_PROMPT.indexOf("Git-Commits");
    expect(gitSection).toBeGreaterThan(-1);
    const sectionEnd = BUILD_SLICE_PROMPT.indexOf("\n## ", gitSection + 5);
    const block = BUILD_SLICE_PROMPT.slice(gitSection, sectionEnd > -1 ? sectionEnd : undefined);
    // Should mention committing after each phase
    expect(block).toContain("Nach RED");
    expect(block).toContain("Nach GREEN");
    expect(block).toContain("Nach REFACTOR");
  });

  it("explore phase contains all three codebase-memory tools", () => {
    const explorePos = BUILD_SLICE_PROMPT.indexOf("Phase EXPLORE");
    const tddPos = BUILD_SLICE_PROMPT.indexOf("Evidence-Driven Development Cycle");
    const section = BUILD_SLICE_PROMPT.slice(explorePos, tddPos);
    expect(section).toContain("index_repository");
    expect(section).toContain("search_code");
    expect(section).toContain("trace_call_path");
  });
});

// ─── Enforcement rules in build-slice ───────────────────────────────────────
// Akzeptanzkriterium: SAST, Visual Verification und Review Checkpoints
// werden erzwungen, nicht nur vorgeschlagen.

describe("Enforcement rules in build-slice", () => {
  it("SAST phase enforces a2p_run_sast as mandatory", () => {
    const sastSection = BUILD_SLICE_PROMPT.indexOf("Phase SAST");
    const nextSection = BUILD_SLICE_PROMPT.indexOf("## Nach jedem", sastSection);
    const section = BUILD_SLICE_PROMPT.slice(sastSection, nextSection);
    expect(section).toContain("MUSST");
    expect(section).toContain("a2p_run_sast");
    expect(section).toMatch(/NICHT.*[Üü]berspringen|PFLICHT/);
  });

  it("Visual Verification is recommended for hasUI slices — honest about enforcement", () => {
    const visualSection = BUILD_SLICE_PROMPT.indexOf("Visual Verification");
    const refactorSection = BUILD_SLICE_PROMPT.indexOf("Phase REFACTOR");
    const section = BUILD_SLICE_PROMPT.slice(visualSection, refactorSection);
    expect(section).toContain("EMPFOHLEN");
    expect(section).toContain("kein Code-Gate");
    expect(section).toContain("browser_take_screenshot");
    expect(section).toContain("browser_navigate");
  });

  it("review checkpoint is a hard stop — not negotiable", () => {
    const checkpointSection = BUILD_SLICE_PROMPT.indexOf("Checkpoint nach Slice-Completion");
    const nextSection = BUILD_SLICE_PROMPT.indexOf("## Git-Commits", checkpointSection);
    const section = BUILD_SLICE_PROMPT.slice(checkpointSection, nextSection);
    expect(section).toContain("HARD STOP");
    expect(section).toContain("NICHT verhandelbar");
    expect(section).toContain("awaitingHumanReview");
    // Must explicitly say: don't continue even if user said "do everything"
    expect(section).toMatch(/auch wenn.*User/i);
  });
});

// ─── Enforcement rules in onboarding ────────────────────────────────────────

describe("Enforcement rules in onboarding", () => {
  it("UI-Design checkpoint is recommended for frontend projects (honest about enforcement)", () => {
    const uiSection = ONBOARDING_PROMPT.indexOf("UI-Design erfassen");
    expect(uiSection).toBeGreaterThan(-1);
    const nextSection = ONBOARDING_PROMPT.indexOf("Frage den User", uiSection);
    const section = ONBOARDING_PROMPT.slice(uiSection, nextSection);
    expect(section).toContain("EMPFOHLEN");
    expect(section).toContain("kein Code-Gate");
  });

  it("companions setup is recommended — honest about enforcement", () => {
    const companionSection = ONBOARDING_PROMPT.indexOf("Companions einrichten");
    expect(companionSection).toBeGreaterThan(-1);
    const nextSection = ONBOARDING_PROMPT.indexOf("**IMMER installieren", companionSection);
    const section = ONBOARDING_PROMPT.slice(companionSection, nextSection);
    expect(section).toContain("EMPFOHLEN");
    expect(section).toContain("kein Code-Gate");
  });

  it("prerequisites check analyzes architecture for required local services", () => {
    expect(ONBOARDING_PROMPT).toContain("Prerequisites-Check");
    expect(ONBOARDING_PROMPT).toContain("Docker Desktop");
    expect(ONBOARDING_PROMPT).toContain("Datenbank-Server");
    expect(ONBOARDING_PROMPT).toContain("Emulatoren");
    // Must tell user what to start
    expect(ONBOARDING_PROMPT).toMatch(/stelle sicher.*läuft/i);
  });

  it("prerequisites check comes before the final handoff", () => {
    const prereqPos = ONBOARDING_PROMPT.indexOf("Prerequisites-Check");
    const handoffPos = ONBOARDING_PROMPT.indexOf("Abschluss: Nahtloser Übergang");
    expect(prereqPos).toBeGreaterThan(-1);
    expect(prereqPos).toBeLessThan(handoffPos);
  });

  it("Oversight checkpoint is recommended — honest about enforcement", () => {
    const reviewSection = ONBOARDING_PROMPT.indexOf("Human Oversight konfigurieren");
    expect(reviewSection).toBeGreaterThan(-1);
    const sectionEnd = ONBOARDING_PROMPT.indexOf("### Architektur festhalten", reviewSection);
    const section = ONBOARDING_PROMPT.slice(reviewSection, sectionEnd);
    expect(section).toContain("EMPFOHLEN");
    expect(section).toContain("kein Code-Gate");
  });
});

// ─── MCP operationalization in prompts ───────────────────────────────────────

describe("MCP operationalization in prompts", () => {
  it("planning prompt references companionReadiness for codebase-memory", () => {
    expect(PLANNING_PROMPT).toContain("companionReadiness.codebaseMemory");
  });

  it("planning prompt references companionReadiness for database", () => {
    expect(PLANNING_PROMPT).toContain("companionReadiness.database");
  });

  it("build-slice prompt references companionReadiness for codebase-memory", () => {
    expect(BUILD_SLICE_PROMPT).toContain("companionReadiness.codebaseMemory");
  });

  it("build-slice prompt references companionReadiness for database", () => {
    expect(BUILD_SLICE_PROMPT).toContain("companionReadiness.database");
  });
});
