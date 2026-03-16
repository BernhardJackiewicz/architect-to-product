import { z } from "zod";
import { readFileSync, readdirSync, lstatSync } from "node:fs";
import { join, extname } from "node:path";
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
    // Check for stale full SAST
    if (state.lastFullSastAt && state.lastSecurityRelevantChangeAt &&
        state.lastFullSastAt < state.lastSecurityRelevantChangeAt) {
      return JSON.stringify({
        warning: "Full SAST scan is stale — code changed after scan. Re-run a2p_run_sast mode=full.",
        reason: "stale_full_sast",
        candidatesEvaluated: 0,
      });
    }
    // Full SAST ran but found nothing — run independent security probes
    const probeFindings = runIndependentProbes(state.slices, input.projectPath);
    for (const pf of probeFindings) {
      unique.push(pf);
    }
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
      ? `${result.blocking_count} BLOCKING finding(s) detected. These must be fixed before deployment. Then proceed to Phase 1b: adversarial security review (MANDATORY — always required).`
      : findings.length > 0
        ? "No blocking findings. Review non-blocking findings as appropriate. Then proceed to Phase 1b: adversarial security review (MANDATORY — always required)."
        : "No exploitable findings from deterministic probes. Proceed to Phase 1b: adversarial security review (MANDATORY — always required).",
    adversarialReviewRequired: true,
    adversarialReviewInstructions: "Phase 1b is MANDATORY regardless of probe results. Read security-relevant source files, think like an attacker, identify business logic flaws / auth bypasses / race conditions / privilege escalation / chained vulnerabilities. Record each finding via a2p_record_finding with tool='adversarial-review'.",
  });
}

// --- Independent Security Probes ---

type Candidate = { file: string; title: string; severity: FindingSeverity; source: "sast" | "audit" | "probe" };

interface ProbePattern {
  pattern: RegExp;
  title: string;
  severity: FindingSeverity;
  /** Only apply to files matching this glob-like test (optional) */
  fileFilter?: (filePath: string) => boolean;
}

const PROBE_PATTERNS: ProbePattern[] = [
  // Hardcoded secrets
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["'][^"']{1,30}["']/i,
    title: "Hardcoded password in source code",
    severity: "high",
  },
  {
    pattern: /(?:api[_-]?key|secret[_-]?key|auth[_-]?secret|token)\s*[:=]\s*["'][^"']+["']/i,
    title: "Hardcoded API key or secret",
    severity: "critical",
  },
  // Seed credentials without production guard
  {
    pattern: /(?:seed|default|initial).*(?:password|credential|user)/i,
    title: "Seed/default credentials without production guard",
    severity: "high",
    fileFilter: (f) => /seed|migration|init|setup/i.test(f),
  },
  // Missing auth on route handlers
  {
    pattern: /(?:app|router)\.\s*(?:get|post|put|patch|delete)\s*\(/,
    title: "API route handler potentially missing auth middleware",
    severity: "medium",
  },
  // Request body without validation
  {
    pattern: /(?:req|request)\.(?:body|json\(\))/,
    title: "Request body consumed without input validation",
    severity: "medium",
  },
  // Missing rate limiting on auth endpoints
  {
    pattern: /(?:login|signin|sign-in|credentials|authenticate)\s*(?:[:=]|function|\()/i,
    title: "Auth endpoint without rate limiting",
    severity: "high",
    fileFilter: (f) => /auth|login|credential|session/i.test(f),
  },
  // SQL Injection: query/execute/raw with template literal or concatenation
  {
    pattern: /(?:query|execute|raw)\s*\(\s*(?:`[^`]*\$\{|[^)]*\+\s*(?:req\.|input|params|user))/i,
    title: "SQL injection via string interpolation/concatenation",
    severity: "critical",
  },
  // Command Injection: exec/spawn with user input
  {
    pattern: /(?:exec|spawn|execSync|spawnSync)\s*\([^)]*(?:req\.|input|params|user)/i,
    title: "Command injection via user-controlled input",
    severity: "critical",
  },
  // Path Traversal: readFile/writeFile with user input
  {
    pattern: /(?:readFile|writeFile|readFileSync|writeFileSync|createReadStream)\s*\([^)]*(?:req\.|params\.|query\.)/i,
    title: "Path traversal via user-controlled file path",
    severity: "high",
  },
  // SSRF: fetch/axios/got with user-controlled URL
  {
    pattern: /(?:fetch|axios|got|request)\s*\(\s*(?:req\.body|req\.query|params\.|input)/i,
    title: "SSRF via user-controlled URL",
    severity: "high",
  },
  // Insecure Crypto: MD5/SHA1 or Math.random for tokens
  {
    pattern: /(?:createHash\s*\(\s*['"](?:md5|sha1)['"]|Math\.random\s*\(\s*\).*(?:token|secret|key|session|nonce))/i,
    title: "Insecure cryptographic function for security-sensitive operation",
    severity: "high",
  },
  // Mass Assignment: .create(req.body) without validation
  {
    pattern: /\.create\s*\(\s*(?:req\.body|request\.body)/i,
    title: "Mass assignment via unvalidated request body",
    severity: "high",
  },
  // Open Redirect: res.redirect with user input
  {
    pattern: /res\.redirect\s*\(\s*(?:req\.|query\.|params\.)/i,
    title: "Open redirect via user-controlled URL",
    severity: "medium",
  },
  // Info Disclosure: error/stack in response
  {
    pattern: /res\.(?:json|send)\s*\(\s*(?:err|error|.*\.stack)/i,
    title: "Information disclosure via error details in response",
    severity: "medium",
  },
  // XSS: innerHTML/dangerouslySetInnerHTML/.html() with user input
  {
    pattern: /innerHTML\s*=|dangerouslySetInnerHTML|\.html\(\s*(?:req\.|user\.|input)/i,
    title: "XSS via unsafe DOM manipulation",
    severity: "high",
  },
  // Insecure Deserialization: pickle.loads, yaml.load without SafeLoader
  {
    pattern: /pickle\.loads?\(|yaml\.load\(\s*[^,)]*(?!Loader)|yaml\.unsafe_load/i,
    title: "Insecure deserialization of untrusted data",
    severity: "critical",
  },
  // Code execution via eval/Function with user input
  {
    pattern: /eval\s*\(\s*(?:req\.|input\.|params\.|user)|new\s+Function\s*\([^)]*(?:req\.|input)/i,
    title: "Code execution via eval/Function with user input",
    severity: "critical",
  },
  // NoSQL injection via unvalidated query operators
  {
    pattern: /\.(?:find|findOne|aggregate)\s*\(\s*(?:req\.body|req\.query|\{[^}]*\$(?:where|regex|gt|lt|ne))/i,
    title: "NoSQL injection via unvalidated query operators",
    severity: "high",
  },
  // Cookie set without security flags
  {
    pattern: /(?:res\.cookie|setCookie|set-cookie)\s*\(/i,
    title: "Cookie set without security flags",
    severity: "medium",
  },
];

/** Auth patterns that indicate a file has auth guards */
const AUTH_EVIDENCE_PATTERNS = [
  /auth\s*\(/i, /getServerSession/i, /requireAuth/i, /session\b/i,
  /jwt\.verify/i, /middleware/i, /isAuthenticated/i,
];

/** Rate limit patterns */
const RATE_LIMIT_PATTERNS = [
  /rateLimit/i, /rate[_-]?limit/i, /throttle/i, /limiter/i,
];

/** Input validation patterns */
const VALIDATION_PATTERNS = [
  /\.parse\(/, /\.safeParse\(/, /validate\(/i, /z\.\w+\(/, /joi\./i,
  /Number\.isFinite/, /Number\.isInteger/, /typeof\s+\w+\s*[!=]==?\s*["']/,
];

/** Suppression patterns for new probes */
const SQL_SAFE_PATTERNS = [/\$\d+/, /\?\s*,/, /\.prepare\(/i, /parameterized/i];
const COMMAND_SAFE_PATTERNS = [/shell\s*:\s*false/i, /execFile/i];
const PATH_SAFE_PATTERNS = [/path\.resolve/i, /path\.join.*__dirname/i, /allowlist/i];
const SSRF_SAFE_PATTERNS = [/allowlist/i, /whitelist/i, /new URL\(/];
const CRYPTO_SAFE_PATTERNS = [/bcrypt/i, /argon2/i, /randomBytes/i, /scrypt/i];
const MASS_ASSIGN_SAFE_PATTERNS = [/z\.\w+\(/, /\.parse\(/, /\.safeParse\(/, /joi\./i, /validate\(/i];
const REDIRECT_SAFE_PATTERNS = [/allowlist/i, /whitelist/i, /safePaths/i, /allowedUrls/i];
const ERROR_SAFE_PATTERNS = [/NODE_ENV.*production/i, /process\.env\.NODE_ENV/i];
const XSS_SAFE_PATTERNS = [/DOMPurify/i, /sanitize/i, /escapeHtml/i, /xss/i, /textContent\s*=/];
const DESERIAL_SAFE_PATTERNS = [/SafeLoader/i, /safe_load/i, /yaml\.safe/i];
const NOSQL_SAFE_PATTERNS = [/mongo-sanitize/i, /sanitize/i, /express-mongo-sanitize/i];
const COOKIE_SAFE_PATTERNS = [/httpOnly/i, /secure\s*:/i, /sameSite/i];

// --- Auto-Discovery Fallback ---

const DISCOVERY_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
  ".vue", ".svelte", ".mjs", ".cjs",
]);
const DISCOVERY_EXCLUDED = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage",
  ".a2p", ".venv", "venv", "__pycache__", ".turbo", ".cache",
]);
const MAX_DISCOVERED_FILES = 500;

function discoverSourceFiles(projectPath: string, relativePath = ""): string[] {
  const results: string[] = [];
  const fullDir = relativePath ? join(projectPath, relativePath) : projectPath;

  let entries: string[];
  try {
    entries = readdirSync(fullDir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (results.length >= MAX_DISCOVERED_FILES) break;

    if (DISCOVERY_EXCLUDED.has(entry)) continue;

    const relPath = relativePath ? `${relativePath}/${entry}` : entry;
    const fullPath = join(projectPath, relPath);

    try {
      const stat = lstatSync(fullPath);
      if (stat.isDirectory()) {
        const sub = discoverSourceFiles(projectPath, relPath);
        for (const s of sub) {
          if (results.length >= MAX_DISCOVERED_FILES) break;
          results.push(s);
        }
      } else if (stat.isFile() && DISCOVERY_EXTENSIONS.has(extname(entry))) {
        results.push(relPath);
      }
    } catch {
      // skip unreadable entries
    }
  }

  return results;
}

export function runIndependentProbes(slices: Slice[], projectPath: string): Candidate[] {
  // Collect all unique files from slices
  const allFiles = new Set<string>();
  for (const slice of slices) {
    for (const f of slice.files) {
      allFiles.add(f);
    }
  }

  // Auto-discovery fallback: if no slice files, discover source files
  if (allFiles.size === 0) {
    const discovered = discoverSourceFiles(projectPath);
    for (const f of discovered) allFiles.add(f);
  }

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const filePath of allFiles) {
    const content = readFileSafe(filePath, projectPath);
    if (!content) continue;

    for (const probe of PROBE_PATTERNS) {
      if (probe.fileFilter && !probe.fileFilter(filePath)) continue;
      if (!probe.pattern.test(content)) continue;

      // Apply context-aware filtering to reduce false positives
      if (shouldSuppressProbe(probe, content, filePath)) continue;

      const key = `${filePath}:${probe.title}`;
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        file: filePath,
        title: probe.title,
        severity: probe.severity,
        source: "probe",
      });
    }
  }

  return candidates;
}

/** Context-aware suppression to reduce false positives */
function shouldSuppressProbe(probe: ProbePattern, content: string, _filePath: string): boolean {
  const title = probe.title.toLowerCase();

  // Suppress "missing auth" if file has auth evidence
  if (title.includes("missing auth")) {
    if (AUTH_EVIDENCE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress "without rate limiting" if rate limit patterns found
  if (title.includes("rate limiting")) {
    if (RATE_LIMIT_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress "without input validation" if validation patterns found
  if (title.includes("input validation")) {
    if (VALIDATION_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress "seed credentials" if production guard exists
  if (title.includes("seed") || title.includes("default credentials")) {
    if (/NODE_ENV.*production|process\.env\.NODE_ENV/i.test(content)) return true;
  }

  // Suppress SQL injection if parameterized queries are used
  if (title.includes("sql injection")) {
    if (SQL_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress command injection if safe exec patterns are used
  if (title.includes("command injection")) {
    if (COMMAND_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress path traversal if safe path patterns are used
  if (title.includes("path traversal")) {
    if (PATH_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress SSRF if URL allowlisting or parsing is present
  if (title.includes("ssrf")) {
    if (SSRF_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress insecure crypto if secure alternatives are present
  if (title.includes("insecure crypto") || title.includes("cryptographic")) {
    if (CRYPTO_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress mass assignment if validation is present
  if (title.includes("mass assignment")) {
    if (MASS_ASSIGN_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress open redirect if allowlisting is present
  if (title.includes("open redirect")) {
    if (REDIRECT_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress info disclosure if production guard exists
  if (title.includes("information disclosure")) {
    if (ERROR_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress XSS if sanitization is present
  if (title.includes("xss")) {
    if (XSS_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress insecure deserialization if safe loader is used
  if (title.includes("deserialization")) {
    if (DESERIAL_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress NoSQL injection if sanitization is present
  if (title.includes("nosql")) {
    if (NOSQL_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  // Suppress cookie warning if security flags are present
  if (title.includes("cookie")) {
    if (COOKIE_SAFE_PATTERNS.some(p => p.test(content))) return true;
  }

  return false;
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
  if (title.includes("crypto") || title.includes("hash") || title.includes("md5")) return "Secrets";
  if (title.includes("tenant") || title.includes("isolation") || title.includes("multi-tenant")) return "TenantIsolation";
  if (title.includes("sql") || title.includes("injection") || title.includes("xss") || title.includes("input") || title.includes("deserialization")) return "InputOutputSafety";
  if (title.includes("ssrf") || title.includes("redirect") || title.includes("mass assignment") || title.includes("cookie")) return "InputOutputSafety";
  if (title.includes("exec") || title.includes("command") || title.includes("file") || title.includes("path")) return "FilesystemProcessCmd";
  if (title.includes("deploy") || title.includes("artifact") || title.includes("docker")) return "DeploymentArtifactSafety";
  if (title.includes("stack") || title.includes("information disclosure")) return "DeploymentArtifactSafety";
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
