import { z } from "zod";

export const HardeningAreaIdSchema = z.enum([
  "auth-session", "data-access", "business-logic", "input-output",
  "api-surface", "external-integration", "infra-secrets", "vuln-chaining",
]);

// === A2P v2: systems-engineering concern schemas ===

export const SystemsConcernIdSchema = z.enum([
  "data_model",
  "invariants",
  "state_machine",
  "api_contracts",
  "auth_permissions",
  "failure_modes",
  "observability",
  "performance_under_load",
  "migrations",
  "concurrency_idempotency",
  "distributed_state",
  "cache_invalidation",
  "security",
]);

export const ConcernApplicabilitySchema = z.enum(["required", "not_applicable"]);

/**
 * Per-concern requirement evidence. Validation rules beyond shape:
 *  - applicability = "required"       → requirement.length > 0 AND linkedAcIds.length > 0
 *  - applicability = "not_applicable" → justification.length > 0
 * These cross-field constraints are enforced via superRefine so
 * state-manager gate errors can be precise.
 */
export const ConcernRequirementEntrySchema = z.object({
  concern: SystemsConcernIdSchema,
  applicability: ConcernApplicabilitySchema,
  justification: z.string(),
  requirement: z.string(),
  linkedAcIds: z.array(z.string()),
}).superRefine((val, ctx) => {
  if (val.applicability === "required") {
    if (val.requirement.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["requirement"],
        message: `concern "${val.concern}" is required but requirement prose is empty`,
      });
    }
    if (val.linkedAcIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["linkedAcIds"],
        message: `concern "${val.concern}" is required but linkedAcIds is empty (anti-gaming guard — required concerns must anchor to at least one AC)`,
      });
    }
  } else {
    if (val.justification.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["justification"],
        message: `concern "${val.concern}" is not_applicable but justification is empty`,
      });
    }
  }
});

export const ConcernTestEntrySchema = z.object({
  concern: SystemsConcernIdSchema,
  testNames: z.array(z.string()).min(1),
  evidenceType: z.enum(["positive", "negative", "edge", "regression", "contract", "integration"]),
  rationale: z.string().min(1),
});

export const ConcernPlanEntrySchema = z.object({
  concern: SystemsConcernIdSchema,
  approach: z.string().min(1),
  filesTouched: z.array(z.string()),
  rollbackStrategy: z.string().nullable(),
});

export const ConcernReviewEntrySchema = z.object({
  concern: SystemsConcernIdSchema,
  verdict: z.enum(["satisfied", "unsatisfied", "not_applicable"]),
  evidence: z.string(),
  shortfall: z.string(),
}).superRefine((val, ctx) => {
  if (val.verdict === "unsatisfied" && val.shortfall.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shortfall"],
      message: `concern "${val.concern}" verdicted unsatisfied but shortfall prose is empty`,
    });
  }
  if (val.verdict === "satisfied" && val.evidence.trim().length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["evidence"],
      message: `concern "${val.concern}" verdicted satisfied but evidence is empty`,
    });
  }
});

// === A2P v2: Architecture.systems schemas ===

export const DomainEntitySchema = z.object({
  name: z.string().min(1),
  purpose: z.string(),
  identity: z.string(),
  ownership: z.enum(["single-tenant", "multi-tenant", "shared"]),
  lifecycle: z.string(),
});

export const SystemInvariantSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  scope: z.enum(["global", "per-entity", "per-request"]),
  enforcedBy: z.string(),
});

export const StateMachineTransitionSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  trigger: z.string(),
  guard: z.string().optional(),
});

export const StateMachineSpecSchema = z.object({
  name: z.string().min(1),
  states: z.array(z.string()).min(1),
  transitions: z.array(StateMachineTransitionSchema),
  terminalStates: z.array(z.string()),
});

export const ApiContractSpecSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["mcp-tool", "http", "rpc", "cli", "event"]),
  inputShape: z.string(),
  outputShape: z.string(),
  errorModes: z.array(z.string()),
  versioning: z.enum(["breaking-allowed", "additive-only", "frozen"]),
});

export const PermissionRoleSchema = z.object({
  name: z.string().min(1),
  grants: z.array(z.string()),
  mustNot: z.array(z.string()),
});

export const PermissionsModelSchema = z.object({
  tenancy: z.enum(["none", "soft", "hard"]),
  roles: z.array(PermissionRoleSchema),
  boundaries: z.array(z.string()),
});

export const FailureModeSchema = z.object({
  id: z.string().min(1),
  trigger: z.string().min(1),
  blastRadius: z.string(),
  detection: z.string(),
  recovery: z.string(),
});

export const MigrationPolicySchema = z.object({
  stateVersionCurrent: z.number().int().positive(),
  forwardStrategy: z.enum(["preprocess-in-zod", "explicit-script", "hybrid"]),
  backwardCompatPromise: z.string(),
  migrationTests: z.array(z.string()),
});

export const ObservabilityModelSchema = z.object({
  logging: z.enum(["structured-json", "text", "none"]),
  logCorrelationKey: z.string().nullable(),
  metricsBackend: z.string().nullable(),
  tracingBackend: z.string().nullable(),
  requiredEventsPerSlice: z.array(z.string()),
});

export const PerformanceBudgetSchema = z.object({
  surface: z.string().min(1),
  p50Ms: z.number().nonnegative(),
  p95Ms: z.number().nonnegative(),
  maxBytesInMemory: z.number().nonnegative().optional(),
});

export const CacheStrategySchema = z.object({
  layer: z.string(),
  invalidationTriggers: z.array(z.string()),
  stalenessBoundMs: z.number().nonnegative().nullable(),
});

export const DistributedStateModelSchema = z.object({
  topology: z.enum(["single-process", "multi-process", "multi-node"]),
  consistency: z.enum(["single-writer", "strong", "eventual"]),
  coordinationMechanism: z.string().nullable(),
});

export const SecurityAssumptionSchema = z.object({
  id: z.string().min(1),
  assumption: z.string().min(1),
  invalidatedBy: z.string(),
});

export const ArchitectureSystemsSchema = z.object({
  domainEntities: z.array(DomainEntitySchema),
  invariants: z.array(SystemInvariantSchema),
  stateMachines: z.array(StateMachineSpecSchema),
  apiContracts: z.array(ApiContractSpecSchema),
  permissionsModel: PermissionsModelSchema,
  failureModel: z.array(FailureModeSchema),
  migrationPolicy: MigrationPolicySchema,
  observabilityModel: ObservabilityModelSchema,
  performanceBudgets: z.array(PerformanceBudgetSchema),
  cacheStrategy: CacheStrategySchema,
  distributedStateModel: DistributedStateModelSchema,
  securityAssumptions: z.array(SecurityAssumptionSchema),
});

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
  testFilePatterns: z.array(z.string()).optional(),
  // A2P v2: optional structured systems-engineering block
  systems: ArchitectureSystemsSchema.optional(),
  // A2P v2.0.2: opt-out from codebase-memory enforcement gate
  bypassCodebaseMemory: z.boolean().optional(),
  bypassCodebaseMemoryRationale: z.string().optional(),
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

export const SliceBaselineSchema = z.object({
  commit: z.string().nullable(),
  fileHashes: z.record(z.string(), z.string()).optional(),
  capturedAt: z.string(),
});

export const SliceHardeningRequirementsSchema = z.object({
  goal: z.string().min(1),
  nonGoals: z.array(z.string()),
  affectedComponents: z.array(z.string()).min(1),
  assumptions: z.array(z.string()),
  risks: z.array(z.string()),
  finalAcceptanceCriteria: z.array(z.string()).min(1),
  acHash: z.string().min(1),
  hardenedAt: z.string().min(1),
  // A2P v2: optional per-concern requirement evidence
  systemsConcerns: z.array(ConcernRequirementEntrySchema).optional(),
});

export const SliceTestHardeningEntrySchema = z.object({
  ac: z.string().min(1),
  tests: z.array(z.string()).min(1),
  rationale: z.string(),
});

export const SliceHardeningTestsSchema = z.object({
  acToTestMap: z.array(SliceTestHardeningEntrySchema).min(1),
  positiveCases: z.array(z.string()).min(1),
  negativeCases: z.array(z.string()).min(1),
  edgeCases: z.array(z.string()),
  regressions: z.array(z.string()),
  additionalConcerns: z.array(z.string()),
  doneMetric: z.string().min(1),
  hardenedAt: z.string().min(1),
  requirementsAcHash: z.string().min(1),
  // A2P v2: optional per-concern test obligations
  systemsConcernTests: z.array(ConcernTestEntrySchema).optional(),
});

export const SlicePlanHardeningRoundSchema = z.object({
  round: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  initialPlan: z.string().optional(),
  critique: z.string().min(1),
  revisedPlan: z.string().min(1),
  improvementsFound: z.boolean(),
  createdAt: z.string().min(1),
});

export const SliceFinalPlanSchema = z.object({
  touchedAreas: z.array(z.string()).min(1),
  expectedFiles: z.array(z.string()).min(1),
  interfacesToChange: z.array(z.string()),
  invariantsToPreserve: z.array(z.string()),
  risks: z.array(z.string()),
  narrative: z.string().min(1).max(800),
  // A2P v2: optional per-concern plan entries
  systemsConcernPlans: z.array(ConcernPlanEntrySchema).optional(),
});

export const SliceHardeningPlanSchema = z.object({
  rounds: z.array(SlicePlanHardeningRoundSchema).min(1).max(3),
  finalPlan: SliceFinalPlanSchema,
  finalized: z.boolean().default(false),
  finalizedAt: z.string().min(1).optional(),
  requirementsAcHash: z.string().min(1),
  testsHardenedAt: z.string().min(1),
});

export const TestFirstGuardArtifactSchema = z.object({
  redTestsDeclaredAt: z.string().min(1),
  redTestsRunAt: z.string().nullable(),
  redFailingEvidence: z
    .object({
      exitCode: z.number().int(),
      testCommand: z.string(),
      failedCount: z.number().int().nullable(),
    })
    .nullable(),
  testFilesTouched: z.array(z.string()),
  nonTestFilesTouchedBeforeRedEvidence: z.array(z.string()),
  guardVerdict: z.enum([
    "pass",
    "pass_inherited_completion_fix",
    "fail",
    "stale",
  ]),
  baselineCommit: z.string().nullable(),
  baselineCapturedAt: z.string(),
  evidenceReason: z.string(),
});

export const SliceAcCoverageEntrySchema = z.object({
  ac: z.string().min(1),
  status: z.enum(["met", "partial", "missing"]),
  evidence: z.string(),
});

export const AutomatedStubSignalSchema = z.object({
  file: z.string(),
  line: z.number().int().min(0),
  pattern: z.string(),
  snippet: z.string(),
});

export const StubJustificationSchema = z.object({
  signalIndex: z.number().int().min(0),
  reason: z.string().min(1),
  followupSliceId: z.string().optional(),
});

export const PlanComplianceReportSchema = z.object({
  unplannedFiles: z.array(z.string()),
  unplannedInterfaceChanges: z.array(z.string()),
  touchedAreasCovered: z.boolean(),
  verdict: z.enum(["ok", "drift", "broken"]),
  note: z.string().optional(),
});

export const SliceCompletionReviewSchema = z.object({
  loop: z.number().int().min(1),
  createdAt: z.string().min(1),
  acCoverage: z.array(SliceAcCoverageEntrySchema),
  testCoverageQuality: z.enum(["deep", "shallow", "insufficient"]),
  planCompliance: PlanComplianceReportSchema,
  missingFunctionality: z.array(z.string()),
  missingTests: z.array(z.string()),
  missingEdgeCases: z.array(z.string()),
  missingIntegrationWork: z.array(z.string()),
  missingCleanupRefactor: z.array(z.string()),
  missingPlanFixes: z.array(z.string()),
  shortcutsOrStubs: z.array(z.string()),
  automatedStubSignals: z.array(AutomatedStubSignalSchema),
  stubJustifications: z.array(StubJustificationSchema),
  verdict: z.enum(["NOT_COMPLETE", "COMPLETE"]),
  nextActions: z.array(z.string()),
  supersededByHardeningAt: z.string().optional(),
  bootstrapExempt: z.boolean().optional(),
  // A2P v2: optional per-concern verdicts for the pre-DONE gate
  systemsConcernReviews: z.array(ConcernReviewEntrySchema).optional(),
});

export const SliceStatusSchema = z.enum([
  "pending",
  "ready_for_red",
  "red",
  "green",
  "refactor",
  "sast",
  "completion_fix",
  "done",
]);

export const SliceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  acceptanceCriteria: z.array(z.string()),
  testStrategy: z.string(),
  dependencies: z.array(z.string()),
  status: SliceStatusSchema,
  files: z.array(z.string()),
  testResults: z.array(TestResultSchema),
  sastFindings: z.array(SASTFindingSchema),
  sastRanAt: z.string().optional(),
  productPhaseId: z.string().optional(),
  type: z.enum(["feature", "integration", "infrastructure"]).optional(),
  hasUI: z.boolean().optional(),
  bootstrap: z.boolean().optional(),
  baseline: SliceBaselineSchema.optional(),
  requirementsHardening: SliceHardeningRequirementsSchema.optional(),
  testHardening: SliceHardeningTestsSchema.optional(),
  planHardening: SliceHardeningPlanSchema.optional(),
  previousPlanHardenings: z.array(SliceHardeningPlanSchema).optional(),
  testFirstGuard: TestFirstGuardArtifactSchema.optional(),
  completionReviews: z.array(SliceCompletionReviewSchema).optional(),
  // A2P v2: optional explicit systems-concern override
  systemsClassification: z.array(SystemsConcernIdSchema).optional(),
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

/** A2P v2.0.2: audit record for required-companion bypasses. */
export const CompanionBypassSchema = z.object({
  missing: z.array(z.object({ name: z.string(), type: z.string() })),
  rationale: z.string().min(1),
  timestamp: z.string().min(1),
});

export const ProjectConfigSchema = z.object({
  projectPath: z.string().min(1),
  testCommand: z.string(),
  lintCommand: z.string(),
  buildCommand: z.string(),
  formatCommand: z.string(),
  claudeModel: z.enum(["opus", "sonnet", "haiku"]).default("opus"),
  allowTestCommandOverride: z.boolean().default(false),
  companionBypasses: z.array(CompanionBypassSchema).optional(),
});

/** A2P v2.0.2: codebase-memory gate readiness. */
export const CodebaseMemoryReadinessSchema = z.object({
  registered: z.boolean(),
  indexed: z.boolean(),
  lastIndexedAt: z.string().nullable(),
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

/**
 * Migrate old slice.planHardening shape where `finalizedAt: ""` meant
 * "rounds accumulating, not yet finalized" into the explicit
 * `finalized: boolean` + optional `finalizedAt?: string` shape.
 *
 *  - finalizedAt === "" or missing → { finalized: false } (drop finalizedAt)
 *  - finalizedAt === "<ISO string>" → { finalized: true, finalizedAt: "<ISO>" }
 */
function migratePlanHardeningInSlices(data: Record<string, unknown>): Record<string, unknown> {
  const slices = data.slices;
  if (!Array.isArray(slices)) return data;
  for (const slice of slices) {
    if (!slice || typeof slice !== "object") continue;
    const ph = (slice as Record<string, unknown>).planHardening;
    if (!ph || typeof ph !== "object") continue;
    const obj = ph as Record<string, unknown>;
    if ("finalized" in obj && typeof obj.finalized === "boolean") continue; // already migrated
    const finalizedAt = obj.finalizedAt;
    if (typeof finalizedAt === "string" && finalizedAt.length > 0) {
      obj.finalized = true;
      // keep finalizedAt as-is
    } else {
      obj.finalized = false;
      delete obj.finalizedAt;
    }
  }
  return data;
}

/**
 * Migrate v1 state → v2 (A2P v2 systems-engineering).
 * Semantic no-op: every new field is optional and defaults to `undefined`.
 * We bump the stored version number so downstream code can distinguish.
 *
 * A v1 state read by v2 code round-trips with all systems fields unset.
 * computeRequiredConcerns() returns {"failure_modes"} at minimum (always-on),
 * so pre-RED gate starts enforcing from the next hardening call. Slices
 * already past `ready_for_red` at upgrade time retain their existing state
 * — the gate fires on the *next* transition attempt.
 */
function migrateV1ToV2Systems(data: Record<string, unknown>): Record<string, unknown> {
  if (typeof data.version === "number" && data.version < 2) {
    data.version = 2;
  }
  return data;
}

export const ProjectStateSchema = z.preprocess(
  (val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      migrateV1ToV2Systems(obj);
      migrateAdversarialReview(obj);
      migratePlanHardeningInSlices(obj);
      return obj;
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
    method: z.enum(["caddy-auto", "paas-auto", "manual", "ip-only-acknowledged"]),
    issuer: z.string().min(1),
    expiresAt: z.string().nullable(),
    autoRenewal: z.boolean(),
    httpsRedirect: z.boolean(),
    hstsPresent: z.boolean(),
  }).nullable().default(null),
  bootstrapSliceId: z.string().nullable().default(null),
  bootstrapLockedAt: z.string().nullable().default(null),
  // A2P v2.0.2: codebase-memory gate readiness (optional for backward compat)
  codebaseMemoryReadiness: CodebaseMemoryReadinessSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}));
