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
} from "./types.js";

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
      },
      companions: [],
      qualityIssues: [],
      buildHistory: [],
      currentProductPhase: 0,
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

    state.phase = newPhase;
    this.addEvent(state, newPhase, null, "phase_change", `Phase → ${newPhase}`);
    this.write(state);
    return state;
  }

  /** Update a slice's status with transition validation */
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

    slice.status = newStatus;
    this.addEvent(state, state.phase, sliceId, "slice_status", `${sliceId} → ${newStatus}`);
    this.write(state);
    return state;
  }

  /** Add slices to the build plan */
  setSlices(slices: Slice[]): ProjectState {
    const state = this.read();
    state.slices = slices;
    state.currentSliceIndex = slices.length > 0 ? 0 : -1;
    this.addEvent(state, state.phase, null, "slices_set", `${slices.length} slices created`);
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
    this.addEvent(state, state.phase, slice.id, "slice_advance", `Now building: ${slice.name}`);
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
      `Tests: ${result.passed} passed, ${result.failed} failed (exit ${result.exitCode})`
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
      `[${finding.severity}] ${finding.title} in ${finding.file}:${finding.line}`
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
      `[${issue.type}] ${issue.symbol} in ${issue.file}`
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
      `${companion.name} (${companion.type}): installed=${companion.installed}`
    );
    this.write(state);
    return state;
  }

  /** Set the architecture */
  setArchitecture(architecture: ProjectState["architecture"]): ProjectState {
    const state = this.read();
    state.architecture = architecture;
    this.addEvent(state, state.phase, null, "architecture_set", `Architecture: ${architecture?.name ?? "cleared"}`);
    this.write(state);
    return state;
  }

  /** Update project config */
  updateConfig(partial: Partial<ProjectState["config"]>): ProjectState {
    const state = this.read();
    state.config = { ...state.config, ...partial };
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
    this.addEvent(state, state.phase, null, "slices_added", `${slices.length} slices appended (total: ${state.slices.length})`);
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
      this.addEvent(state, "complete", null, "phase_complete", `Final product phase "${currentPhase.name}" completed → project complete`);
    } else {
      state.currentProductPhase++;
      state.phase = "planning";
      const nextPhase = phases[state.currentProductPhase];
      this.addEvent(state, "planning", null, "phase_complete", `Product phase "${currentPhase.name}" completed → next: "${nextPhase.name}"`);
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

  private addEvent(
    state: ProjectState,
    phase: Phase,
    sliceId: string | null,
    action: string,
    details: string
  ): void {
    const event: BuildEvent = {
      timestamp: new Date().toISOString(),
      phase,
      sliceId,
      action,
      details,
    };
    state.buildHistory.push(event);
  }
}
