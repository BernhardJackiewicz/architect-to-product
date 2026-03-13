import { z } from "zod";
import { StateManager } from "../state/state-manager.js";
import type { Architecture, TechStack } from "../state/types.js";

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
});

export type SetArchitectureInput = z.infer<typeof setArchitectureSchema>;

export function handleSetArchitecture(input: SetArchitectureInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({
      error: "No project found. Run a2p_init_project first.",
    });
  }

  const techStack: TechStack = {
    language: input.language,
    framework: input.framework,
    database: input.database ?? null,
    frontend: input.frontend ?? null,
    hosting: input.hosting ?? null,
    other: input.otherTech ?? [],
  };

  const architecture: Architecture = {
    name: input.name,
    description: input.description,
    techStack,
    features: input.features,
    dataModel: input.dataModel,
    apiDesign: input.apiDesign,
    raw: input.rawArchitecture ?? "",
  };

  sm.setArchitecture(architecture);

  // Detect what companions are needed
  const suggestedCompanions: string[] = ["codebase-memory-mcp"];

  if (techStack.database) {
    const db = techStack.database.toLowerCase();
    if (db.includes("supabase")) suggestedCompanions.push("supabase-mcp");
    else if (db.includes("postgres")) suggestedCompanions.push("@modelcontextprotocol/server-postgres");
    else if (db.includes("sqlite")) suggestedCompanions.push("@modelcontextprotocol/server-sqlite");
    else if (db.includes("mysql") || db.includes("mariadb")) suggestedCompanions.push("@modelcontextprotocol/server-mysql");
    else if (db.includes("mongo")) suggestedCompanions.push("mongodb-mcp");
  } else {
    suggestedCompanions.push("supabase-mcp (recommended default)");
  }

  if (techStack.frontend) {
    suggestedCompanions.push("playwright-mcp (for E2E testing)");
  }

  return JSON.stringify({
    success: true,
    architecture: {
      name: architecture.name,
      techStack,
      featureCount: architecture.features.length,
    },
    suggestedCompanions,
    nextStep: "Run a2p_setup_companions to install recommended MCP servers, then a2p_create_build_plan to create slices.",
  });
}
