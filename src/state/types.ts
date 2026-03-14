/**
 * Core type definitions for the architect-to-product MCP server.
 * All project state flows through these interfaces.
 */

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

export interface TechStack {
  language: string;
  framework: string;
  database: string | null;
  frontend: string | null;
  hosting: string | null;
  other: string[];
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
  | "phase_complete";

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
  backupConfig: BackupConfig;
  backupStatus: BackupStatus;
  lastFullSastAt: string | null;
  lastFullSastFindingCount: number;
  buildSignoffAt: string | null;
  buildSignoffSliceHash: string | null;
  deployApprovalAt: string | null;
  deployApprovalStateHash: string | null;
  createdAt: string;
  updatedAt: string;
}
