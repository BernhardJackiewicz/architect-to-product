import { z } from "zod";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import { generateRunId } from "../utils/log-sanitizer.js";
import type {
  WhiteboxFinding,
  WhiteboxAuditResult,
  WhiteboxCategory,
  WhiteboxEnforcementType,
  SASTFinding,
  FindingSeverity,
  Slice,
} from "../state/types.js";

export const runWhiteboxAuditSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  mode: z.enum(["incremental", "full"]).describe("incremental = only specified files, full = all candidates"),
  files: z.array(z.string()).optional().describe("Files to check (for incremental mode)"),
});

export type RunWhiteboxAuditInput = z.infer<typeof runWhiteboxAuditSchema>;

/** Central blocking logic — exported for reuse in StateManager and tests */
export function isBlockingWhiteboxFinding(finding: WhiteboxFinding): boolean {
  if (!finding.confirmed_exploitable) return false;
  const blockingCategories: WhiteboxCategory[] = [
    "AuthAuthz", "Secrets", "TenantIsolation", "DeploymentArtifactSafety",
  ];
  return blockingCategories.includes(finding.category) || finding.enforcement_type === "prompt-only";
}

export function handleRunWhiteboxAudit(input: RunWhiteboxAuditInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const whiteboxStart = Date.now();
  const state = sm.read();
  try { requirePhase(state.phase, ["security"], "a2p_run_whitebox_audit"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  // Collect candidates: open SAST findings + critical/high audit findings
  const sastCandidates = state.slices
    .flatMap((s) => s.sastFindings)
    .filter((f) => f.status === "open");

  const auditCandidates = state.auditResults
    .flatMap((a) => a.findings)
    .filter((f) => f.severity === "critical" || f.severity === "high");

  // Build unique file→findings map
  type Candidate = { file: string; title: string; severity: FindingSeverity; source: "sast" | "audit" };
  const candidates: Candidate[] = [];

  for (const f of sastCandidates) {
    candidates.push({ file: f.file, title: f.title, severity: f.severity, source: "sast" });
  }
  for (const f of auditCandidates) {
    if (f.file && f.file !== "project" && f.file !== "state") {
      candidates.push({ file: f.file, title: f.message, severity: f.severity, source: "audit" });
    }
  }

  // Incremental: filter to specified files
  const filtered = input.mode === "incremental" && input.files
    ? candidates.filter((c) => input.files!.some((f) => c.file.includes(f)))
    : candidates;

  // Deduplicate by file+title
  const seen = new Set<string>();
  const unique = filtered.filter((c) => {
    const key = `${c.file}:${c.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Warn if no candidates — differentiate why
  if (unique.length === 0) {
    if (!state.lastFullSastAt) {
      const hasSastEvidence = state.slices.some(s => s.sastRanAt);
      return JSON.stringify({
        warning: hasSastEvidence
          ? "No full SAST scan has been run. Slice-level SAST found no open findings. Run a2p_run_sast mode=full for comprehensive whitebox analysis."
          : "No SAST scans found. Run a2p_run_sast mode=full first for meaningful whitebox analysis.",
        reason: hasSastEvidence ? "no_full_sast" : "no_sast_at_all",
        candidatesEvaluated: 0,
      });
    }
    // Full SAST ran but found nothing — legitimate clean result, continue normally
  }

  // Evaluate each candidate
  const findings: WhiteboxFinding[] = [];
  let findingIdx = 0;

  for (const candidate of unique) {
    findingIdx++;
    const id = `WB-${String(findingIdx).padStart(3, "0")}`;

    const guards = checkFileForGuards(candidate.file, input.projectPath);
    const reachability = hasReachabilityEvidence(candidate.file, state.slices, input.projectPath);
    const mutation = hasMutationPatterns(candidate.file, input.projectPath);
    const category = classifyToCategory(candidate);

    const boundaryBypassed = !guards.hasAuthGuard && !guards.hasValidation && !guards.hasSanitization;
    const enforcementType = determineEnforcementType(guards);

    const confirmed = reachability.reachable && mutation.hasMutation && boundaryBypassed;
    const evidenceType = reachability.reachable ? "code_verified" as const : "speculative" as const;

    const finding: WhiteboxFinding = {
      id,
      category,
      severity: candidate.severity,
      confirmed_exploitable: confirmed,
      evidence_type: evidenceType,
      enforcement_type: enforcementType,
      runtime_path_reachable: reachability.reachable,
      state_change_provable: mutation.hasMutation,
      boundary_actually_bypassed: boundaryBypassed,
      root_cause: candidate.title,
      affected_files: [candidate.file],
      minimal_fix: generateMinimalFix(category, guards),
      required_regression_tests: [`Test ${category} guard for ${candidate.file}`],
      blocking: false, // set below
    };
    finding.blocking = isBlockingWhiteboxFinding(finding);
    findings.push(finding);
  }

  const summary = {
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    low: findings.filter((f) => f.severity === "low").length,
  };

  const existingCount = state.whiteboxResults.length;
  const resultId = `WBA-${String(existingCount + 1).padStart(3, "0")}`;

  const result: WhiteboxAuditResult = {
    id: resultId,
    mode: input.mode,
    timestamp: new Date().toISOString(),
    candidates_evaluated: unique.length,
    findings,
    summary,
    blocking_count: findings.filter((f) => f.blocking).length,
  };

  sm.addWhiteboxResult(result);

  const durationMs = Date.now() - whiteboxStart;
  sm.log(
    result.blocking_count > 0 ? "error" : findings.length > 0 ? "warn" : "info",
    "whitebox_audit",
    `[${input.mode}] ${resultId}: ${findings.length} findings (blocking: ${result.blocking_count})`,
    {
      status: result.blocking_count > 0 ? "failure" : findings.length > 0 ? "warning" : "success",
      durationMs,
      runId: generateRunId(),
      metadata: { findingCount: findings.length, toolName: "whitebox", candidatesEvaluated: unique.length, blockingCount: result.blocking_count },
    },
  );

  return JSON.stringify({
    success: true,
    whiteboxId: resultId,
    mode: input.mode,
    candidatesEvaluated: unique.length,
    findings: findings.slice(0, 20),
    totalFindings: findings.length,
    bySeverity: summary,
    blockingCount: result.blocking_count,
    hint: result.blocking_count > 0
      ? `${result.blocking_count} BLOCKING finding(s) detected. These must be fixed before deployment.`
      : findings.length > 0
        ? "No blocking findings. Review non-blocking findings as appropriate."
        : "No exploitable findings detected. Code paths appear guarded.",
  });
}

// --- Helpers ---

interface GuardResult {
  hasAuthGuard: boolean;
  hasValidation: boolean;
  hasSanitization: boolean;
  guardLocation: "server" | "client" | "none";
}

export function checkFileForGuards(filePath: string, projectPath: string): GuardResult {
  const content = readFileSafe(filePath, projectPath);
  if (!content) return { hasAuthGuard: false, hasValidation: false, hasSanitization: false, guardLocation: "none" };

  const authPatterns = [
    /auth(?:enticate|orize|Guard|Middleware|check)/i,
    /requireAuth/i,
    /isAuthenticated/i,
    /session\.user/i,
    /jwt\.verify/i,
    /passport\./i,
  ];

  const validationPatterns = [
    /\.parse\(/,
    /\.safeParse\(/,
    /validate\(/i,
    /sanitize\(/i,
    /escape\(/i,
    /parameterized/i,
    /prepared\s*statement/i,
    /z\.(?:string|number|object|array)\(/,
  ];

  const sanitizationPatterns = [
    /DOMPurify/i,
    /escapeHtml/i,
    /htmlEncode/i,
    /encodeURIComponent/,
    /xss/i,
  ];

  const hasAuth = authPatterns.some((p) => p.test(content));
  const hasValidation = validationPatterns.some((p) => p.test(content));
  const hasSanitization = sanitizationPatterns.some((p) => p.test(content));

  // Determine guard location
  const serverPatterns = [/middleware/i, /app\.(use|get|post|put|delete)\(/, /router\./i, /server\./i];
  const isServer = serverPatterns.some((p) => p.test(content));

  return {
    hasAuthGuard: hasAuth,
    hasValidation,
    hasSanitization,
    guardLocation: (hasAuth || hasValidation || hasSanitization)
      ? (isServer ? "server" : "client")
      : "none",
  };
}

interface ReachabilityResult {
  reachable: boolean;
  evidence: string;
}

export function hasReachabilityEvidence(
  file: string,
  slices: Slice[],
  projectPath: string,
): ReachabilityResult {
  // Check 1: File must be in an active slice
  const inSlice = slices.some((s) => s.files.some((f) => f.includes(file) || file.includes(f)));
  if (!inSlice) {
    return { reachable: false, evidence: "not_in_slice" };
  }

  // Check 2: File has entry point evidence
  const content = readFileSafe(file, projectPath);
  if (!content) return { reachable: false, evidence: "file_not_readable" };

  const entryPointPatterns = [
    /export\s+(default\s+)?(function|class|const)/,  // export
    /app\.(use|get|post|put|delete|patch)\(/,          // route handler
    /router\.(use|get|post|put|delete|patch)\(/,       // router handler
    /server\.tool\(/,                                   // MCP tool handler
    /addEventListener\(/,                               // event listener
    /on\w+\s*[:=]\s*(?:async\s+)?(?:function|\()/,     // event handler
    /module\.exports/,                                  // CJS export
    /handler\s*[:=]/i,                                  // handler assignment
  ];

  for (const pattern of entryPointPatterns) {
    if (pattern.test(content)) {
      return { reachable: true, evidence: "entry_point" };
    }
  }

  // Check 3: File is imported/referenced by other slice files
  const importPattern = new RegExp(file.replace(/\.[^.]+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  for (const slice of slices) {
    for (const sliceFile of slice.files) {
      if (sliceFile === file) continue;
      const sliceContent = readFileSafe(sliceFile, projectPath);
      if (sliceContent && importPattern.test(sliceContent)) {
        return { reachable: true, evidence: "imported" };
      }
    }
  }

  return { reachable: false, evidence: "no_entry_point_or_import" };
}

interface MutationResult {
  hasMutation: boolean;
  categories: string[];
}

export function hasMutationPatterns(file: string, projectPath: string): MutationResult {
  const content = readFileSafe(file, projectPath);
  if (!content) return { hasMutation: false, categories: [] };

  const patterns: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /\.(save|create|update|delete|insert|remove|destroy)\(/i, category: "write_path" },
    { pattern: /writeFile|appendFile|createWriteStream/i, category: "write_path" },
    { pattern: /state\.\w+\s*=/, category: "status_mutation" },
    { pattern: /setState|dispatch|commit|\.set\(/i, category: "status_mutation" },
    { pattern: /res\.(send|json|write|end)\(/i, category: "artifact_emission" },
    { pattern: /process\.env/i, category: "secret_exposure" },
    { pattern: /exec\(|execSync\(|spawn\(/i, category: "write_path" },
  ];

  const categories: string[] = [];
  for (const { pattern, category } of patterns) {
    if (pattern.test(content)) {
      categories.push(category);
    }
  }

  return { hasMutation: categories.length > 0, categories };
}

function classifyToCategory(candidate: { title: string; source: string }): WhiteboxCategory {
  const title = candidate.title.toLowerCase();

  if (title.includes("auth") || title.includes("session") || title.includes("permission")) return "AuthAuthz";
  if (title.includes("secret") || title.includes("password") || title.includes("api_key") || title.includes("token")) return "Secrets";
  if (title.includes("tenant") || title.includes("isolation") || title.includes("multi-tenant")) return "TenantIsolation";
  if (title.includes("sql") || title.includes("injection") || title.includes("xss") || title.includes("input")) return "InputOutputSafety";
  if (title.includes("exec") || title.includes("command") || title.includes("file") || title.includes("path")) return "FilesystemProcessCmd";
  if (title.includes("deploy") || title.includes("artifact") || title.includes("docker")) return "DeploymentArtifactSafety";
  if (title.includes("state") || title.includes("recovery") || title.includes("backup")) return "StateRecoverySafety";
  if (title.includes("gate") || title.includes("workflow") || title.includes("transition")) return "WorkflowGateEnforcement";

  return "InputOutputSafety";
}

function determineEnforcementType(guards: GuardResult): WhiteboxEnforcementType {
  if (guards.guardLocation === "none") return "prompt-only";
  if (guards.guardLocation === "server") return "code";
  if (guards.guardLocation === "client") return "mixed";
  return "prompt-only";
}

function generateMinimalFix(category: WhiteboxCategory, guards: GuardResult): string {
  if (!guards.hasAuthGuard && (category === "AuthAuthz" || category === "TenantIsolation")) {
    return "Add server-side auth middleware before this handler";
  }
  if (!guards.hasValidation) {
    return "Add input validation (e.g., Zod schema) before processing";
  }
  if (!guards.hasSanitization && category === "InputOutputSafety") {
    return "Add output sanitization before rendering user data";
  }
  return "Add appropriate server-side guard for this code path";
}

function readFileSafe(filePath: string, projectPath: string): string | null {
  try {
    // Try as relative path first
    const fullPath = filePath.startsWith("/") ? filePath : join(projectPath, filePath);
    return readFileSync(fullPath, "utf-8");
  } catch {
    return null;
  }
}
