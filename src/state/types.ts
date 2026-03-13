/**
 * Core type definitions for the architect-to-product MCP server.
 * All project state flows through these interfaces.
 */

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

export type FindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export type FindingStatus = "open" | "fixed" | "accepted" | "false_positive";

export interface Architecture {
  name: string;
  description: string;
  techStack: TechStack;
  features: string[];
  dataModel: string;
  apiDesign: string;
  raw: string; // Original architecture text from user
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
  type: "codebase_memory" | "database" | "playwright";
  command: string;
  installed: boolean;
  config: Record<string, string>;
}

export interface BuildEvent {
  timestamp: string;
  phase: Phase;
  sliceId: string | null;
  action: string;
  details: string;
}

export interface ProjectConfig {
  projectPath: string;
  testCommand: string;
  lintCommand: string;
  buildCommand: string;
  formatCommand: string;
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
  buildHistory: BuildEvent[];
  createdAt: string;
  updatedAt: string;
}
