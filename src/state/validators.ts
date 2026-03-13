import { z } from "zod";

export const TechStackSchema = z.object({
  language: z.string().min(1),
  framework: z.string().min(1),
  database: z.string().nullable(),
  frontend: z.string().nullable(),
  hosting: z.string().nullable(),
  other: z.array(z.string()),
});

export const ProductPhaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  deliverables: z.array(z.string()),
  timeline: z.string(),
});

export const UIReferenceSchema = z.object({
  type: z.enum(["description", "wireframe", "mockup", "screenshot", "file"]),
  path: z.string().optional(),
  description: z.string(),
});

export const UIDesignSchema = z.object({
  description: z.string().min(1),
  style: z.string().optional(),
  references: z.array(UIReferenceSchema),
});

export const ArchitectureSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  techStack: TechStackSchema,
  features: z.array(z.string()).min(1),
  dataModel: z.string(),
  apiDesign: z.string(),
  raw: z.string(),
  phases: z.array(ProductPhaseSchema).optional(),
  reviewMode: z.enum(["off", "all", "ui-only"]).optional(),
  uiDesign: UIDesignSchema.optional(),
});

export const TestResultSchema = z.object({
  timestamp: z.string(),
  command: z.string(),
  exitCode: z.number().int(),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  skipped: z.number().int().min(0),
  output: z.string(),
});

export const SASTFindingSchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  status: z.enum(["open", "fixed", "accepted", "false_positive"]),
  title: z.string().min(1),
  file: z.string(),
  line: z.number().int().min(0),
  description: z.string(),
  fix: z.string(),
});

export const SliceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  testStrategy: z.string(),
  dependencies: z.array(z.string()),
  status: z.enum(["pending", "red", "green", "refactor", "sast", "done"]),
  files: z.array(z.string()),
  testResults: z.array(TestResultSchema),
  sastFindings: z.array(SASTFindingSchema),
  productPhaseId: z.string().optional(),
  type: z.enum(["feature", "integration", "infrastructure"]).optional(),
  hasUI: z.boolean().optional(),
});

export const QualityIssueSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["dead_code", "redundant", "high_coupling", "unused_import", "complex"]),
  file: z.string(),
  symbol: z.string(),
  description: z.string(),
  status: z.enum(["open", "fixed", "accepted", "false_positive"]),
});

export const CompanionServerSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["codebase_memory", "database", "playwright"]),
  command: z.string(),
  installed: z.boolean(),
  config: z.record(z.string(), z.string()),
});

export const BuildEventSchema = z.object({
  timestamp: z.string(),
  phase: z.enum([
    "onboarding",
    "planning",
    "building",
    "refactoring",
    "e2e_testing",
    "security",
    "deployment",
    "complete",
  ]),
  sliceId: z.string().nullable(),
  action: z.string(),
  details: z.string(),
});

export const ProjectConfigSchema = z.object({
  projectPath: z.string().min(1),
  testCommand: z.string(),
  lintCommand: z.string(),
  buildCommand: z.string(),
  formatCommand: z.string(),
});

export const ProjectStateSchema = z.object({
  version: z.number().int().positive(),
  projectName: z.string().min(1),
  architecture: ArchitectureSchema.nullable(),
  slices: z.array(SliceSchema),
  currentSliceIndex: z.number().int().min(-1),
  phase: z.enum([
    "onboarding",
    "planning",
    "building",
    "refactoring",
    "e2e_testing",
    "security",
    "deployment",
    "complete",
  ]),
  config: ProjectConfigSchema,
  companions: z.array(CompanionServerSchema),
  qualityIssues: z.array(QualityIssueSchema),
  buildHistory: z.array(BuildEventSchema),
  currentProductPhase: z.number().int().min(0).default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});
