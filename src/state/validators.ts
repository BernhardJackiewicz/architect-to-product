import { z } from "zod";

export const HardeningAreaIdSchema = z.enum([
  "auth-session", "data-access", "business-logic", "input-output",
  "api-surface", "external-integration", "infra-secrets", "vuln-chaining",
]);

export const TechStackSchema = z.object({
  language: z.string().min(1),
  framework: z.string().min(1),
  database: z.string().nullable(),
  frontend: z.string().nullable(),
  hosting: z.string().nullable(),
  other: z.array(z.string()),
  platform: z.enum(["web", "mobile", "cross-platform", "backend-only"]).nullable().optional(),
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
  justification: z.string().optional(),
  confidence: z.enum(["hypothesis", "evidence-backed", "hard-to-verify"]).optional(),
  evidence: z.string().optional(),
  domains: z.array(HardeningAreaIdSchema).optional(),
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
  allowTestCommandOverride: z.boolean().default(false),
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

export const InfrastructureRecordSchema = z.object({
  provider: z.enum(["hetzner"]),
  serverId: z.string().min(1),
  serverName: z.string().min(1),
  serverIp: z.string().min(1),
  serverIpv6: z.string().optional(),
  serverType: z.string().min(1),
  location: z.string().min(1),
  firewallId: z.string().optional(),
  sshUser: z.string().min(1),
  sshKeyFingerprint: z.string().min(1),
  domain: z.string().optional(),
  provisionedAt: z.string(),
  lastDeployedAt: z.string().nullable(),
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

export const AdversarialReviewRoundSchema = z.object({
  round: z.number().int().min(1),
  completedAt: z.string(),
  findingsRecorded: z.number().int().min(0),
  note: z.string(),
  focusArea: HardeningAreaIdSchema.optional(),
});

export const AdversarialReviewStateSchema = z.object({
  completedAt: z.string(),
  round: z.number().int().min(1),
  totalFindingsRecorded: z.number().int().min(0),
  roundHistory: z.array(AdversarialReviewRoundSchema),
});

export const SecurityOverviewCoverageEntrySchema = z.object({
  id: HardeningAreaIdSchema,
  coverageEstimate: z.number().min(0).max(100),
  findingCount: z.number().int().min(0),
  lastHardenedAt: z.string().nullable(),
});

export const SecurityOverviewSchema = z.object({
  totalSecurityRounds: z.number().int().min(0),
  lastSecurityActivityAt: z.string().nullable(),
  lastWhiteboxAt: z.string().nullable(),
  lastActiveVerificationAt: z.string().nullable(),
  lastShakeBreakAt: z.string().nullable(),
  areasExplicitlyHardened: z.array(HardeningAreaIdSchema),
  coverageByArea: z.array(SecurityOverviewCoverageEntrySchema),
  recommendedNextAreas: z.array(HardeningAreaIdSchema),
});

export const ShakeBreakCategorySchema = z.enum([
  "auth_idor", "race_conditions", "state_manipulation",
  "business_logic", "injection_runtime", "token_session",
  "file_upload", "webhook_callback",
]);

export const ShakeBreakSessionSchema = z.object({
  sandboxPath: z.string(),
  port: z.number().int(),
  dbUrl: z.string(),
  dbType: z.enum(["sqlite", "postgres", "mysql", "none"]),
  dbFallback: z.boolean(),
  dockerContainerId: z.string().nullable(),
  categories: z.array(ShakeBreakCategorySchema),
  startedAt: z.string(),
  timeoutMinutes: z.number().int().min(5).max(30),
  startingFindingIds: z.array(z.string()),
});

export const ShakeBreakResultSchema = z.object({
  id: z.string().min(1),
  timestamp: z.string(),
  durationMinutes: z.number(),
  categoriesTested: z.array(ShakeBreakCategorySchema),
  findingsRecorded: z.number().int().min(0),
  note: z.string(),
});

/** Migrate old adversarialReviewCompletedAt (string) → adversarialReviewState (object) */
function migrateAdversarialReview(data: Record<string, unknown>): Record<string, unknown> {
  if ("adversarialReviewCompletedAt" in data && !("adversarialReviewState" in data)) {
    const ts = data.adversarialReviewCompletedAt;
    if (typeof ts === "string") {
      data.adversarialReviewState = {
        completedAt: ts,
        round: 1,
        totalFindingsRecorded: 0,
        roundHistory: [],
      };
    } else {
      data.adversarialReviewState = null;
    }
    delete data.adversarialReviewCompletedAt;
  }
  return data;
}

export const ProjectStateSchema = z.preprocess(
  (val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return migrateAdversarialReview(val as Record<string, unknown>);
    }
    return val;
  },
  z.object({
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
  infrastructure: InfrastructureRecordSchema.nullable().default(null),
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
  companionsConfiguredAt: z.string().nullable().default(null),
  lastSecurityRelevantChangeAt: z.string().nullable().default(null),
  lastFullSastAt: z.string().nullable().default(null),
  lastFullSastFindingCount: z.number().int().min(0).default(0),
  buildSignoffAt: z.string().nullable().default(null),
  buildSignoffSliceHash: z.string().nullable().default(null),
  adversarialReviewState: AdversarialReviewStateSchema.nullable().default(null),
  deployApprovalAt: z.string().nullable().default(null),
  deployApprovalStateHash: z.string().nullable().default(null),
  projectFindings: z.array(SASTFindingSchema).default([]),
  securityReentryReason: z.enum(["security_only", "post_deploy", "post_complete"]).nullable().default(null),
  shakeBreakSession: ShakeBreakSessionSchema.nullable().default(null),
  shakeBreakResults: z.array(ShakeBreakResultSchema).default([]),
  securityOverview: SecurityOverviewSchema.nullable().default(null),
  pendingSecurityDecision: z.object({
    round: z.number().int().min(1),
    setAt: z.string(),
    recommendedAreas: z.array(HardeningAreaIdSchema),
    availableActions: z.array(z.string()),
    confirmationCode: z.string().optional(), // deprecated — kept for backward compat with existing state files
  }).nullable().default(null),
  secretManagementTier: z.enum(["env-file", "docker-swarm", "infisical", "external"]).nullable().default(null),
  sslVerifiedAt: z.string().nullable().default(null),
  sslVerification: z.object({
    domain: z.string().min(1),
    verifiedAt: z.string(),
    method: z.enum(["caddy-auto", "paas-auto", "manual"]),
    issuer: z.string().min(1),
    expiresAt: z.string().nullable(),
    autoRenewal: z.boolean(),
    httpsRedirect: z.boolean(),
    hstsPresent: z.boolean(),
  }).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
}));
