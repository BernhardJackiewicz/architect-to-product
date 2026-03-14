import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SERVER_NAME, SERVER_VERSION } from "./utils/constants.js";

// Tools
import { getStateSchema, handleGetState } from "./tools/get-state.js";
import { initProjectSchema, handleInitProject } from "./tools/init-project.js";
import { setArchitectureSchema, handleSetArchitecture } from "./tools/set-architecture.js";
import { setupCompanionsSchema, handleSetupCompanions } from "./tools/setup-companions.js";
import { createBuildPlanSchema, handleCreateBuildPlan } from "./tools/create-build-plan.js";
import { updateSliceSchema, handleUpdateSlice } from "./tools/update-slice.js";
import { runTestsSchema, handleRunTests } from "./tools/run-tests.js";
import { runSastSchema, handleRunSast } from "./tools/run-sast.js";
import { recordFindingSchema, handleRecordFinding } from "./tools/record-finding.js";
import { runQualitySchema, handleRunQuality } from "./tools/run-quality.js";
import { runE2eSchema, handleRunE2e } from "./tools/run-e2e.js";
import { generateDeploymentSchema, handleGenerateDeployment } from "./tools/generate-deployment.js";
import { getChecklistSchema, handleGetChecklist } from "./tools/get-checklist.js";
import { completePhaseSchema, handleCompletePhase } from "./tools/complete-phase.js";
import { addSliceSchema, handleAddSlice } from "./tools/add-slice.js";
import { getBuildLogSchema, handleGetBuildLog } from "./tools/get-build-log.js";
import { runAuditSchema, handleRunAudit } from "./tools/run-audit.js";
import { runWhiteboxAuditSchema, handleRunWhiteboxAudit } from "./tools/run-whitebox-audit.js";
import { runActiveVerificationSchema, handleRunActiveVerification } from "./tools/run-active-verification.js";
import { buildSignoffSchema, handleBuildSignoff } from "./tools/build-signoff.js";
import { deployApprovalSchema, handleDeployApproval } from "./tools/deploy-approval.js";

// Prompts
import { ONBOARDING_PROMPT } from "./prompts/onboarding.js";
import { PLANNING_PROMPT } from "./prompts/planning.js";
import { BUILD_SLICE_PROMPT } from "./prompts/build-slice.js";
import { REFACTOR_PROMPT } from "./prompts/refactor.js";
import { E2E_TESTING_PROMPT } from "./prompts/e2e-testing.js";
import { SECURITY_GATE_PROMPT } from "./prompts/security-gate.js";
import { DEPLOY_PROMPT } from "./prompts/deploy.js";
import { AUDIT_PROMPT } from "./prompts/audit.js";
import { WHITEBOX_PROMPT } from "./prompts/whitebox.js";

// Resources
import { StateManager } from "./state/state-manager.js";

type ToolHandler = (input: Record<string, unknown>) => string;

function wrapTool(handler: ToolHandler) {
  return async (input: Record<string, unknown>) => {
    try {
      const result = handler(input as any);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: msg }) }],
        isError: true,
      };
    }
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  // ===== TOOLS =====

  server.tool(
    "a2p_get_state",
    "Read current project state: phase, progress, slices, companions",
    { projectPath: getStateSchema.shape.projectPath },
    wrapTool(handleGetState as ToolHandler)
  );

  server.tool(
    "a2p_init_project",
    "Initialize a new project with CLAUDE.md, hooks, agents, and state file",
    {
      projectPath: initProjectSchema.shape.projectPath,
      projectName: initProjectSchema.shape.projectName,
    },
    wrapTool(handleInitProject as ToolHandler)
  );

  server.tool(
    "a2p_set_architecture",
    "Set the project architecture (tech stack, features, data model, API design)",
    {
      projectPath: setArchitectureSchema.shape.projectPath,
      name: setArchitectureSchema.shape.name,
      description: setArchitectureSchema.shape.description,
      language: setArchitectureSchema.shape.language,
      framework: setArchitectureSchema.shape.framework,
      database: setArchitectureSchema.shape.database,
      frontend: setArchitectureSchema.shape.frontend,
      hosting: setArchitectureSchema.shape.hosting,
      otherTech: setArchitectureSchema.shape.otherTech,
      features: setArchitectureSchema.shape.features,
      dataModel: setArchitectureSchema.shape.dataModel,
      apiDesign: setArchitectureSchema.shape.apiDesign,
      rawArchitecture: setArchitectureSchema.shape.rawArchitecture,
      claudeModel: setArchitectureSchema.shape.claudeModel,
      reviewMode: setArchitectureSchema.shape.reviewMode,
      oversight: setArchitectureSchema.shape.oversight,
      uiDesign: setArchitectureSchema.shape.uiDesign,
      phases: setArchitectureSchema.shape.phases,
    },
    wrapTool(handleSetArchitecture as ToolHandler)
  );

  server.tool(
    "a2p_setup_companions",
    "Install and register companion MCP servers (database, playwright, codebase-memory)",
    {
      projectPath: setupCompanionsSchema.shape.projectPath,
      companions: setupCompanionsSchema.shape.companions,
    },
    wrapTool(handleSetupCompanions as ToolHandler)
  );

  server.tool(
    "a2p_create_build_plan",
    "Break architecture into ordered vertical slices with acceptance criteria",
    {
      projectPath: createBuildPlanSchema.shape.projectPath,
      slices: createBuildPlanSchema.shape.slices,
      append: createBuildPlanSchema.shape.append,
    },
    wrapTool(handleCreateBuildPlan as ToolHandler)
  );

  server.tool(
    "a2p_complete_phase",
    "Complete current product phase and advance to next (multi-phase projects only)",
    {
      projectPath: completePhaseSchema.shape.projectPath,
    },
    wrapTool(handleCompletePhase as ToolHandler)
  );

  server.tool(
    "a2p_add_slice",
    "Add a single slice to the existing build plan mid-project (e.g. integration slices)",
    {
      projectPath: addSliceSchema.shape.projectPath,
      slice: addSliceSchema.shape.slice,
      insertAfterSliceId: addSliceSchema.shape.insertAfterSliceId,
    },
    wrapTool(handleAddSlice as ToolHandler)
  );

  server.tool(
    "a2p_update_slice",
    "Update a slice's status (red/green/refactor/sast/done) with transition validation",
    {
      projectPath: updateSliceSchema.shape.projectPath,
      sliceId: updateSliceSchema.shape.sliceId,
      status: updateSliceSchema.shape.status,
      files: updateSliceSchema.shape.files,
    },
    wrapTool(handleUpdateSlice as ToolHandler)
  );

  server.tool(
    "a2p_run_tests",
    "Execute the test command and record results (pass/fail counts, output)",
    {
      projectPath: runTestsSchema.shape.projectPath,
      sliceId: runTestsSchema.shape.sliceId,
      command: runTestsSchema.shape.command,
      timeoutMs: runTestsSchema.shape.timeoutMs,
    },
    wrapTool(handleRunTests as ToolHandler)
  );

  server.tool(
    "a2p_run_sast",
    "Run SAST security scan (Semgrep + Bandit). mode=slice for changed files, mode=full for entire codebase",
    {
      projectPath: runSastSchema.shape.projectPath,
      sliceId: runSastSchema.shape.sliceId,
      mode: runSastSchema.shape.mode,
      files: runSastSchema.shape.files,
    },
    wrapTool(handleRunSast as ToolHandler)
  );

  server.tool(
    "a2p_record_finding",
    "Record a security finding with severity, location, and fix suggestion",
    {
      projectPath: recordFindingSchema.shape.projectPath,
      sliceId: recordFindingSchema.shape.sliceId,
      id: recordFindingSchema.shape.id,
      tool: recordFindingSchema.shape.tool,
      severity: recordFindingSchema.shape.severity,
      status: recordFindingSchema.shape.status,
      title: recordFindingSchema.shape.title,
      file: recordFindingSchema.shape.file,
      line: recordFindingSchema.shape.line,
      description: recordFindingSchema.shape.description,
      fix: recordFindingSchema.shape.fix,
    },
    wrapTool(handleRecordFinding as ToolHandler)
  );

  server.tool(
    "a2p_run_quality",
    "Record code quality issues found via codebase-memory-mcp (dead code, redundancy, coupling)",
    {
      projectPath: runQualitySchema.shape.projectPath,
      issues: runQualitySchema.shape.issues,
    },
    wrapTool(handleRunQuality as ToolHandler)
  );

  server.tool(
    "a2p_run_e2e",
    "Record E2E test results from Playwright MCP (scenarios, screenshots, pass/fail)",
    {
      projectPath: runE2eSchema.shape.projectPath,
      baseUrl: runE2eSchema.shape.baseUrl,
      scenarios: runE2eSchema.shape.scenarios,
    },
    wrapTool(handleRunE2e as ToolHandler)
  );

  server.tool(
    "a2p_generate_deployment",
    "Get deployment guidance and file list for the project's tech stack",
    { projectPath: generateDeploymentSchema.shape.projectPath },
    wrapTool(handleGenerateDeployment as ToolHandler)
  );

  server.tool(
    "a2p_get_checklist",
    "Get pre/post-deployment checklist specific to the project's tech stack",
    { projectPath: getChecklistSchema.shape.projectPath },
    wrapTool(handleGetChecklist as ToolHandler)
  );

  server.tool(
    "a2p_get_build_log",
    "Get chronological workflow log from build history. Filterable by phase, slice, action type.",
    {
      projectPath: getBuildLogSchema.shape.projectPath,
      filter: getBuildLogSchema.shape.filter,
      sliceId: getBuildLogSchema.shape.sliceId,
      phase: getBuildLogSchema.shape.phase,
      limit: getBuildLogSchema.shape.limit,
    },
    wrapTool(handleGetBuildLog as ToolHandler)
  );

  server.tool(
    "a2p_run_audit",
    "Run code audit: quality (dev hygiene every ~5-10 commits) or release (pre-publish checks)",
    {
      projectPath: runAuditSchema.shape.projectPath,
      mode: runAuditSchema.shape.mode,
      runBuild: runAuditSchema.shape.runBuild,
      runTests: runAuditSchema.shape.runTests,
    },
    wrapTool(handleRunAudit as ToolHandler)
  );

  server.tool(
    "a2p_run_whitebox_audit",
    "Run whitebox security audit: analyze whether SAST findings are actually exploitable (reachable paths, guards, trust boundaries)",
    {
      projectPath: runWhiteboxAuditSchema.shape.projectPath,
      mode: runWhiteboxAuditSchema.shape.mode,
      files: runWhiteboxAuditSchema.shape.files,
    },
    wrapTool(handleRunWhiteboxAudit as ToolHandler)
  );

  server.tool(
    "a2p_run_active_verification",
    "Run active verification: test runtime-enforced invariants (workflow gates, state recovery, deployment gates)",
    {
      projectPath: runActiveVerificationSchema.shape.projectPath,
      round: runActiveVerificationSchema.shape.round,
      categories: runActiveVerificationSchema.shape.categories,
    },
    wrapTool(handleRunActiveVerification as ToolHandler)
  );

  server.tool(
    "a2p_build_signoff",
    "Confirm build signoff — human verified the product works (mandatory before security phase)",
    {
      projectPath: buildSignoffSchema.shape.projectPath,
      note: buildSignoffSchema.shape.note,
    },
    wrapTool(handleBuildSignoff as ToolHandler)
  );

  server.tool(
    "a2p_deploy_approval",
    "Approve deployment — human confirmed ready to deploy (mandatory before generating deployment configs)",
    {
      projectPath: deployApprovalSchema.shape.projectPath,
      note: deployApprovalSchema.shape.note,
    },
    wrapTool(handleDeployApproval as ToolHandler)
  );

  // ===== PROMPTS =====

  server.prompt("a2p", "architect-to-product onboarding: When the user says 'a2p', 'onboarding', 'start project', or 'new project' — use THIS prompt to guide them through architecture definition, tech stack selection, UI design, and project setup. This is the entry point for architect-to-product.", () => ({
    messages: [{ role: "user", content: { type: "text", text: ONBOARDING_PROMPT } }],
  }));

  server.prompt("a2p_planning", "architect-to-product planning: When the user says 'a2p planning', 'create slices', or 'build plan' — use THIS prompt to break the architecture into ordered vertical slices with acceptance criteria.", () => ({
    messages: [{ role: "user", content: { type: "text", text: PLANNING_PROMPT } }],
  }));

  server.prompt("a2p_build_slice", "architect-to-product build: When the user says 'a2p build', 'build slice', or 'next slice' — use THIS prompt to build the current slice with TDD: RED → GREEN → REFACTOR → SAST.", () => ({
    messages: [{ role: "user", content: { type: "text", text: BUILD_SLICE_PROMPT } }],
  }));

  server.prompt("a2p_refactor", "architect-to-product refactor: When the user says 'a2p refactor' — use THIS prompt to analyze codebase for dead code, redundancy, and coupling via codebase-memory.", () => ({
    messages: [{ role: "user", content: { type: "text", text: REFACTOR_PROMPT } }],
  }));

  server.prompt("a2p_e2e_testing", "architect-to-product e2e: When the user says 'a2p e2e' or 'e2e tests' — use THIS prompt to run visual E2E tests with Playwright MCP.", () => ({
    messages: [{ role: "user", content: { type: "text", text: E2E_TESTING_PROMPT } }],
  }));

  server.prompt("a2p_security_gate", "architect-to-product security: When the user says 'a2p security' or 'security gate' — use THIS prompt for full SAST scan + OWASP Top 10 manual review.", () => ({
    messages: [{ role: "user", content: { type: "text", text: SECURITY_GATE_PROMPT } }],
  }));

  server.prompt("a2p_deploy", "architect-to-product deploy: When the user says 'a2p deploy' or 'deployment' — use THIS prompt to generate production deployment configs and deployment guide.", () => ({
    messages: [{ role: "user", content: { type: "text", text: DEPLOY_PROMPT } }],
  }));

  server.prompt("a2p_whitebox", "architect-to-product whitebox: When the user says 'a2p whitebox', 'whitebox audit', or 'active verification' — use THIS prompt for exploitability analysis of SAST findings + runtime gate verification.", () => ({
    messages: [{ role: "user", content: { type: "text", text: WHITEBOX_PROMPT } }],
  }));

  server.prompt("a2p_audit", "architect-to-product audit: When the user says 'a2p audit', 'quality audit', or 'release audit' — use THIS prompt for code hygiene checks (quality mode) or pre-release verification (release mode).", () => ({
    messages: [{ role: "user", content: { type: "text", text: AUDIT_PROMPT } }],
  }));

  // ===== RESOURCES =====

  server.resource(
    "a2p://plan",
    "a2p://plan",
    { description: "Current build plan with slice statuses" },
    async () => {
      // Try to find the project path from a common location
      const projectPath = process.env.A2P_PROJECT_PATH ?? process.cwd();
      const sm = new StateManager(projectPath);
      if (!sm.exists()) {
        return { contents: [{ uri: "a2p://plan", text: "No project initialized." }] };
      }
      const state = sm.read();
      const plan = state.slices.map((s, i) => `${i + 1}. [${s.status.toUpperCase()}] ${s.name}: ${s.description}`);
      return {
        contents: [
          {
            uri: "a2p://plan",
            text: `# Build Plan: ${state.projectName}\n\n${plan.join("\n")}\n\nPhase: ${state.phase}`,
          },
        ],
      };
    }
  );

  server.resource(
    "a2p://progress",
    "a2p://progress",
    { description: "Progress dashboard: slices, tests, findings" },
    async () => {
      const projectPath = process.env.A2P_PROJECT_PATH ?? process.cwd();
      const sm = new StateManager(projectPath);
      if (!sm.exists()) {
        return { contents: [{ uri: "a2p://progress", text: "No project initialized." }] };
      }
      const progress = sm.getProgress();
      const text = [
        `# Progress: ${progress.phase}`,
        `Slices: ${progress.doneSlices}/${progress.totalSlices} done`,
        `Current: ${progress.currentSlice ?? "none"}`,
        `Tests: ${progress.testsPassed} passed, ${progress.testsFailed} failed`,
        `Open SAST findings: ${progress.openFindings}`,
        `Open quality issues: ${progress.qualityIssues}`,
      ].join("\n");
      return { contents: [{ uri: "a2p://progress", text }] };
    }
  );

  server.resource(
    "a2p://sast-report",
    "a2p://sast-report",
    { description: "All SAST and security findings" },
    async () => {
      const projectPath = process.env.A2P_PROJECT_PATH ?? process.cwd();
      const sm = new StateManager(projectPath);
      if (!sm.exists()) {
        return { contents: [{ uri: "a2p://sast-report", text: "No project initialized." }] };
      }
      const state = sm.read();
      const findings = state.slices.flatMap((s) => s.sastFindings);
      if (findings.length === 0) {
        return { contents: [{ uri: "a2p://sast-report", text: "No SAST findings yet." }] };
      }
      const lines = findings.map(
        (f) => `[${f.severity.toUpperCase()}] [${f.status}] ${f.title} — ${f.file}:${f.line}`
      );
      return {
        contents: [
          {
            uri: "a2p://sast-report",
            text: `# SAST Report\n\n${findings.length} findings:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  server.resource(
    "a2p://quality",
    "a2p://quality",
    { description: "Code quality report: dead code, duplicates, coupling metrics" },
    async () => {
      const projectPath = process.env.A2P_PROJECT_PATH ?? process.cwd();
      const sm = new StateManager(projectPath);
      if (!sm.exists()) {
        return { contents: [{ uri: "a2p://quality", text: "No project initialized." }] };
      }
      const state = sm.read();
      if (state.qualityIssues.length === 0) {
        return { contents: [{ uri: "a2p://quality", text: "No quality issues recorded." }] };
      }
      const lines = state.qualityIssues.map(
        (q) => `[${q.type}] [${q.status}] ${q.symbol} — ${q.file}: ${q.description}`
      );
      return {
        contents: [
          {
            uri: "a2p://quality",
            text: `# Quality Report\n\n${state.qualityIssues.length} issues:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  return server;
}
