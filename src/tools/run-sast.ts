import { z } from "zod";
import { requireProject, requirePhase, truncate } from "../utils/tool-helpers.js";
import { runProcess } from "../utils/process-runner.js";
import { generateRunId } from "../utils/log-sanitizer.js";
import type { SASTFinding, FindingSeverity } from "../state/types.js";

export const runSastSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  sliceId: z.string().nullable().describe("Slice ID (null for full scan)"),
  mode: z
    .enum(["slice", "full"])
    .describe("slice = only changed files (fast), full = entire codebase"),
  files: z
    .array(z.string())
    .optional()
    .describe("Specific files to scan (for slice mode)"),
});

export type RunSastInput = z.infer<typeof runSastSchema>;

export function handleRunSast(input: RunSastInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try {
    if (input.mode === "slice") {
      requirePhase(state.phase, ["building"], "a2p_run_sast mode=slice");
    } else {
      requirePhase(state.phase, ["security"], "a2p_run_sast mode=full");
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const results: {
    tool: string;
    available: boolean;
    findings: SASTFinding[];
    rawOutput: string;
    durationMs?: number;
  }[] = [];

  // Run Semgrep (works for all languages)
  const semgrepResult = runSemgrep(input);
  results.push(semgrepResult);

  // Run Bandit (Python only) in full mode
  if (input.mode === "full") {
    const lang = state.architecture?.techStack.language?.toLowerCase() ?? "";
    if (lang.includes("python")) {
      const banditResult = runBandit(input);
      results.push(banditResult);
    }
  }

  // Record findings in state (deduplicate by tool+file+line+title fingerprint)
  const allFindings = results.flatMap((r) => r.findings);
  const freshState = sm.read();
  const existingFingerprints = new Set(
    freshState.slices
      .flatMap((s) => s.sastFindings)
      .map((f) => `${f.tool}:${f.file}:${f.line}:${f.title}`)
  );

  // Mark SAST as run for this slice (evidence for status transition guard)
  if (input.sliceId) {
    sm.markSastRun(input.sliceId);
  }

  // Mark full SAST run (evidence for deployment gate)
  if (input.mode === "full") {
    sm.markFullSastRun(allFindings.length);
  }

  let newCount = 0;
  let duplicateCount = 0;
  for (const finding of allFindings) {
    const fingerprint = `${finding.tool}:${finding.file}:${finding.line}:${finding.title}`;
    if (existingFingerprints.has(fingerprint)) {
      duplicateCount++;
      continue;
    }
    existingFingerprints.add(fingerprint);
    sm.addSASTFinding(input.sliceId, finding);
    newCount++;
  }

  const bySeverity = {
    critical: allFindings.filter((f) => f.severity === "critical").length,
    high: allFindings.filter((f) => f.severity === "high").length,
    medium: allFindings.filter((f) => f.severity === "medium").length,
    low: allFindings.filter((f) => f.severity === "low").length,
  };

  const runId = generateRunId();
  const totalDurationMs = results.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const summaryLine = `SAST: ${allFindings.length} findings (C:${bySeverity.critical} H:${bySeverity.high} M:${bySeverity.medium} L:${bySeverity.low})`;

  sm.log(
    bySeverity.critical + bySeverity.high > 0 ? "warn" : "info",
    "sast_run",
    summaryLine,
    {
      sliceId: input.sliceId,
      status: bySeverity.critical + bySeverity.high > 0 ? "warning" : "success",
      durationMs: totalDurationMs,
      runId,
      metadata: { findingCount: allFindings.length, toolName: "sast", bySeverity },
      outputSummary: summaryLine,
    },
  );

  return JSON.stringify({
    success: true,
    mode: input.mode,
    toolsRun: results.map((r) => ({ tool: r.tool, available: r.available, findings: r.findings.length })),
    totalFindings: allFindings.length,
    newFindings: newCount,
    duplicatesSkipped: duplicateCount,
    bySeverity,
    durationMs: totalDurationMs,
    findings: allFindings.slice(0, 20), // first 20 for readability
    hint:
      bySeverity.critical + bySeverity.high > 0
        ? "CRITICAL/HIGH findings detected. Fix these before proceeding."
        : allFindings.length > 0
          ? "Only medium/low findings. Review and fix or accept as appropriate."
          : "No findings. Code looks clean!",
  });
}

function runSemgrep(input: RunSastInput): {
  tool: string;
  available: boolean;
  findings: SASTFinding[];
  rawOutput: string;
  durationMs?: number;
} {
  // Check if semgrep is available
  const check = runProcess("which semgrep", input.projectPath, 5000);
  if (check.exitCode !== 0) {
    return {
      tool: "semgrep",
      available: false,
      findings: [],
      rawOutput: "Semgrep not installed. Install: pip install semgrep",
    };
  }

  let cmd = "semgrep scan --config auto --json";
  if (input.mode === "slice" && input.files && input.files.length > 0) {
    const includes = input.files.map((f) => `--include "${f}"`).join(" ");
    cmd += ` ${includes}`;
  }
  cmd += " --exclude=node_modules --exclude=.venv --exclude=venv --exclude=dist --exclude=__pycache__ 2>/dev/null";

  const result = runProcess(cmd, input.projectPath, 120_000);

  let findings: SASTFinding[] = [];
  try {
    const parsed = JSON.parse(result.stdout);
    const semgrepResults = parsed.results ?? [];
    findings = semgrepResults.map((r: any, i: number) => ({
      id: `SG-${String(i + 1).padStart(3, "0")}`,
      tool: "semgrep",
      severity: mapSemgrepSeverity(r.extra?.severity ?? "INFO"),
      status: "open" as const,
      title: r.check_id ?? "Unknown rule",
      file: r.path ?? "",
      line: r.start?.line ?? 0,
      description: r.extra?.message ?? "",
      fix: r.extra?.fix ?? "",
    }));
  } catch {
    // JSON parse failed, return raw output
  }

  return {
    tool: "semgrep",
    available: true,
    findings,
    rawOutput: truncate(result.stdout, 3000),
    durationMs: result.durationMs,
  };
}

function runBandit(input: RunSastInput): {
  tool: string;
  available: boolean;
  findings: SASTFinding[];
  rawOutput: string;
  durationMs?: number;
} {
  const check = runProcess("which bandit", input.projectPath, 5000);
  if (check.exitCode !== 0) {
    return {
      tool: "bandit",
      available: false,
      findings: [],
      rawOutput: "Bandit not installed. Install: pip install bandit",
    };
  }

  const cmd =
    "bandit -r . --exclude=./.venv,./venv,./__pycache__,./tests,./node_modules -f json 2>/dev/null";
  const result = runProcess(cmd, input.projectPath, 120_000);

  let findings: SASTFinding[] = [];
  try {
    const parsed = JSON.parse(result.stdout);
    const banditResults = parsed.results ?? [];
    findings = banditResults.map((r: any, i: number) => ({
      id: `BAN-${String(i + 1).padStart(3, "0")}`,
      tool: "bandit",
      severity: mapBanditSeverity(r.issue_severity ?? "LOW"),
      status: "open" as const,
      title: `[${r.test_id}] ${r.issue_text ?? ""}`,
      file: r.filename ?? "",
      line: r.line_number ?? 0,
      description: r.issue_text ?? "",
      fix: "",
    }));
  } catch {
    // JSON parse failed
  }

  return {
    tool: "bandit",
    available: true,
    findings,
    rawOutput: truncate(result.stdout, 3000),
    durationMs: result.durationMs,
  };
}

function mapSemgrepSeverity(sev: string): FindingSeverity {
  switch (sev.toUpperCase()) {
    case "ERROR":
      return "high";
    case "WARNING":
      return "medium";
    case "INFO":
      return "low";
    default:
      return "info";
  }
}

function mapBanditSeverity(sev: string): FindingSeverity {
  switch (sev.toUpperCase()) {
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

