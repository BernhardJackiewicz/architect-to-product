import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ProjectStateSchema } from "./validators.js";
import type {
  ProjectState,
  Phase,
  SliceStatus,
  Slice,
  BuildEvent,
  SASTFinding,
  QualityIssue,
  CompanionServer,
  TestResult,
  ProductPhase,
  AuditResult,
  WhiteboxAuditResult,
  ActiveVerificationResult,
  BackupConfig,
  BackupStatus,
  LogLevel,
  EventStatus,
  EventMetadata,
} from "./types.js";
import { pruneEvents, sanitizeOutput, truncatePreview } from "../utils/log-sanitizer.js";

const STATE_VERSION = 1;
const STATE_DIR = ".a2p";
const STATE_FILE = "state.json";

/** Valid phase transitions */
const PHASE_TRANSITIONS: Record<Phase, Phase[]> = {
  onboarding: ["planning"],
  planning: ["building"],
  building: ["refactoring", "security"],
  refactoring: ["e2e_testing", "security"],
  e2e_testing: ["security"],
  security: ["deployment", "building"], // back to building if fixes needed
  deployment: ["complete", "planning"],
  complete: [],
};

/** Valid slice status transitions */
const SLICE_TRANSITIONS: Record<SliceStatus, SliceStatus[]> = {
  pending: ["red"],
  red: ["green"],
  green: ["refactor"],
  refactor: ["sast"],
  sast: ["done", "red"], // back to red if critical findings
  done: [],
};

export class StateManager {
  private projectPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
  }

  private get stateDir(): string {
    return join(this.projectPath, STATE_DIR);
  }

  private get statePath(): string {
    return join(this.stateDir, STATE_FILE);
  }

  private get backupPath(): string {
    return join(this.stateDir, `${STATE_FILE}.bak`);
  }

  /** Check if a state file exists for this project */
  exists(): boolean {
    return existsSync(this.statePath);
  }

  /** Create initial state for a new project */
  init(projectName: string, projectPath: string): ProjectState {
    if (this.exists()) {
      throw new Error(`State already exists at ${this.statePath}`);
    }

    const now = new Date().toISOString();
    const state: ProjectState = {
      version: STATE_VERSION,
      projectName,
      architecture: null,
      slices: [],
      currentSliceIndex: -1,
      phase: "onboarding",
      config: {
        projectPath,
        testCommand: "",
        lintCommand: "",
        buildCommand: "",
        formatCommand: "",
        claudeModel: "opus",
      },
      companions: [],
      qualityIssues: [],
      auditResults: [],
      whiteboxResults: [],
      activeVerificationResults: [],
      buildHistory: [],
      currentProductPhase: 0,
      backupConfig: {
        enabled: true, required: false, schedule: "daily", time: "02:00",
        retentionDays: 14, targets: ["deploy_artifacts"],
        offsiteProvider: "none", verifyAfterBackup: false, preDeploySnapshot: false,
      },
      backupStatus: { configured: false },
      createdAt: now,
      updatedAt: now,
    };

    this.write(state);
    return state;
  }

  /** Read and validate state from disk */
  read(): ProjectState {
    if (!this.exists()) {
      throw new Error(`No state file found at ${this.statePath}`);
    }

    const raw = readFileSync(this.statePath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = ProjectStateSchema.safeParse(parsed);

    if (!result.success) {
      throw new Error(
        `Invalid state file: ${result.error.issues.map((i) => i.message).join(", ")}`
      );
    }

    return result.data as ProjectState;
  }

  /** Write state to disk with backup */
  private write(state: ProjectState): void {
    // Ensure directory exists
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }

    // Backup existing state
    if (existsSync(this.statePath)) {
      copyFileSync(this.statePath, this.backupPath);
    }

    state.buildHistory = pruneEvents(state.buildHistory);
    state.updatedAt = new Date().toISOString();
    const json = JSON.stringify(state, null, 2);
    writeFileSync(this.statePath, json, "utf-8");
  }

  /** Transition to a new phase */
  setPhase(newPhase: Phase): ProjectState {
    const state = this.read();
    const allowed = PHASE_TRANSITIONS[state.phase];

    if (!allowed.includes(newPhase)) {
      throw new Error(
        `Cannot transition from "${state.phase}" to "${newPhase}". Allowed: ${allowed.join(", ") || "none"}`
      );
    }

    // Building gate: block leaving building unless all slices are done
    if (state.phase === "building" && (newPhase === "refactoring" || newPhase === "security")) {
      const notDone = state.slices.filter((s) => s.status !== "done");
      if (notDone.length > 0) {
        throw new Error(
          `Cannot leave building phase: ${notDone.length} slice(s) not done: ${notDone.map((s) => s.id).join(", ")}. Complete all slices first.`
        );
      }
    }

    // Security gate: block deployment if open CRITICAL/HIGH findings exist
    if (state.phase === "security" && newPhase === "deployment") {
      const openBlockers = state.slices
        .flatMap((s) => s.sastFindings)
        .filter(
          (f) =>
            f.status === "open" &&
            (f.severity === "critical" || f.severity === "high")
        );

      if (openBlockers.length > 0) {
        const blockerList = openBlockers
          .map((f) => `[${f.severity.toUpperCase()}] ${f.title} — ${f.file}:${f.line}`)
          .join("\n  ");
        throw new Error(
          `Cannot deploy with ${openBlockers.length} open CRITICAL/HIGH finding(s):\n  ${blockerList}\nFix or accept all CRITICAL/HIGH findings before deploying.`
        );
      }

      // Whitebox gate: block deployment if last whitebox has blocking findings
      const lastWhitebox = state.whiteboxResults[state.whiteboxResults.length - 1];
      if (lastWhitebox && lastWhitebox.blocking_count > 0) {
        throw new Error(
          `Cannot deploy with ${lastWhitebox.blocking_count} blocking whitebox finding(s). Fix all blocking findings before deploying.`
        );
      }

      // Audit gate: block deployment if last release audit has critical findings
      const releaseAudits = state.auditResults.filter((a) => a.mode === "release");
      if (releaseAudits.length > 0) {
        const lastRelease = releaseAudits[releaseAudits.length - 1];
        if (lastRelease.summary.critical > 0) {
          const criticalFindings = lastRelease.findings
            .filter((f) => f.severity === "critical")
            .map((f) => `[CRITICAL] ${f.message} — ${f.file}`)
            .join("\n  ");
          throw new Error(
            `Cannot deploy: last release audit (${lastRelease.id}) has ${lastRelease.summary.critical} critical finding(s):\n  ${criticalFindings}\nFix critical findings and re-run a2p_run_audit mode=release.`
          );
        }
      }
    }

    // Backup warning: warn if stateful app deploys without backup configured
    if (state.phase === "security" && newPhase === "deployment") {
      if (state.backupConfig.required && !state.backupStatus.configured) {
        this.addEvent(state, "security", null, "config_update",
          "WARNING: Backup required but not configured — stateful app deploying without backup strategy",
          { level: "warn", status: "warning" });
      }
    }

    state.phase = newPhase;
    this.addEvent(state, newPhase, null, "phase_change", `Phase → ${newPhase}`, { status: "success" });
    this.write(state);
    return state;
  }

  /** Update a slice's status with transition validation and evidence checks */
  setSliceStatus(sliceId: string, newStatus: SliceStatus): ProjectState {
    const state = this.read();
    const slice = state.slices.find((s) => s.id === sliceId);

    if (!slice) {
      throw new Error(`Slice "${sliceId}" not found`);
    }

    const allowed = SLICE_TRANSITIONS[slice.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(
        `Slice "${sliceId}": cannot transition from "${slice.status}" to "${newStatus}". Allowed: ${allowed.join(", ") || "none"}`
      );
    }

    // Evidence guard: green requires passing tests
    if (newStatus === "green") {
      if (slice.testResults.length === 0) {
        throw new Error(
          `Slice "${sliceId}": cannot transition to "green" without test results. Run a2p_run_tests first.`
        );
      }
      const lastTest = slice.testResults[slice.testResults.length - 1];
      if (lastTest.exitCode !== 0) {
        throw new Error(
          `Slice "${sliceId}": cannot transition to "green" — last test run failed (exit code ${lastTest.exitCode}). Tests must pass first.`
        );
      }
    }

    // Evidence guard: sast requires SAST scan
    if (newStatus === "sast") {
      if (!slice.sastRanAt) {
        throw new Error(
          `Slice "${sliceId}": cannot transition to "sast" without running SAST. Call a2p_run_sast first.`
        );
      }
    }

    // Evidence guard: done requires passing tests
    if (newStatus === "done") {
      if (slice.testResults.length === 0) {
        throw new Error(
          `Slice "${sliceId}": cannot mark as "done" without test results. Run a2p_run_tests first.`
        );
      }
      const lastTest = slice.testResults[slice.testResults.length - 1];
      if (lastTest.exitCode !== 0) {
        throw new Error(
          `Slice "${sliceId}": cannot mark as "done" — last test run failed (exit code ${lastTest.exitCode}). Tests must pass first.`
        );
      }
    }

    // Reset SAST evidence when going back to red (forces re-run after fixes)
    if (newStatus === "red" && slice.status === "sast") {
      slice.sastRanAt = undefined;
    }

    slice.status = newStatus;
    this.addEvent(state, state.phase, sliceId, "slice_status", `${sliceId} → ${newStatus}`, { status: "success" });
    this.write(state);
    return state;
  }

  /** Mark that SAST has been run for a slice */
  markSastRun(sliceId: string): void {
    const state = this.read();
    const slice = state.slices.find((s) => s.id === sliceId);
    if (!slice) throw new Error(`Slice "${sliceId}" not found`);
    slice.sastRanAt = new Date().toISOString();
    this.addEvent(state, state.phase, sliceId, "sast_run", `SAST scan completed for ${sliceId}`, { status: "success" });
    this.write(state);
  }

  /** Add slices to the build plan */
  setSlices(slices: Slice[]): ProjectState {
    const state = this.read();
    state.slices = slices;
    state.currentSliceIndex = slices.length > 0 ? 0 : -1;
    this.addEvent(state, state.phase, null, "slices_set", `${slices.length} slices created`, { status: "success" });
    this.write(state);
    return state;
  }

  /** Move to the next slice */
  advanceSlice(): ProjectState {
    const state = this.read();
    const nextIndex = state.currentSliceIndex + 1;

    if (nextIndex >= state.slices.length) {
      throw new Error("No more slices to advance to");
    }

    state.currentSliceIndex = nextIndex;
    const slice = state.slices[nextIndex];
    this.addEvent(state, state.phase, slice.id, "slice_advance", `Now building: ${slice.name}`, { status: "info" });
    this.write(state);
    return state;
  }

  /** Get the current slice being worked on */
  getCurrentSlice(): Slice | null {
    const state = this.read();
    if (state.currentSliceIndex < 0 || state.currentSliceIndex >= state.slices.length) {
      return null;
    }
    return state.slices[state.currentSliceIndex];
  }

  /** Record a test result on the current slice */
  addTestResult(sliceId: string, result: TestResult): ProjectState {
    const state = this.read();
    const slice = state.slices.find((s) => s.id === sliceId);
    if (!slice) throw new Error(`Slice "${sliceId}" not found`);

    slice.testResults.push(result);
    this.addEvent(
      state,
      state.phase,
      sliceId,
      "test_run",
      `Tests: ${result.passed} passed, ${result.failed} failed (exit ${result.exitCode})`,
      { status: result.exitCode === 0 ? "success" : "failure" },
    );
    this.write(state);
    return state;
  }

  /** Record a SAST finding */
  addSASTFinding(sliceId: string | null, finding: SASTFinding): ProjectState {
    const state = this.read();

    if (sliceId) {
      const slice = state.slices.find((s) => s.id === sliceId);
      if (!slice) throw new Error(`Slice "${sliceId}" not found`);
      slice.sastFindings.push(finding);
    }

    this.addEvent(
      state,
      state.phase,
      sliceId,
      "sast_finding",
      `[${finding.severity}] ${finding.title} in ${finding.file}:${finding.line}`,
      { level: "warn", status: "warning" },
    );
    this.write(state);
    return state;
  }

  /** Record a quality issue */
  addQualityIssue(issue: QualityIssue): ProjectState {
    const state = this.read();
    state.qualityIssues.push(issue);
    this.addEvent(
      state,
      state.phase,
      null,
      "quality_issue",
      `[${issue.type}] ${issue.symbol} in ${issue.file}`,
      { level: "warn", status: "warning" },
    );
    this.write(state);
    return state;
  }

  /** Register a companion MCP server */
  addCompanion(companion: CompanionServer): ProjectState {
    const state = this.read();
    const existing = state.companions.findIndex((c) => c.type === companion.type);
    if (existing >= 0) {
      state.companions[existing] = companion;
    } else {
      state.companions.push(companion);
    }
    this.addEvent(
      state,
      state.phase,
      null,
      "companion_added",
      `${companion.name} (${companion.type}): installed=${companion.installed}`,
      { status: "info" },
    );
    this.write(state);
    return state;
  }

  /** Set the architecture */
  setArchitecture(architecture: ProjectState["architecture"]): ProjectState {
    const state = this.read();
    state.architecture = architecture;
    this.addEvent(state, state.phase, null, "architecture_set", `Architecture: ${architecture?.name ?? "cleared"}`, { status: "success" });
    this.write(state);
    return state;
  }

  /** Update project config */
  updateConfig(partial: Partial<ProjectState["config"]>): ProjectState {
    const state = this.read();
    state.config = { ...state.config, ...partial };
    this.addEvent(state, state.phase, null, "config_update", `Config updated: ${Object.keys(partial).join(", ")}`, { status: "info" });
    this.write(state);
    return state;
  }

  /** Set backup configuration */
  setBackupConfig(config: BackupConfig): ProjectState {
    const state = this.read();
    state.backupConfig = config;
    this.addEvent(state, state.phase, null, "config_update",
      `Backup: required=${config.required}, targets=${config.targets.join(",")}`,
      { level: "info", status: "info" });
    this.write(state);
    return state;
  }

  /** Set backup status */
  setBackupStatus(status: BackupStatus): ProjectState {
    const state = this.read();
    state.backupStatus = status;
    this.addEvent(state, state.phase, null, "config_update",
      `Backup status: configured=${status.configured}`,
      { level: "info", status: "info" });
    this.write(state);
    return state;
  }

  /** Get progress summary */
  getProgress(): {
    phase: Phase;
    totalSlices: number;
    doneSlices: number;
    currentSlice: string | null;
    testsPassed: number;
    testsFailed: number;
    openFindings: number;
    qualityIssues: number;
  } {
    const state = this.read();
    const doneSlices = state.slices.filter((s) => s.status === "done").length;
    const current = this.getCurrentSlice();

    let testsPassed = 0;
    let testsFailed = 0;
    for (const slice of state.slices) {
      for (const tr of slice.testResults) {
        testsPassed += tr.passed;
        testsFailed += tr.failed;
      }
    }

    const openFindings = state.slices
      .flatMap((s) => s.sastFindings)
      .filter((f) => f.status === "open").length;

    const openQuality = state.qualityIssues.filter((q) => q.status === "open").length;

    return {
      phase: state.phase,
      totalSlices: state.slices.length,
      doneSlices,
      currentSlice: current?.name ?? null,
      testsPassed,
      testsFailed,
      openFindings,
      qualityIssues: openQuality,
    };
  }

  /** Append slices to the existing build plan (for multi-phase) */
  addSlices(slices: Slice[]): ProjectState {
    const state = this.read();
    const firstNewIndex = state.slices.length;
    state.slices.push(...slices);
    state.currentSliceIndex = firstNewIndex;
    this.addEvent(state, state.phase, null, "slices_added", `${slices.length} slices appended (total: ${state.slices.length})`, { status: "success" });
    this.write(state);
    return state;
  }

  /** Complete the current product phase and advance to next */
  completeProductPhase(): ProjectState {
    const state = this.read();
    const phases = state.architecture?.phases;

    if (!phases || phases.length === 0) {
      throw new Error("No product phases defined in architecture");
    }

    const currentPhase = phases[state.currentProductPhase];
    if (!currentPhase) {
      throw new Error(`Invalid currentProductPhase index: ${state.currentProductPhase}`);
    }

    // Validate all slices of the current phase are done
    const phaseSlices = state.slices.filter((s) => s.productPhaseId === currentPhase.id);
    const notDone = phaseSlices.filter((s) => s.status !== "done");
    if (notDone.length > 0) {
      throw new Error(
        `Cannot complete phase "${currentPhase.name}": ${notDone.length} slice(s) not done (${notDone.map((s) => s.id).join(", ")})`
      );
    }

    const isLast = state.currentProductPhase >= phases.length - 1;

    if (isLast) {
      state.phase = "complete";
      this.addEvent(state, "complete", null, "phase_complete", `Final product phase "${currentPhase.name}" completed → project complete`, { status: "success" });
    } else {
      state.currentProductPhase++;
      state.phase = "planning";
      const nextPhase = phases[state.currentProductPhase];
      this.addEvent(state, "planning", null, "phase_complete", `Product phase "${currentPhase.name}" completed → next: "${nextPhase.name}"`, { status: "success" });
    }

    this.write(state);
    return state;
  }

  /** Get current product phase or null */
  getCurrentProductPhase(): ProductPhase | null {
    const state = this.read();
    const phases = state.architecture?.phases;
    if (!phases || phases.length === 0) return null;
    return phases[state.currentProductPhase] ?? null;
  }

  /** Check if current phase is the last one */
  isLastProductPhase(): boolean {
    const state = this.read();
    const phases = state.architecture?.phases;
    if (!phases || phases.length === 0) return true;
    return state.currentProductPhase >= phases.length - 1;
  }

  /** Add build events (for tools that record external results like E2E) */
  addBuildEvents(events: Array<Omit<BuildEvent, "timestamp">>): ProjectState {
    const state = this.read();
    for (const event of events) {
      state.buildHistory.push({
        ...event,
        timestamp: new Date().toISOString(),
      });
    }
    this.write(state);
    return state;
  }

  /** Update files tracked by a slice (merge with existing) */
  updateSliceFiles(sliceId: string, files: string[]): void {
    const state = this.read();
    const slice = state.slices.find((s) => s.id === sliceId);
    if (!slice) throw new Error(`Slice "${sliceId}" not found`);
    const existing = new Set(slice.files);
    for (const f of files) existing.add(f);
    slice.files = [...existing];
    this.addEvent(state, state.phase, sliceId, "files_updated", `${files.length} file(s) updated on ${sliceId}`, { status: "info" });
    this.write(state);
  }

  /** Set the current slice index (for index preservation after insert/append) */
  setCurrentSliceIndex(index: number): void {
    const state = this.read();
    if (index < -1 || (index >= state.slices.length && state.slices.length > 0)) {
      throw new Error(`Invalid slice index: ${index} (${state.slices.length} slices)`);
    }
    state.currentSliceIndex = index;
    this.write(state);
  }

  /** Record an audit result */
  addAuditResult(result: AuditResult): ProjectState {
    const state = this.read();
    state.auditResults.push(result);
    this.addEvent(
      state,
      state.phase,
      null,
      "audit_run",
      `[${result.mode}] ${result.id}: ${result.findings.length} findings (C:${result.summary.critical} H:${result.summary.high} M:${result.summary.medium} L:${result.summary.low})`,
      { status: result.summary.critical > 0 ? "failure" : result.summary.high > 0 ? "warning" : "success" },
    );
    this.write(state);
    return state;
  }

  /** Record a whitebox audit result */
  addWhiteboxResult(result: WhiteboxAuditResult): ProjectState {
    const state = this.read();
    state.whiteboxResults.push(result);
    this.addEvent(
      state,
      state.phase,
      null,
      "whitebox_audit",
      `[${result.mode}] ${result.id}: ${result.findings.length} findings (blocking: ${result.blocking_count})`,
      { status: result.blocking_count > 0 ? "failure" : result.findings.length > 0 ? "warning" : "success" },
    );
    this.write(state);
    return state;
  }

  /** Record an active verification result */
  addActiveVerificationResult(result: ActiveVerificationResult): ProjectState {
    const state = this.read();
    state.activeVerificationResults.push(result);
    this.addEvent(
      state,
      state.phase,
      null,
      "active_verification",
      `${result.id} round ${result.round}: ${result.tests_passed}/${result.tests_run} passed (blocking: ${result.blocking_count})`,
      { status: result.blocking_count > 0 ? "failure" : result.tests_failed > 0 ? "warning" : "success" },
    );
    this.write(state);
    return state;
  }

  /** Public structured log method */
  log(level: LogLevel, action: string, details: string, opts?: {
    sliceId?: string | null;
    status?: EventStatus;
    durationMs?: number;
    runId?: string;
    metadata?: EventMetadata;
    outputSummary?: string;
    outputRef?: string;
  }): void {
    const state = this.read();
    const sanitized = opts?.outputSummary
      ? truncatePreview(sanitizeOutput(opts.outputSummary))
      : undefined;
    const wasTruncated = opts?.outputSummary
      ? opts.outputSummary.length > 500
      : undefined;
    this.addEvent(state, state.phase, opts?.sliceId ?? null, action, details, {
      level,
      status: opts?.status,
      durationMs: opts?.durationMs,
      runId: opts?.runId,
      metadata: opts?.metadata,
      outputSummary: sanitized,
      outputRef: opts?.outputRef,
      outputTruncated: wasTruncated || undefined,
    });
    this.write(state);
  }

  private addEvent(
    state: ProjectState,
    phase: Phase,
    sliceId: string | null,
    action: string,
    details: string,
    opts?: {
      level?: LogLevel;
      status?: EventStatus;
      durationMs?: number;
      runId?: string;
      metadata?: EventMetadata;
      outputSummary?: string;
      outputRef?: string;
      outputTruncated?: boolean;
    },
  ): void {
    const event: BuildEvent = {
      timestamp: new Date().toISOString(),
      phase,
      sliceId,
      action,
      details,
    };
    if (opts?.level) event.level = opts.level;
    if (opts?.status) event.status = opts.status;
    if (opts?.durationMs !== undefined) event.durationMs = opts.durationMs;
    if (opts?.runId) event.runId = opts.runId;
    if (opts?.metadata) event.metadata = opts.metadata;
    if (opts?.outputSummary) event.outputSummary = opts.outputSummary;
    if (opts?.outputRef) event.outputRef = opts.outputRef;
    if (opts?.outputTruncated) event.outputTruncated = opts.outputTruncated;
    state.buildHistory.push(event);
  }
}
