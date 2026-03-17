/**
 * Core type definitions for the architect-to-product MCP server.
 * All project state flows through these interfaces.
 */

export type HardeningAreaId =
  | "auth-session"
  | "data-access"
  | "business-logic"
  | "input-output"
  | "api-surface"
  | "external-integration"
  | "infra-secrets"
  | "vuln-chaining";

export type AuditMode = "quality" | "release";

export interface AuditFinding {
  category: string;
  severity: FindingSeverity;
  file: string;
  line: number;
  message: string;
  fix: string;
}

export interface AuditResult {
  id: string;
  mode: AuditMode;
  timestamp: string;
  findings: AuditFinding[];
  summary: { critical: number; high: number; medium: number; low: number };
  buildPassed: boolean | null;
  testsPassed: boolean | null;
  aggregated: {
    openSastFindings: number;
    openQualityIssues: number;
    slicesDone: number;
    slicesTotal: number;
  };
}

export type Phase =
  | "onboarding"
  | "planning"
  | "building"
  | "refactoring"
  | "e2e_testing"
  | "security"
  | "deployment"
  | "complete";

export type SliceStatus =
  | "pending"
  | "red"
  | "green"
  | "refactor"
  | "sast"
  | "done";

export type ReviewMode = "off" | "all" | "ui-only";

export interface OversightConfig {
  sliceReview: ReviewMode;       // default: "off" — pause after slice completion
  planApproval: boolean;         // default: true — must approve slice plan before building
  buildSignoff: boolean;         // MANDATORY (always true) — must confirm product works after building
  deployApproval: boolean;       // MANDATORY (always true) — must confirm before deploy
  securitySignoff: boolean;      // default: false — explicit go/no-go after security gate
  uiVerification: boolean;       // default: true when frontend detected — human reviews Playwright screenshots
}

export type UISourceType = "description" | "wireframe" | "mockup" | "screenshot" | "file";

export interface UIReference {
  type: UISourceType;
  path?: string; // file path for images/files
  description: string; // what this reference shows or describes
}

export interface UIDesign {
  description: string; // overall UI vision
  style?: string; // e.g. "minimal", "corporate", "playful", "dashboard"
  references: UIReference[]; // wireframes, mockups, screenshots, design files
}

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus = "open" | "fixed" | "accepted" | "false_positive";

export type FindingConfidence = "hypothesis" | "evidence-backed" | "hard-to-verify";

export interface ProductPhase {
  id: string; // "phase-0", "phase-1"
  name: string; // "Foundations/Spikes", "MVP"
  description: string;
  deliverables: string[]; // Features dieser Phase
  timeline: string; // "Weeks 1-8"
}

export type SliceType = "feature" | "integration" | "infrastructure";

export interface Architecture {
  name: string;
  description: string;
  techStack: TechStack;
  features: string[];
  dataModel: string;
  apiDesign: string;
  raw: string; // Original architecture text from user
  phases?: ProductPhase[]; // Optional for backward compat
  reviewMode?: ReviewMode; // default: "off" — DEPRECATED: use oversight.sliceReview
  oversight?: OversightConfig; // Granular human oversight configuration
  uiDesign?: UIDesign; // UI description, wireframes, mockups
}

export type Platform = "web" | "mobile" | "cross-platform" | "backend-only";

export interface TechStack {
  language: string;
  framework: string;
  database: string | null;
  frontend: string | null;
  hosting: string | null;
  other: string[];
  platform?: Platform | null;
}

export interface Slice {
  id: string;
  name: string;
  description: string;
  acceptanceCriteria: string[];
  testStrategy: string;
  dependencies: string[]; // IDs of slices this depends on
  status: SliceStatus;
  files: string[];
  testResults: TestResult[];
  sastFindings: SASTFinding[];
  sastRanAt?: string; // ISO timestamp of last SAST run (set by a2p_run_sast)
  productPhaseId?: string; // Which phase this slice belongs to
  type?: SliceType; // default "feature"
  hasUI?: boolean; // Does this slice have frontend changes?
}

export interface TestResult {
  timestamp: string;
  command: string;
  exitCode: number;
  passed: number;
  failed: number;
  skipped: number;
  output: string;
}

export interface SASTFinding {
  id: string;
  tool: string; // "semgrep", "bandit", "manual"
  severity: FindingSeverity;
  status: FindingStatus;
  title: string;
  file: string;
  line: number;
  description: string;
  fix: string;
  justification?: string; // Required when status is accepted/fixed/false_positive
  confidence?: FindingConfidence; // Required for adversarial-review high/critical findings
  evidence?: string; // File:line reference proving what was checked — required for adversarial-review high/critical
  domains?: HardeningAreaId[]; // Structural assignment to hardening areas
}

export interface QualityIssue {
  id: string;
  type: "dead_code" | "redundant" | "high_coupling" | "unused_import" | "complex";
  file: string;
  symbol: string;
  description: string;
  status: FindingStatus;
}

export interface CompanionServer {
  name: string;
  type:
    | "codebase_memory"
    | "database"
    | "playwright"
    | "github"
    | "git"
    | "filesystem"
    | "semgrep"
    | "sequential_thinking"
    | "vercel"
    | "cloudflare"
    | "stripe"
    | "atlassian"
    | "sentry"
    | "upstash";
  command: string;
  installed: boolean;
  config: Record<string, string>;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type BuildAction =
  | "phase_change"
  | "slice_status"
  | "test_run"
  | "sast_run"
  | "sast_finding"
  | "quality_issue"
  | "audit_run"
  | "whitebox_audit"
  | "active_verification"
  | "companion_added"
  | "config_update"
  | "architecture_set"
  | "slices_set"
  | "slices_added"
  | "slice_advance"
  | "files_updated"
  | "phase_complete"
  | "shake_break_setup"
  | "shake_break_teardown"
  | "ssl_verification";

export type EventStatus = "success" | "failure" | "warning" | "info";

export interface EventMetadata {
  exitCode?: number;
  command?: string;
  toolName?: string;
  findingCount?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  truncated?: boolean;
  mode?: string;
  [key: string]: unknown;
}

export interface BuildEvent {
  timestamp: string;
  phase: Phase;
  sliceId: string | null;
  action: string;
  details: string;
  level?: LogLevel;
  status?: EventStatus;
  durationMs?: number;
  runId?: string;
  metadata?: EventMetadata;
  outputSummary?: string;
  outputRef?: string;
  outputTruncated?: boolean;
}

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export interface ProjectConfig {
  projectPath: string;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  formatCommand: string;
  claudeModel: ClaudeModel; // default: "opus" — which Claude model does the programming
  allowTestCommandOverride: boolean; // default: false — allow overriding testCommand via parameter
}

export type WhiteboxCategory =
  | "InputOutputSafety"
  | "AuthAuthz"
  | "TenantIsolation"
  | "Secrets"
  | "FilesystemProcessCmd"
  | "WorkflowGateEnforcement"
  | "StateRecoverySafety"
  | "DeploymentArtifactSafety";

export type WhiteboxEvidenceType = "runtime_tested" | "code_verified" | "speculative";
export type WhiteboxEnforcementType = "code" | "config" | "prompt-only" | "mixed";

export interface WhiteboxFinding {
  id: string;
  category: WhiteboxCategory;
  severity: FindingSeverity;
  confirmed_exploitable: boolean;
  evidence_type: WhiteboxEvidenceType;
  enforcement_type: WhiteboxEnforcementType;
  runtime_path_reachable: boolean;
  state_change_provable: boolean;
  boundary_actually_bypassed: boolean;
  root_cause: string;
  affected_files: string[];
  minimal_fix: string;
  required_regression_tests: string[];
  blocking: boolean;
}

export interface WhiteboxAuditResult {
  id: string;
  mode: "incremental" | "full";
  timestamp: string;
  candidates_evaluated: number;
  findings: WhiteboxFinding[];
  summary: { critical: number; high: number; medium: number; low: number };
  blocking_count: number;
}

export interface ActiveVerificationResult {
  id: string;
  timestamp: string;
  round: number;
  tests_run: number;
  tests_passed: number;
  tests_failed: number;
  findings: WhiteboxFinding[];
  summary: { critical: number; high: number; medium: number; low: number };
  blocking_count: number;
  requires_human_review: boolean;
}

export type InfraProvider = "hetzner";

export interface InfrastructureRecord {
  provider: InfraProvider;
  serverId: string;
  serverName: string;
  serverIp: string;
  serverIpv6?: string;
  serverType: string;
  location: string;
  firewallId?: string;
  sshUser: string;
  sshKeyFingerprint: string;
  domain?: string;
  provisionedAt: string;
  lastDeployedAt: string | null;
}

export type BackupTarget = "database" | "uploads" | "local_media" | "deploy_artifacts";
export type BackupOffsiteProvider = "none" | "s3" | "b2" | "spaces" | "hetzner_storage";

export interface BackupConfig {
  enabled: boolean;
  required: boolean;
  schedule: "daily";
  time: string;
  retentionDays: number;
  targets: BackupTarget[];
  offsiteProvider: BackupOffsiteProvider;
  verifyAfterBackup: boolean;
  preDeploySnapshot: boolean;
}

export interface BackupStatus {
  configured: boolean;
  schedulerType?: "cron" | "systemd_timer";
  lastVerifiedAt?: string | null;
  lastGeneratedAt?: string | null;
}

export interface AdversarialReviewRound {
  round: number;
  completedAt: string;
  findingsRecorded: number;
  note: string;
  focusArea?: HardeningAreaId;
}

export interface AdversarialReviewState {
  completedAt: string;          // Timestamp of the latest round
  round: number;                // Current round (1, 2, 3, ...)
  totalFindingsRecorded: number; // Cumulative findings across all rounds
  roundHistory: AdversarialReviewRound[];
}

export interface SecurityOverviewCoverageEntry {
  id: HardeningAreaId;
  coverageEstimate: number;    // 0-100, heuristic
  findingCount: number;
  lastHardenedAt: string | null;
}

export interface SecurityOverview {
  totalSecurityRounds: number;
  lastSecurityActivityAt: string | null;
  lastWhiteboxAt: string | null;
  lastActiveVerificationAt: string | null;
  lastShakeBreakAt: string | null;
  areasExplicitlyHardened: HardeningAreaId[];
  coverageByArea: SecurityOverviewCoverageEntry[];
  recommendedNextAreas: HardeningAreaId[];
}

export interface PendingSecurityDecision {
  round: number;
  setAt: string;
  recommendedAreas: HardeningAreaId[];
  availableActions: string[];
  confirmationCode: string;
}

export type SecretManagementTier = "env-file" | "docker-swarm" | "infisical" | "external";

export type SslVerificationMethod = "caddy-auto" | "paas-auto" | "manual";

export interface SslVerification {
  domain: string;
  verifiedAt: string;
  method: SslVerificationMethod;
  issuer: string;           // "Let's Encrypt", "Cloudflare", "Vercel", etc.
  expiresAt: string | null; // null for PaaS
  autoRenewal: boolean;     // true for Caddy + all PaaS
  httpsRedirect: boolean;   // HTTP → HTTPS verified
  hstsPresent: boolean;     // Strict-Transport-Security header
}

export type SecurityReentryReason = "security_only" | "post_deploy" | "post_complete";

export type ShakeBreakCategory =
  | "auth_idor"
  | "race_conditions"
  | "state_manipulation"
  | "business_logic"
  | "injection_runtime"
  | "token_session"
  | "file_upload"
  | "webhook_callback";

export interface ShakeBreakSession {
  sandboxPath: string;
  port: number;
  dbUrl: string;
  dbType: "sqlite" | "postgres" | "mysql" | "none";
  dbFallback: boolean;
  dockerContainerId: string | null;
  categories: ShakeBreakCategory[];
  startedAt: string;
  timeoutMinutes: number;
  startingFindingIds: string[];
}

export interface ShakeBreakResult {
  id: string;
  timestamp: string;
  durationMinutes: number;
  categoriesTested: ShakeBreakCategory[];
  findingsRecorded: number;
  note: string;
}

export interface ProjectState {
  version: number;
  projectName: string;
  architecture: Architecture | null;
  slices: Slice[];
  currentSliceIndex: number;
  phase: Phase;
  config: ProjectConfig;
  companions: CompanionServer[];
  qualityIssues: QualityIssue[];
  auditResults: AuditResult[];
  whiteboxResults: WhiteboxAuditResult[];
  activeVerificationResults: ActiveVerificationResult[];
  buildHistory: BuildEvent[];
  currentProductPhase: number; // Index in architecture.phases[], default 0
  infrastructure: InfrastructureRecord | null;
  backupConfig: BackupConfig;
  backupStatus: BackupStatus;
  companionsConfiguredAt: string | null;
  lastSecurityRelevantChangeAt: string | null;
  lastFullSastAt: string | null;
  lastFullSastFindingCount: number;
  buildSignoffAt: string | null;
  buildSignoffSliceHash: string | null;
  adversarialReviewState: AdversarialReviewState | null;
  deployApprovalAt: string | null;
  deployApprovalStateHash: string | null;
  projectFindings: SASTFinding[];
  securityReentryReason: SecurityReentryReason | null;
  shakeBreakSession: ShakeBreakSession | null;
  shakeBreakResults: ShakeBreakResult[];
  securityOverview: SecurityOverview | null;
  pendingSecurityDecision: PendingSecurityDecision | null;
  secretManagementTier: SecretManagementTier | null;
  sslVerifiedAt: string | null;
  sslVerification: SslVerification | null;
  createdAt: string;
  updatedAt: string;
}
