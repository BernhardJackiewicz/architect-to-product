import { z } from "zod";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { requireProject, requirePhaseAndMode, truncate } from "../utils/tool-helpers.js";
import { runProcess } from "../utils/process-runner.js";
import { generateRunId, sanitizeOutput } from "../utils/log-sanitizer.js";
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
    requirePhaseAndMode(state.phase, ["building", "security"], "a2p_run_sast", input.mode, {
      slice: ["building"],
      full: ["security"],
    });
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

  // Dependency scanning (npm audit / pip-audit)
  if (input.mode === "full") {
    const depResults = runDependencyScanning(input.projectPath);
    for (const dr of depResults) {
      results.push(dr);
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

  const sastExtras = {
    durationMs: totalDurationMs,
    runId,
    metadata: { findingCount: allFindings.length, toolName: "sast", bySeverity },
    outputSummary: summaryLine,
  };

  // Mark SAST as run for this slice (evidence for status transition guard)
  if (input.sliceId) {
    sm.markSastRun(input.sliceId, sastExtras);
  }

  // Mark full SAST run (evidence for deployment gate)
  if (input.mode === "full") {
    sm.markFullSastRun(allFindings.length, sastExtras);
  }

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
    rawOutput: sanitizeOutput(truncate(result.stdout, 3000)),
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
    rawOutput: sanitizeOutput(truncate(result.stdout, 3000)),
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

function mapNpmAuditSeverity(sev: string): FindingSeverity {
  switch (sev.toLowerCase()) {
    case "critical":
      return "critical";
    case "high":
      return "high";
    case "moderate":
      return "medium";
    case "low":
      return "low";
    case "info":
      return "info";
    default:
      return "info";
  }
}

function mapPipAuditSeverity(sev: string): FindingSeverity {
  switch (sev.toUpperCase()) {
    case "CRITICAL":
      return "critical";
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

export function runDependencyScanning(projectPath: string): Array<{
  tool: string;
  available: boolean;
  findings: SASTFinding[];
  rawOutput: string;
  durationMs?: number;
}> {
  const results: Array<{
    tool: string;
    available: boolean;
    findings: SASTFinding[];
    rawOutput: string;
    durationMs?: number;
  }> = [];

  // npm audit
  const hasPackageLock = existsSync(join(projectPath, "package-lock.json"));
  const hasPackageJson = existsSync(join(projectPath, "package.json"));
  if (hasPackageLock || hasPackageJson) {
    const npmCheck = runProcess("which npm", projectPath, 5000);
    if (npmCheck.exitCode === 0) {
      const npmResult = runProcess("npm audit --json 2>/dev/null", projectPath, 60_000);
      let findings: SASTFinding[] = [];
      try {
        const parsed = JSON.parse(npmResult.stdout);
        const vulnerabilities = parsed.vulnerabilities ?? {};
        let idx = 0;
        for (const [pkgName, vuln] of Object.entries<any>(vulnerabilities)) {
          idx++;
          const severity = mapNpmAuditSeverity(vuln.severity ?? "info");
          const viaStr = Array.isArray(vuln.via)
            ? vuln.via
                .filter((v: any) => typeof v === "object")
                .map((v: any) => v.title ?? v.name ?? "")
                .filter(Boolean)
                .join("; ")
            : "";
          findings.push({
            id: `NPM-${String(idx).padStart(3, "0")}`,
            tool: "npm-audit",
            severity,
            status: "open" as const,
            title: `Vulnerable dependency: ${pkgName} (${vuln.range ?? "unknown version"})`,
            file: "package.json",
            line: 0,
            description: viaStr || `${pkgName}: ${vuln.severity ?? "unknown"} severity vulnerability`,
            fix: vuln.fixAvailable ? "Fix available via npm audit fix" : "No automatic fix available",
          });
        }
      } catch {
        // npm audit may not return valid JSON (e.g., no lock file)
      }
      results.push({
        tool: "npm-audit",
        available: true,
        findings,
        rawOutput: sanitizeOutput(truncate(npmResult.stdout, 3000)),
        durationMs: npmResult.durationMs,
      });
    } else {
      results.push({
        tool: "npm-audit",
        available: false,
        findings: [],
        rawOutput: "npm not available",
      });
    }
  }

  // pip-audit
  const hasRequirements = existsSync(join(projectPath, "requirements.txt"));
  const hasPipfile = existsSync(join(projectPath, "Pipfile.lock"));
  if (hasRequirements || hasPipfile) {
    const pipCheck = runProcess("which pip-audit", projectPath, 5000);
    if (pipCheck.exitCode === 0) {
      const pipResult = runProcess("pip-audit --format json 2>/dev/null", projectPath, 120_000);
      let findings: SASTFinding[] = [];
      try {
        const parsed = JSON.parse(pipResult.stdout);
        const deps = Array.isArray(parsed) ? parsed : (parsed.dependencies ?? []);
        let idx = 0;
        for (const dep of deps) {
          if (!dep.vulns || dep.vulns.length === 0) continue;
          for (const vuln of dep.vulns) {
            idx++;
            findings.push({
              id: `PIP-${String(idx).padStart(3, "0")}`,
              tool: "pip-audit",
              severity: mapPipAuditSeverity(vuln.fix_versions?.[0] ? "high" : "medium"),
              status: "open" as const,
              title: `Vulnerable dependency: ${dep.name} ${dep.version} (${vuln.id})`,
              file: hasRequirements ? "requirements.txt" : "Pipfile.lock",
              line: 0,
              description: vuln.description ?? `${vuln.id}: vulnerability in ${dep.name}`,
              fix: vuln.fix_versions?.length ? `Upgrade to ${vuln.fix_versions.join(" or ")}` : "No fix available",
            });
          }
        }
      } catch {
        // pip-audit may not return valid JSON
      }
      results.push({
        tool: "pip-audit",
        available: true,
        findings,
        rawOutput: sanitizeOutput(truncate(pipResult.stdout, 3000)),
        durationMs: pipResult.durationMs,
      });
    } else {
      results.push({
        tool: "pip-audit",
        available: false,
        findings: [],
        rawOutput: "pip-audit not installed. Install: pip install pip-audit",
      });
    }
  }

  return results;
}

