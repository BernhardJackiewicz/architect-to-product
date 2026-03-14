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

export const OversightConfigSchema = z.object({
  sliceReview: z.enum(["off", "all", "ui-only"]).default("off"),
  planApproval: z.boolean().default(true),
  buildSignoff: z.boolean().default(true),
  deployApproval: z.boolean().default(true),
  securitySignoff: z.boolean().default(false),
  uiVerification: z.boolean().default(true),
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
  oversight: OversightConfigSchema.optional(),
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
  sastRanAt: z.string().optional(),
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

export const AuditFindingSchema = z.object({
  category: z.string(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  file: z.string(),
  line: z.number().int().min(0),
  message: z.string(),
  fix: z.string(),
});

export const AuditResultSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["quality", "release"]),
  timestamp: z.string(),
  findings: z.array(AuditFindingSchema),
  summary: z.object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  buildPassed: z.boolean().nullable(),
  testsPassed: z.boolean().nullable(),
  aggregated: z.object({
    openSastFindings: z.number().int().min(0),
    openQualityIssues: z.number().int().min(0),
    slicesDone: z.number().int().min(0),
    slicesTotal: z.number().int().min(0),
  }),
});

export const CompanionServerSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "codebase_memory",
    "database",
    "playwright",
    "github",
    "git",
    "filesystem",
    "semgrep",
    "sequential_thinking",
    "vercel",
    "cloudflare",
    "stripe",
    "atlassian",
    "sentry",
    "upstash",
  ]),
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
  level: z.enum(["debug", "info", "warn", "error"]).optional(),
  status: z.enum(["success", "failure", "warning", "info"]).optional(),
  durationMs: z.number().int().min(0).optional(),
  runId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  outputSummary: z.string().optional(),
  outputRef: z.string().optional(),
  outputTruncated: z.boolean().optional(),
});

export const ProjectConfigSchema = z.object({
  projectPath: z.string().min(1),
  testCommand: z.string(),
  lintCommand: z.string(),
  buildCommand: z.string(),
  formatCommand: z.string(),
  claudeModel: z.enum(["opus", "sonnet", "haiku"]).default("opus"),
});

export const WhiteboxFindingSchema = z.object({
  id: z.string().min(1),
  category: z.enum([
    "InputOutputSafety", "AuthAuthz", "TenantIsolation", "Secrets",
    "FilesystemProcessCmd", "WorkflowGateEnforcement", "StateRecoverySafety",
    "DeploymentArtifactSafety",
  ]),
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  confirmed_exploitable: z.boolean(),
  evidence_type: z.enum(["runtime_tested", "code_verified", "speculative"]),
  enforcement_type: z.enum(["code", "config", "prompt-only", "mixed"]),
  runtime_path_reachable: z.boolean(),
  state_change_provable: z.boolean(),
  boundary_actually_bypassed: z.boolean(),
  root_cause: z.string(),
  affected_files: z.array(z.string()),
  minimal_fix: z.string(),
  required_regression_tests: z.array(z.string()),
  blocking: z.boolean(),
});

export const WhiteboxAuditResultSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(["incremental", "full"]),
  timestamp: z.string(),
  candidates_evaluated: z.number().int().min(0),
  findings: z.array(WhiteboxFindingSchema),
  summary: z.object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  blocking_count: z.number().int().min(0),
});

export const ActiveVerificationResultSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  round: z.number().int().min(1).max(3),
  tests_run: z.number().int().min(0),
  tests_passed: z.number().int().min(0),
  tests_failed: z.number().int().min(0),
  findings: z.array(WhiteboxFindingSchema),
  summary: z.object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  blocking_count: z.number().int().min(0),
  requires_human_review: z.boolean(),
});

export const BackupConfigSchema = z.object({
  enabled: z.boolean(),
  required: z.boolean(),
  schedule: z.literal("daily"),
  time: z.string(),
  retentionDays: z.number().int().min(1),
  targets: z.array(z.enum(["database", "uploads", "local_media", "deploy_artifacts"])),
  offsiteProvider: z.enum(["none", "s3", "b2", "spaces", "hetzner_storage"]),
  verifyAfterBackup: z.boolean(),
  preDeploySnapshot: z.boolean(),
});

export const BackupStatusSchema = z.object({
  configured: z.boolean(),
  schedulerType: z.enum(["cron", "systemd_timer"]).optional(),
  lastVerifiedAt: z.string().nullable().optional(),
  lastGeneratedAt: z.string().nullable().optional(),
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
  auditResults: z.array(AuditResultSchema).default([]),
  whiteboxResults: z.array(WhiteboxAuditResultSchema).default([]),
  activeVerificationResults: z.array(ActiveVerificationResultSchema).default([]),
  buildHistory: z.array(BuildEventSchema),
  currentProductPhase: z.number().int().min(0).default(0),
  backupConfig: BackupConfigSchema.default({
    enabled: true,
    required: false,
    schedule: "daily",
    time: "02:00",
    retentionDays: 14,
    targets: ["deploy_artifacts"],
    offsiteProvider: "none",
    verifyAfterBackup: false,
    preDeploySnapshot: false,
  }),
  backupStatus: BackupStatusSchema.default({
    configured: false,
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});
