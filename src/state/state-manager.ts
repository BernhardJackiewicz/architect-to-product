import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { ProjectStateSchema } from "./validators.js";
import { WHITEBOX_CATEGORY_TO_DOMAINS } from "../tools/run-whitebox-audit.js";
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
  AdversarialReviewState,
  BackupConfig,
  BackupStatus,
  InfrastructureRecord,
  LogLevel,
  EventStatus,
  EventMetadata,
  SecurityReentryReason,
  ShakeBreakSession,
  ShakeBreakResult,
  HardeningAreaId,
  SecurityOverview,
  SecurityOverviewCoverageEntry,
} from "./types.js";
import { pruneEvents, sanitizeOutput, truncatePreview } from "../utils/log-sanitizer.js";

const STATE_VERSION = 1;
const STATE_DIR = ".a2p";
const STATE_FILE = "state.json";

/** Valid phase transitions */
const PHASE_TRANSITIONS: Record<Phase, Phase[]> = {
  onboarding: ["planning", "security"],
  planning: ["building"],
  building: ["refactoring", "security"],
  refactoring: ["e2e_testing", "security"],
  e2e_testing: ["security"],
  security: ["deployment", "building"], // back to building if fixes needed
  deployment: ["complete", "planning", "security"],
  complete: ["security"],
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
        allowTestCommandOverride: false,
      },
      companions: [],
      qualityIssues: [],
      auditResults: [],
      whiteboxResults: [],
      activeVerificationResults: [],
      buildHistory: [],
      currentProductPhase: 0,
      infrastructure: null,
      backupConfig: {
        enabled: true, required: false, schedule: "daily", time: "02:00",
        retentionDays: 14, targets: ["deploy_artifacts"],
        offsiteProvider: "none", verifyAfterBackup: false, preDeploySnapshot: false,
      },
      backupStatus: { configured: false },
      companionsConfiguredAt: null,
      lastSecurityRelevantChangeAt: null,
      lastFullSastAt: null,
      lastFullSastFindingCount: 0,
      buildSignoffAt: null,
      buildSignoffSliceHash: null,
      adversarialReviewState: null,
      deployApprovalAt: null,
      deployApprovalStateHash: null,
      projectFindings: [],
      securityReentryReason: null,
      shakeBreakSession: null,
      shakeBreakResults: [],
      securityOverview: null,
      pendingSecurityDecision: null,
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

  /** Compute deterministic hash of slice statuses for signoff validation */
  private computeSliceHash(slices: Slice[]): string {
    return slices.map(s =>
      `${s.id}:${s.status}:${s.acceptanceCriteria.length}:${s.testResults.length}`
    ).join("|");
  }

  /** Compute deterministic hash of deployment-relevant state for approval validation */
  private computeDeployStateHash(state: ProjectState): string {
    const lastWhitebox = state.whiteboxResults[state.whiteboxResults.length - 1];
    const lastAudit = state.auditResults[state.auditResults.length - 1];
    const openFindings = [
      ...state.slices.flatMap(s => s.sastFindings),
      ...state.projectFindings,
    ].filter(f => f.status === "open").length;
    return [
      `sast:${state.lastFullSastAt}`,
      `findings:${openFindings}`,
      `wb:${lastWhitebox?.id ?? "none"}:${lastWhitebox?.blocking_count ?? 0}`,
      `ar:${state.adversarialReviewState?.completedAt ?? "none"}`,
      `audit:${lastAudit?.id ?? "none"}:${lastAudit?.summary.critical ?? 0}`,
      `slices:${state.slices.map(s => `${s.id}:${s.status}`).join(",")}`,
    ].join("|");
  }

  /** Invalidate build signoff when slices/tests change */
  private invalidateBuildSignoff(state: ProjectState): void {
    if (state.buildSignoffAt) {
      state.buildSignoffAt = null;
      state.buildSignoffSliceHash = null;
    }
  }

  /** Invalidate deploy approval when findings/audit/whitebox change */
  private invalidateDeployApproval(state: ProjectState): void {
    if (state.deployApprovalAt) {
      state.deployApprovalAt = null;
      state.deployApprovalStateHash = null;
    }
  }

  /** Mark the timestamp of the last security-relevant change (for stale SAST detection) */
  private setLastSecurityRelevantChange(state: ProjectState): void {
    state.lastSecurityRelevantChangeAt = new Date().toISOString();
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

    // Build signoff gate: block building→security without valid signoff
    if (state.phase === "building" && newPhase === "security") {
      if (!state.buildSignoffAt) {
        throw new Error(
          "Cannot proceed to security without build signoff. Call a2p_build_signoff first."
        );
      }
      if (state.buildSignoffSliceHash !== this.computeSliceHash(state.slices)) {
        throw new Error(
          "Build signoff invalidated by slice changes. Call a2p_build_signoff again."
        );
      }

      // Quality audit gate: at least one quality audit must exist before proceeding to security
      const qualityAudits = state.auditResults.filter((a) => a.mode === "quality");
      if (qualityAudits.length === 0) {
        throw new Error(
          "Cannot proceed to security without a quality audit. Run a2p_run_audit mode=quality first."
        );
      }

      // Quality audit staleness: latest audit must be after last security-relevant change
      const latestQuality = qualityAudits[qualityAudits.length - 1];
      if (state.lastSecurityRelevantChangeAt &&
          latestQuality.timestamp < state.lastSecurityRelevantChangeAt) {
        throw new Error(
          "Quality audit is stale — code changed after last audit. Re-run a2p_run_audit mode=quality."
        );
      }
    }

    // E2E gate: block building→security if project has UI slices + Playwright
    if (state.phase === "building" && newPhase === "security") {
      const hasUISlices = state.slices.some(s => s.hasUI === true);
      const hasPlaywright = state.companions.some(c => c.type === "playwright" && c.installed);
      if (hasUISlices && hasPlaywright) {
        throw new Error(
          "Cannot skip E2E testing: project has UI slices and Playwright is installed. " +
          "Transition to refactoring or e2e_testing first, then to security."
        );
      }
    }

    // E2E gate: block refactoring→security if project has UI slices + Playwright
    if (state.phase === "refactoring" && newPhase === "security") {
      const hasUISlices = state.slices.some(s => s.hasUI === true);
      const hasPlaywright = state.companions.some(c => c.type === "playwright" && c.installed);
      if (hasUISlices && hasPlaywright) {
        throw new Error(
          "Cannot skip E2E testing: project has UI slices and Playwright is installed. " +
          "Transition to e2e_testing first, then to security."
        );
      }
    }

    // Architecture gate: onboarding→security requires architecture (SAST needs tech stack)
    if (state.phase === "onboarding" && newPhase === "security") {
      if (!state.architecture) {
        throw new Error(
          "Cannot enter security without architecture. Call a2p_set_architecture first."
        );
      }
    }

    // Security re-entry: invalidate stale approvals + mark reason
    if (newPhase === "security") {
      const reentryReasons: Record<string, SecurityReentryReason> = {
        onboarding: "security_only",
        deployment: "post_deploy",
        complete: "post_complete",
      };
      const reason = reentryReasons[state.phase];
      if (reason) {
        state.securityReentryReason = reason;
        state.deployApprovalAt = null;
        state.deployApprovalStateHash = null;
        state.adversarialReviewState = null;
        state.lastFullSastAt = null;
        state.lastFullSastFindingCount = 0;
      }
    }

    // Clear reentry reason when leaving security
    if (state.phase === "security" && newPhase !== "security") {
      state.securityReentryReason = null;
    }

    // Security→Deployment gates (ordered by workflow sequence)
    if (state.phase === "security" && newPhase === "deployment") {
      // 1. Full SAST gate: at least one full SAST scan must have been run
      if (!state.lastFullSastAt) {
        throw new Error(
          "Cannot deploy without a full SAST scan. Run a2p_run_sast mode=full first."
        );
      }

      // 2. Stale SAST check: full SAST must be after last security-relevant change
      if (state.lastSecurityRelevantChangeAt &&
          state.lastFullSastAt &&
          state.lastFullSastAt < state.lastSecurityRelevantChangeAt) {
        throw new Error(
          "Full SAST scan is stale — code changed after last scan. Re-run a2p_run_sast mode=full."
        );
      }

      // 3. Open CRITICAL/HIGH SAST findings block deployment
      const openBlockers = [
        ...state.slices.flatMap((s) => s.sastFindings),
        ...state.projectFindings,
      ].filter(
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

      // 4. Whitebox gate: must have run at least once, and no blocking findings
      if (state.whiteboxResults.length === 0) {
        throw new Error(
          "Cannot deploy without whitebox audit. Run a2p_run_whitebox_audit first."
        );
      }
      const lastWhitebox = state.whiteboxResults[state.whiteboxResults.length - 1];
      if (lastWhitebox.blocking_count > 0) {
        throw new Error(
          `Cannot deploy with ${lastWhitebox.blocking_count} blocking whitebox finding(s). Fix all blocking findings before deploying.`
        );
      }

      // 4b. Adversarial review gate: must have completed adversarial review after last whitebox audit
      if (!state.adversarialReviewState) {
        throw new Error(
          "Cannot deploy without adversarial review. Run the adversarial security review (Phase 1b) and confirm with a2p_complete_adversarial_review."
        );
      }

      // 5. Release audit gate: at least one release audit must exist and have no critical findings
      const releaseAudits = state.auditResults.filter((a) => a.mode === "release");
      if (releaseAudits.length === 0) {
        throw new Error(
          "Cannot deploy without a release audit. Run a2p_run_audit mode=release first."
        );
      }
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

      // 6. Active verification gate: at least one verification with no blocking findings
      const verificationResults = state.activeVerificationResults;
      if (verificationResults.length === 0) {
        throw new Error(
          "Cannot deploy without active verification. Run a2p_run_active_verification first."
        );
      }
      const lastVerification = verificationResults[verificationResults.length - 1];
      if (lastVerification.blocking_count > 0) {
        throw new Error(
          `Cannot deploy: last active verification (${lastVerification.id}) has ${lastVerification.blocking_count} blocking finding(s). Fix and re-verify.`
        );
      }

      // 6b. Verification staleness: must be after last security-relevant change
      if (state.lastSecurityRelevantChangeAt &&
          lastVerification.timestamp < state.lastSecurityRelevantChangeAt) {
        throw new Error(
          "Active verification is stale — code changed after last verification. Re-run a2p_run_active_verification."
        );
      }

      // 7. Backup gate: block deployment if stateful app has no backup configured
      if (state.backupConfig.required && !state.backupStatus.configured) {
        throw new Error(
          "Cannot deploy stateful app without backup configuration. Set backupStatus.configured=true via a2p_generate_deployment backup setup, or set backupConfig.required=false if backups are not needed."
        );
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
      // Tests must be run after SAST scan
      if (slice.sastRanAt) {
        if (lastTest.timestamp < slice.sastRanAt) {
          throw new Error(
            `Slice "${sliceId}": tests must be re-run after SAST scan. Last test: ${lastTest.timestamp}, SAST: ${slice.sastRanAt}.`
          );
        }
      }
    }

    // Reset SAST evidence when going back to red (forces re-run after fixes)
    if (newStatus === "red" && slice.status === "sast") {
      slice.sastRanAt = undefined;
    }

    slice.status = newStatus;
    this.invalidateBuildSignoff(state);
    this.invalidateDeployApproval(state);
    this.setLastSecurityRelevantChange(state);
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
    this.invalidateBuildSignoff(state);
    this.setLastSecurityRelevantChange(state);
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
    this.invalidateBuildSignoff(state);
    this.setLastSecurityRelevantChange(state);
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
    } else {
      state.projectFindings.push(finding);
    }

    this.invalidateDeployApproval(state);
    this.setLastSecurityRelevantChange(state);
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
    state.companionsConfiguredAt = new Date().toISOString();
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
    this.invalidateBuildSignoff(state);
    this.setLastSecurityRelevantChange(state);
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

  /** Confirm build signoff — human verified the product works */
  setBuildSignoff(note?: string): ProjectState {
    const state = this.read();
    if (state.phase !== "building") {
      throw new Error("Build signoff only allowed in building phase");
    }
    const notDone = state.slices.filter(s => s.status !== "done");
    if (notDone.length > 0) {
      throw new Error(`Cannot sign off: ${notDone.length} slice(s) not done`);
    }
    state.buildSignoffAt = new Date().toISOString();
    state.buildSignoffSliceHash = this.computeSliceHash(state.slices);
    this.addEvent(state, state.phase, null, "build_signoff",
      `Build signoff confirmed${note ? `: ${note}` : ""}`,
      { level: "info", status: "success" });
    this.write(state);
    return state;
  }

  /** Confirm deploy approval — human approved deployment */
  setDeployApproval(note?: string): ProjectState {
    const state = this.read();
    if (state.phase !== "deployment") {
      throw new Error("Deploy approval only allowed in deployment phase");
    }
    if (!state.lastFullSastAt) {
      throw new Error("Deploy approval requires a full SAST scan first");
    }
    if (state.lastSecurityRelevantChangeAt &&
        state.lastFullSastAt < state.lastSecurityRelevantChangeAt) {
      throw new Error("Full SAST scan is stale. Re-run a2p_run_sast mode=full first.");
    }

    // Active verification gate (mirrors setPhase check)
    const verificationResults = state.activeVerificationResults;
    if (verificationResults.length === 0) {
      throw new Error("Deploy approval requires active verification. Run a2p_run_active_verification first.");
    }
    const lastVerification = verificationResults[verificationResults.length - 1];
    if (lastVerification.blocking_count > 0) {
      throw new Error(
        `Deploy approval blocked: active verification (${lastVerification.id}) has ${lastVerification.blocking_count} blocking finding(s).`
      );
    }

    // Verification staleness (mirrors setPhase check)
    if (state.lastSecurityRelevantChangeAt &&
        lastVerification.timestamp < state.lastSecurityRelevantChangeAt) {
      throw new Error("Active verification is stale. Re-run a2p_run_active_verification.");
    }

    // Backup gate (mirrors setPhase check)
    if (state.backupConfig.required && !state.backupStatus.configured) {
      throw new Error(
        "Deploy approval blocked: stateful app without backup configuration. Configure backup first."
      );
    }

    state.deployApprovalAt = new Date().toISOString();
    state.deployApprovalStateHash = this.computeDeployStateHash(state);
    this.addEvent(state, state.phase, null, "deploy_approval",
      `Deploy approval confirmed${note ? `: ${note}` : ""}`,
      { level: "info", status: "success" });
    this.write(state);
    return state;
  }

  /** Confirm adversarial review completion — agent confirmed Phase 1b is done. Supports multiple rounds. */
  completeAdversarialReview(findingsRecorded: number, note?: string, focusArea?: HardeningAreaId): ProjectState {
    const state = this.read();
    if (state.phase !== "security") {
      throw new Error("Adversarial review completion only allowed in security phase");
    }
    if (state.whiteboxResults.length === 0) {
      throw new Error("Cannot complete adversarial review without running whitebox audit first (a2p_run_whitebox_audit)");
    }
    const now = new Date().toISOString();
    const prev = state.adversarialReviewState;
    const newRound = prev ? prev.round + 1 : 1;
    const totalFindings = (prev?.totalFindingsRecorded ?? 0) + findingsRecorded;
    const roundEntry = {
      round: newRound,
      completedAt: now,
      findingsRecorded,
      note: note ?? "",
      ...(focusArea ? { focusArea } : {}),
    };
    state.adversarialReviewState = {
      completedAt: now,
      round: newRound,
      totalFindingsRecorded: totalFindings,
      roundHistory: [...(prev?.roundHistory ?? []), roundEntry],
    };
    this.invalidateDeployApproval(state);
    this.refreshSecurityOverview(state);
    // Set pending security decision — forces user to acknowledge before proceeding
    const recommendedAreas = state.securityOverview?.recommendedNextAreas ?? [];
    state.pendingSecurityDecision = {
      round: newRound,
      setAt: now,
      recommendedAreas,
      availableActions: ["focused-hardening", "full-round", "shake-break", "continue"],
    };
    this.addEvent(state, state.phase, null, "adversarial_review_completed",
      `Adversarial review round ${newRound} completed: ${findingsRecorded} finding(s) recorded (total: ${totalFindings})${note ? ` — ${note}` : ""}`,
      { level: "info", status: "success" });
    this.write(state);
    return state;
  }

  /** Clear the pending security decision (after user acknowledges or in tests). */
  clearPendingSecurityDecision(): void {
    const state = this.read();
    state.pendingSecurityDecision = null;
    this.write(state);
  }

  /** Mark that a full SAST scan has been completed */
  markFullSastRun(findingCount: number): void {
    const state = this.read();
    state.lastFullSastAt = new Date().toISOString();
    state.lastFullSastFindingCount = findingCount;
    this.invalidateDeployApproval(state);
    this.addEvent(state, state.phase, null, "sast_run",
      `Full SAST scan completed — ${findingCount} finding(s)`,
      { level: "info", status: "success" });
    this.write(state);
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

    const openFindings = [
      ...state.slices.flatMap((s) => s.sastFindings),
      ...state.projectFindings,
    ].filter((f) => f.status === "open").length;

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
    this.invalidateBuildSignoff(state);
    this.setLastSecurityRelevantChange(state);
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
    this.invalidateDeployApproval(state);
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

  /** Record a whitebox audit result — invalidates adversarial review (must re-run Phase 1b) */
  addWhiteboxResult(result: WhiteboxAuditResult): ProjectState {
    const state = this.read();
    state.whiteboxResults.push(result);
    state.adversarialReviewState = null; // New whitebox run invalidates adversarial review (full reset)
    this.invalidateDeployApproval(state);
    this.refreshSecurityOverview(state);
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
    this.refreshSecurityOverview(state);
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

  /** Set infrastructure record (server provisioned) */
  setInfrastructure(record: InfrastructureRecord): ProjectState {
    const state = this.read();
    state.infrastructure = record;
    this.addEvent(state, state.phase, null, "infrastructure_set",
      `Server provisioned: ${record.serverName} (${record.provider}/${record.serverType} @ ${record.location})`,
      { level: "info", status: "success" });
    this.write(state);
    return state;
  }

  /** Update lastDeployedAt timestamp on infrastructure */
  updateLastDeployed(): ProjectState {
    const state = this.read();
    if (!state.infrastructure) {
      throw new Error("No infrastructure recorded. Call a2p_record_server first.");
    }
    state.infrastructure.lastDeployedAt = new Date().toISOString();
    this.addEvent(state, state.phase, null, "deployment_completed",
      `Deployed to ${state.infrastructure.serverIp}`,
      { level: "info", status: "success" });
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

  /** Set the active shake-break session */
  setShakeBreakSession(session: ShakeBreakSession): ProjectState {
    const state = this.read();
    state.shakeBreakSession = session;
    this.addEvent(state, state.phase, null, "shake_break_setup",
      `Shake & Break session started: ${session.categories.join(", ")} on port ${session.port}`,
      { level: "info", status: "info" });
    this.write(state);
    return state;
  }

  /** Clear the active shake-break session */
  clearShakeBreakSession(): ProjectState {
    const state = this.read();
    state.shakeBreakSession = null;
    this.write(state);
    return state;
  }

  /** Add a shake-break result */
  addShakeBreakResult(result: ShakeBreakResult): ProjectState {
    const state = this.read();
    state.shakeBreakResults.push(result);
    this.refreshSecurityOverview(state);
    this.addEvent(state, state.phase, null, "shake_break_teardown",
      `Shake & Break completed: ${result.categoriesTested.join(", ")} — ${result.findingsRecorded} finding(s) in ${result.durationMinutes}min`,
      { level: "info", status: result.findingsRecorded > 0 ? "warning" : "success" });
    this.write(state);
    return state;
  }

  /** Recompute the securityOverview read-model from raw state data */
  private refreshSecurityOverview(state: ProjectState): void {
    const allFindings: SASTFinding[] = [
      ...state.slices.flatMap(s => s.sastFindings),
      ...state.projectFindings,
    ];

    const roundHistory = state.adversarialReviewState?.roundHistory ?? [];
    const focusHistory: HardeningAreaId[] = roundHistory
      .filter((r): r is typeof r & { focusArea: HardeningAreaId } => !!r.focusArea)
      .map(r => r.focusArea);

    // Deduplicated areas explicitly hardened
    const areasExplicitlyHardened = [...new Set(focusHistory)];

    // All hardening area IDs
    const ALL_AREAS: HardeningAreaId[] = [
      "auth-session", "data-access", "business-logic", "input-output",
      "api-surface", "external-integration", "infra-secrets", "vuln-chaining",
    ];

    // Count whitebox findings per hardening area via category mapping
    const whiteboxDomainCounts = new Map<HardeningAreaId, number>();
    for (const wbResult of state.whiteboxResults) {
      for (const wbFinding of wbResult.findings) {
        const mappedDomains = WHITEBOX_CATEGORY_TO_DOMAINS[wbFinding.category] ?? [];
        for (const domain of mappedDomains) {
          whiteboxDomainCounts.set(domain, (whiteboxDomainCounts.get(domain) ?? 0) + 1);
        }
      }
    }

    const coverageByArea: SecurityOverviewCoverageEntry[] = ALL_AREAS.map(areaId => {
      const areaFindings = allFindings.filter(f => f.domains?.includes(areaId));
      const wbCount = whiteboxDomainCounts.get(areaId) ?? 0;
      const wasFocused = focusHistory.includes(areaId);
      const totalFindingCount = areaFindings.length + wbCount;
      const coverageEstimate = Math.min(100, totalFindingCount * 20 + (wasFocused ? 40 : 0));

      // Find last hardened timestamp from round history
      const lastRound = [...roundHistory].reverse().find(r => r.focusArea === areaId);

      return {
        id: areaId,
        coverageEstimate,
        findingCount: totalFindingCount,
        lastHardenedAt: lastRound?.completedAt ?? null,
      };
    });

    // Recommended: areas with lowest coverage, excluding fully covered
    const recommended = coverageByArea
      .filter(c => c.coverageEstimate < 80)
      .sort((a, b) => a.coverageEstimate - b.coverageEstimate)
      .slice(0, 5)
      .map(c => c.id);

    const lastWb = state.whiteboxResults.length > 0
      ? state.whiteboxResults[state.whiteboxResults.length - 1].timestamp
      : null;
    const lastAv = state.activeVerificationResults.length > 0
      ? state.activeVerificationResults[state.activeVerificationResults.length - 1].timestamp
      : null;
    const lastSb = state.shakeBreakResults.length > 0
      ? state.shakeBreakResults[state.shakeBreakResults.length - 1].timestamp
      : null;

    // Last security activity = most recent timestamp among all security actions
    const timestamps = [
      state.adversarialReviewState?.completedAt,
      lastWb, lastAv, lastSb,
    ].filter((t): t is string => !!t);
    const lastSecurityActivityAt = timestamps.length > 0
      ? timestamps.sort().reverse()[0]
      : null;

    state.securityOverview = {
      totalSecurityRounds: state.adversarialReviewState?.round ?? 0,
      lastSecurityActivityAt,
      lastWhiteboxAt: lastWb,
      lastActiveVerificationAt: lastAv,
      lastShakeBreakAt: lastSb,
      areasExplicitlyHardened,
      coverageByArea,
      recommendedNextAreas: recommended,
    };
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
