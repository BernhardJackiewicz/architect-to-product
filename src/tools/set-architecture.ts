import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";
import type { Architecture, TechStack, ProductPhase, ReviewMode, UIDesign, OversightConfig, BackupTarget, BackupOffsiteProvider } from "../state/types.js";

export const setArchitectureSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  name: z.string().describe("Project/product name"),
  description: z.string().describe("What does this product do? (1-3 sentences)"),
  language: z.string().describe("Primary programming language (e.g. Python, TypeScript, Go)"),
  framework: z.string().describe("Main framework (e.g. FastAPI, Next.js, Express)"),
  database: z.string().optional().describe("Database if any (e.g. Supabase, SQLite, PostgreSQL)"),
  frontend: z.string().optional().describe("Frontend framework if any (e.g. React, Vue, Svelte)"),
  hosting: z.string().optional().describe("Hosting target (e.g. Hetzner, Vercel, Railway)"),
  otherTech: z.array(z.string()).optional().describe("Other technologies (e.g. Stripe, Firebase Auth)"),
  features: z.array(z.string()).min(1).describe("List of features to build"),
  dataModel: z.string().describe("Data model description (tables, entities, relationships)"),
  apiDesign: z.string().describe("API design (REST, GraphQL, RPC, etc.)"),
  rawArchitecture: z.string().optional().describe("Full architecture document if available"),
  reviewMode: z
    .enum(["off", "all", "ui-only"])
    .optional()
    .describe("Review mode: 'off' (default), 'all' (pause after every slice), 'ui-only' (pause only after UI slices)"),
  uiDesign: z
    .object({
      description: z.string().describe("Overall UI vision: layout, navigation, key screens, look & feel"),
      style: z.string().optional().describe("Design style (e.g. 'minimal', 'corporate', 'playful', 'dashboard')"),
      references: z
        .array(
          z.object({
            type: z
              .enum(["description", "wireframe", "mockup", "screenshot", "file"])
              .describe("Type of reference"),
            path: z.string().optional().describe("Absolute file path to image or design file"),
            description: z.string().describe("What this reference shows or describes"),
          })
        )
        .describe("Wireframes, mockups, screenshots, or text descriptions of UI elements"),
    })
    .optional()
    .describe("UI design spec: text description, style, and references to wireframes/mockups/images"),
  claudeModel: z
    .enum(["opus", "sonnet", "haiku"])
    .optional()
    .default("opus")
    .describe("Which Claude model does the programming. Default: opus (Claude Opus 4.6 with maximum effort)"),
  oversight: z
    .object({
      sliceReview: z.enum(["off", "all", "ui-only"]).optional().default("off").describe("Pause after slice completion: 'off', 'all', or 'ui-only'"),
      planApproval: z.boolean().optional().default(true).describe("Must approve slice plan before building (default: true)"),
      buildSignoff: z.boolean().optional().default(true).describe("Must confirm product works after building (MANDATORY, always true)"),
      deployApproval: z.boolean().optional().default(true).describe("Must confirm before deploy (MANDATORY, always true)"),
      securitySignoff: z.boolean().optional().default(false).describe("Explicit go/no-go after security gate (default: false)"),
    })
    .optional()
    .describe("Human oversight configuration — controls where the workflow pauses for human review"),
  phases: z
    .array(
      z.object({
        id: z.string().describe("Phase ID (e.g. phase-0, phase-1)"),
        name: z.string().describe("Phase name (e.g. Foundations/Spikes, MVP)"),
        description: z.string().describe("What this phase achieves"),
        deliverables: z.array(z.string()).describe("Features/deliverables for this phase"),
        timeline: z.string().describe("Timeline (e.g. Weeks 1-8)"),
      })
    )
    .optional()
    .describe("Product phases if the architecture defines multiple phases/milestones"),
});

export type SetArchitectureInput = z.infer<typeof setArchitectureSchema>;

export function handleSetArchitecture(input: SetArchitectureInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const techStack: TechStack = {
    language: input.language,
    framework: input.framework,
    database: input.database ?? null,
    frontend: input.frontend ?? null,
    hosting: input.hosting ?? null,
    other: input.otherTech ?? [],
  };

  const phases: ProductPhase[] | undefined = input.phases?.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    deliverables: p.deliverables,
    timeline: p.timeline,
  }));

  const architecture: Architecture = {
    name: input.name,
    description: input.description,
    techStack,
    features: input.features,
    dataModel: input.dataModel,
    apiDesign: input.apiDesign,
    raw: input.rawArchitecture ?? "",
    ...(phases ? { phases } : {}),
    ...(input.reviewMode ? { reviewMode: input.reviewMode } : {}),
    ...(input.oversight ? {
      oversight: {
        sliceReview: input.oversight.sliceReview ?? input.reviewMode ?? "off",
        planApproval: input.oversight.planApproval ?? true,
        buildSignoff: true,    // MANDATORY — always true, cannot be disabled
        deployApproval: true,  // MANDATORY — always true, cannot be disabled
        securitySignoff: input.oversight.securitySignoff ?? false,
      } satisfies OversightConfig,
      reviewMode: input.oversight.sliceReview ?? input.reviewMode ?? "off", // sync for backward compat
    } : {}),
    ...(input.uiDesign ? { uiDesign: input.uiDesign } : {}),
  };

  sm.setArchitecture(architecture);

  // Store model preference in config
  if (input.claudeModel) {
    sm.updateConfig({ claudeModel: input.claudeModel });
  }

  // Backup inference
  const hasDatabase = !!techStack.database;
  const allFeaturesLower = [...(input.otherTech ?? []), ...input.features]
    .map(f => f.toLowerCase()).join(" ");
  const hasUploads = /upload|file.?storage|media|image|blob/.test(allFeaturesLower);
  const isStateful = hasDatabase || hasUploads;

  const backupTargets: BackupTarget[] = ["deploy_artifacts"];
  if (hasDatabase) backupTargets.push("database");
  if (hasUploads) {
    backupTargets.push("uploads");
    backupTargets.push("local_media");
  }

  let offsiteProvider: BackupOffsiteProvider = "none";
  if (input.hosting) {
    const hostingLower = input.hosting.toLowerCase();
    if (hostingLower.includes("hetzner")) offsiteProvider = "hetzner_storage";
    else if (hostingLower.includes("aws")) offsiteProvider = "s3";
    else if (hostingLower.includes("digitalocean")) offsiteProvider = "spaces";
  }

  sm.setBackupConfig({
    enabled: true,
    required: isStateful,
    schedule: "daily",
    time: "02:00",
    retentionDays: 14,
    targets: backupTargets,
    offsiteProvider,
    verifyAfterBackup: isStateful,
    preDeploySnapshot: isStateful,
  });

  // Detect what companions are needed
  const suggestedCompanions: string[] = ["codebase-memory-mcp"];

  // ALWAYS-ON MCPs
  suggestedCompanions.push("mcp-server-git (via uvx)");
  suggestedCompanions.push("@modelcontextprotocol/server-filesystem");
  suggestedCompanions.push("@modelcontextprotocol/server-sequential-thinking");
  suggestedCompanions.push("semgrep mcp");

  // GitHub MCP — if the project has a GitHub remote
  suggestedCompanions.push("github-mcp-server (if GitHub repo)");

  // Database MCPs
  if (techStack.database) {
    const db = techStack.database.toLowerCase();
    if (db.includes("supabase")) suggestedCompanions.push("supabase-mcp");
    else if (db.includes("postgres")) suggestedCompanions.push("@modelcontextprotocol/server-postgres");
    else if (db.includes("sqlite")) suggestedCompanions.push("@modelcontextprotocol/server-sqlite");
    else if (db.includes("mysql") || db.includes("mariadb")) suggestedCompanions.push("@benborla29/mcp-server-mysql (community — bitte vor Nutzung prüfen)");
    else if (db.includes("mongo")) suggestedCompanions.push("@mongodb-js/mongodb-mcp-server");
  } else {
    suggestedCompanions.push("supabase-mcp (recommended default)");
  }

  if (techStack.frontend) {
    suggestedCompanions.push("playwright-mcp (for E2E testing)");
  }

  // Hosting-specific MCPs
  const hosting = techStack.hosting?.toLowerCase() ?? "";
  const framework = techStack.framework.toLowerCase();
  if (hosting.includes("vercel") || framework.includes("next")) {
    suggestedCompanions.push("vercel (Vercel MCP)");
  }
  if (hosting.includes("cloudflare") || hosting.includes("workers")) {
    suggestedCompanions.push("@cloudflare/mcp-server-cloudflare");
  }

  // Feature-specific MCPs
  const allFeatures = [...techStack.other, ...architecture.features].map((f) => f.toLowerCase()).join(" ");
  if (allFeatures.match(/payment|stripe|billing/)) {
    suggestedCompanions.push("@stripe/mcp");
  }
  if (allFeatures.match(/jira|confluence|atlassian/)) {
    suggestedCompanions.push("atlassian-mcp (Remote OAuth)");
  }
  if (allFeatures.match(/sentry|error.?tracking/)) {
    suggestedCompanions.push("@sentry/mcp-server");
  }
  if (allFeatures.match(/upstash|redis serverless/)) {
    suggestedCompanions.push("@upstash/mcp-server");
  }

  // Non-MCP services detected (included in suggestions for awareness)
  if (allFeatures.match(/clerk/)) {
    suggestedCompanions.push("Clerk (no MCP — API integration, checklist items added)");
  }
  if (allFeatures.match(/resend|email/)) {
    suggestedCompanions.push("Resend (no MCP — API integration, checklist items added)");
  }

  return JSON.stringify({
    success: true,
    architecture: {
      name: architecture.name,
      techStack,
      featureCount: architecture.features.length,
      ...(architecture.reviewMode ? { reviewMode: architecture.reviewMode } : {}),
      claudeModel: input.claudeModel ?? "opus",
      ...(architecture.oversight ? { oversight: architecture.oversight } : {}),
      ...(architecture.uiDesign ? { hasUIDesign: true, uiStyle: architecture.uiDesign.style, uiReferenceCount: architecture.uiDesign.references.length } : {}),
    },
    ...(phases
      ? {
          phasesDetected: phases.length,
          phaseNames: phases.map((p) => p.name),
        }
      : {}),
    backupConfig: {
      enabled: true,
      required: isStateful,
      targets: backupTargets,
      offsiteProvider,
    },
    suggestedCompanions,
    nextStep: phases
      ? `${phases.length} product phases detected. Run a2p_setup_companions, then a2p_create_build_plan for Phase 0: "${phases[0].name}".`
      : "Run a2p_setup_companions to install recommended MCP servers, then a2p_create_build_plan to create slices.",
  });
}
