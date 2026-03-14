import { z } from "zod";
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, extname } from "node:path";
import { requireProject, requirePhaseAndMode, truncate } from "../utils/tool-helpers.js";
import { runProcess } from "../utils/process-runner.js";
import { generateRunId, sanitizeOutput } from "../utils/log-sanitizer.js";
import type { AuditFinding, AuditResult, FindingSeverity } from "../state/types.js";

export const runAuditSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  mode: z.enum(["quality", "release"]).describe("quality = dev hygiene, release = pre-publish checks"),
  runBuild: z.boolean().optional().default(true).describe("Run build command if configured"),
  runTests: z.boolean().optional().default(true).describe("Run test command if configured"),
});

export type RunAuditInput = z.infer<typeof runAuditSchema>;

const SOURCE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".vue", ".svelte", ".astro", ".mjs", ".cjs",
]);
const TEST_PATTERNS = ["test", "spec", "__tests__", "__mocks__"];
const EXCLUDED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage",
  ".a2p", ".venv", "venv", "__pycache__", ".turbo", ".cache",
]);

export function handleRunAudit(input: RunAuditInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const auditStart = Date.now();
  const state = sm.read();
  try {
    requirePhaseAndMode(state.phase, ["building", "security", "deployment"], "a2p_run_audit", input.mode, {
      quality: ["building"],
      release: ["security", "deployment"],
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
  const findings: AuditFinding[] = [];

  // --- Grep-based checks (both modes) ---

  // Collect source files
  const sourceFiles = collectSourceFiles(input.projectPath);

  // 1. TODO/FIXME/HACK
  const todoPattern = /\b(TODO|FIXME|HACK|XXX)\b/;
  for (const file of sourceFiles) {
    scanFile(file, input.projectPath, todoPattern, "todo", "low", findings,
      (match) => `${match} comment found`,
      "Resolve or remove the comment");
  }

  // 2. Debug artifacts
  const debugPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\bconsole\.log\b/, name: "console.log" },
    { pattern: /\bconsole\.debug\b/, name: "console.debug" },
    { pattern: /\bdebugger\b/, name: "debugger statement" },
    { pattern: /\bprint\(/, name: "print()" },
  ];
  for (const file of sourceFiles) {
    // Skip print() check for non-Python files
    for (const dp of debugPatterns) {
      if (dp.name === "print()" && !file.endsWith(".py")) continue;
      scanFile(file, input.projectPath, dp.pattern, "debug_artifact", "medium", findings,
        () => `${dp.name} found`,
        "Remove debug statement before release");
    }
  }

  // 3. Hardcoded secrets
  const secretPatterns = [
    /(?:password|passwd|pwd)\s*=\s*["'][^"']+["']/i,
    /(?:api_key|apikey|api_secret)\s*=\s*["'][^"']+["']/i,
    /(?:secret_key|secret)\s*=\s*["'][^"']+["']/i,
    /(?:access_token|auth_token)\s*=\s*["'][^"']+["']/i,
  ];
  for (const file of sourceFiles) {
    if (isTestFile(file)) continue;
    for (const sp of secretPatterns) {
      scanFile(file, input.projectPath, sp, "hardcoded_secret", "high", findings,
        () => "Possible hardcoded secret",
        "Use environment variables instead");
    }
  }

  // 4. Committed .env file
  const envPath = join(input.projectPath, ".env");
  if (existsSync(envPath)) {
    findings.push({
      category: "env_committed",
      severity: "high",
      file: ".env",
      line: 0,
      message: ".env file exists in project root — may contain secrets",
      fix: "Add .env to .gitignore and remove from version control",
    });
  }

  // 5. .gitignore missing entries
  checkGitignore(input.projectPath, findings);

  // 6. Test-to-source ratio
  let testFileCount = 0;
  let srcFileCount = 0;
  for (const file of sourceFiles) {
    if (isTestFile(file)) {
      testFileCount++;
    } else {
      srcFileCount++;
    }
  }
  if (srcFileCount > 0) {
    const ratio = testFileCount / srcFileCount;
    if (ratio < 0.3) {
      findings.push({
        category: "low_test_coverage",
        severity: "medium",
        file: "project",
        line: 0,
        message: `Test-to-source ratio is ${ratio.toFixed(2)} (${testFileCount} test files / ${srcFileCount} source files). Target: >= 0.3`,
        fix: "Add more tests to improve coverage",
      });
    }
  }

  // --- Build & Test ---
  let buildPassed: boolean | null = null;
  let testsPassed: boolean | null = null;

  if (input.runBuild && state.config.buildCommand) {
    const buildResult = runProcess(state.config.buildCommand, input.projectPath, 120_000);
    buildPassed = buildResult.exitCode === 0;
    if (!buildPassed) {
      findings.push({
        category: "build_failure",
        severity: "critical",
        file: "project",
        line: 0,
        message: `Build failed: ${truncate(sanitizeOutput(buildResult.stderr || buildResult.stdout), 500)}`,
        fix: "Fix build errors",
      });
    }
  }

  if (input.runTests && state.config.testCommand) {
    const testResult = runProcess(state.config.testCommand, input.projectPath, 300_000);
    testsPassed = testResult.exitCode === 0;
    if (!testsPassed) {
      findings.push({
        category: "test_failure",
        severity: "critical",
        file: "project",
        line: 0,
        message: `Tests failed: ${truncate(sanitizeOutput(testResult.stderr || testResult.stdout), 500)}`,
        fix: "Fix failing tests",
      });
    }
  }

  // --- Release-only checks ---
  if (input.mode === "release") {
    // README check
    const readmePath = join(input.projectPath, "README.md");
    if (!existsSync(readmePath)) {
      findings.push({
        category: "missing_readme",
        severity: "high",
        file: "README.md",
        line: 0,
        message: "README.md is missing",
        fix: "Create a README.md with installation, usage, and configuration sections",
      });
    } else {
      let readmeContent: string;
      try {
        readmeContent = readFileSync(readmePath, "utf-8");
      } catch {
        readmeContent = "";
      }
      const readmeLines = readmeContent.split("\n").length;
      if (readmeLines < 50) {
        findings.push({
          category: "thin_readme",
          severity: "medium",
          file: "README.md",
          line: 0,
          message: `README.md has only ${readmeLines} lines (target: >= 50)`,
          fix: "Expand README with more detail",
        });
      }
      const lower = readmeContent.toLowerCase();
      if (!lower.includes("installation") && !lower.includes("install")) {
        findings.push({
          category: "readme_missing_section",
          severity: "medium",
          file: "README.md",
          line: 0,
          message: "README.md missing 'Installation' section",
          fix: "Add installation instructions",
        });
      }
      if (!lower.includes("usage")) {
        findings.push({
          category: "readme_missing_section",
          severity: "medium",
          file: "README.md",
          line: 0,
          message: "README.md missing 'Usage' section",
          fix: "Add usage instructions",
        });
      }
    }

    // Temp files
    const tempExtensions = [".tmp", ".bak", ".orig", ".swp"];
    for (const file of sourceFiles) {
      const ext = extname(file);
      if (tempExtensions.includes(ext)) {
        findings.push({
          category: "temp_file",
          severity: "medium",
          file: file,
          line: 0,
          message: `Temporary file found: ${file}`,
          fix: "Remove temporary files before release",
        });
      }
    }

    // Aggregate open SAST/Quality findings from state
    const openSast = state.slices
      .flatMap((s) => s.sastFindings)
      .filter((f) => f.status === "open").length;
    const openQuality = state.qualityIssues.filter((q) => q.status === "open").length;

    if (openSast > 0) {
      findings.push({
        category: "open_sast_findings",
        severity: "critical",
        file: "state",
        line: 0,
        message: `${openSast} open SAST finding(s) remain unresolved`,
        fix: "Fix or accept all SAST findings before release",
      });
    }
    if (openQuality > 0) {
      findings.push({
        category: "open_quality_issues",
        severity: "medium",
        file: "state",
        line: 0,
        message: `${openQuality} open quality issue(s) remain unresolved`,
        fix: "Fix or accept quality issues before release",
      });
    }
  }

  // --- Aggregate & persist ---
  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const openSastFindings = state.slices
    .flatMap((s) => s.sastFindings)
    .filter((f) => f.status === "open").length;
  const openQualityIssues = state.qualityIssues.filter((q) => q.status === "open").length;
  const slicesDone = state.slices.filter((s) => s.status === "done").length;

  const existingAudits = state.auditResults.length;
  const auditId = `AUD-${String(existingAudits + 1).padStart(3, "0")}`;

  const result: AuditResult = {
    id: auditId,
    mode: input.mode,
    timestamp: new Date().toISOString(),
    findings,
    summary,
    buildPassed,
    testsPassed,
    aggregated: {
      openSastFindings,
      openQualityIssues,
      slicesDone,
      slicesTotal: state.slices.length,
    },
  };

  sm.addAuditResult(result);

  const durationMs = Date.now() - auditStart;
  const runId = generateRunId();
  sm.log(
    summary.critical > 0 ? "error" : summary.high > 0 ? "warn" : "info",
    "audit_run",
    `[${input.mode}] ${auditId}: ${findings.length} findings`,
    {
      status: summary.critical > 0 ? "failure" : summary.high > 0 ? "warning" : "success",
      durationMs,
      runId,
      metadata: { mode: input.mode, findingCount: findings.length, toolName: "audit" },
    },
  );

  return JSON.stringify({
    success: true,
    auditId,
    mode: input.mode,
    findings,
    totalFindings: findings.length,
    bySeverity: summary,
    buildPassed,
    testsPassed,
    aggregated: result.aggregated,
    hint: summary.critical > 0
      ? "CRITICAL findings detected. Fix these immediately."
      : summary.high > 0
        ? "HIGH findings detected. Fix before release."
        : findings.length > 0
          ? "Only medium/low findings. Review and address as appropriate."
          : "No findings. Code looks clean!",
  });
}

// --- Helpers ---

function collectSourceFiles(dir: string, relativePath = ""): string[] {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (EXCLUDED_DIRS.has(entry)) continue;
    const fullPath = join(dir, entry);
    const relPath = relativePath ? `${relativePath}/${entry}` : entry;
    let stat;
    try {
      stat = lstatSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath, relPath));
    } else {
      const ext = extname(entry);
      if (SOURCE_EXTENSIONS.has(ext) || [".tmp", ".bak", ".orig", ".swp"].includes(ext)) {
        files.push(relPath);
      }
    }
  }
  return files;
}

function isTestFile(file: string): boolean {
  return TEST_PATTERNS.some((p) => file.includes(p));
}

function scanFile(
  relPath: string,
  projectPath: string,
  pattern: RegExp,
  category: string,
  severity: FindingSeverity,
  findings: AuditFinding[],
  messageFn: (match: string) => string,
  fix: string,
): void {
  if (isTestFile(relPath)) return;
  const fullPath = join(projectPath, relPath);
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    return;
  }
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(pattern);
    if (match) {
      findings.push({
        category,
        severity,
        file: relPath,
        line: i + 1,
        message: messageFn(match[0]),
        fix,
      });
    }
  }
}

function checkGitignore(projectPath: string, findings: AuditFinding[]): void {
  const gitignorePath = join(projectPath, ".gitignore");
  const expectedEntries = ["node_modules", ".env", "dist", "coverage", ".DS_Store"];

  if (!existsSync(gitignorePath)) {
    findings.push({
      category: "missing_gitignore",
      severity: "medium",
      file: ".gitignore",
      line: 0,
      message: ".gitignore file is missing",
      fix: "Create a .gitignore with standard entries",
    });
    return;
  }

  let content: string;
  try {
    content = readFileSync(gitignorePath, "utf-8");
  } catch {
    return;
  }
  for (const entry of expectedEntries) {
    if (!content.includes(entry)) {
      findings.push({
        category: "gitignore_missing_entry",
        severity: "medium",
        file: ".gitignore",
        line: 0,
        message: `.gitignore is missing entry: ${entry}`,
        fix: `Add '${entry}' to .gitignore`,
      });
    }
  }
}
