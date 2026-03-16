import { z } from "zod";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import type { ShakeBreakSession, ShakeBreakCategory } from "../state/types.js";

export const shakeBreakSetupSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  categories: z.array(z.enum([
    "auth_idor", "race_conditions", "state_manipulation",
    "business_logic", "injection_runtime", "token_session",
    "file_upload", "webhook_callback",
  ])).min(1).describe("Test categories to run"),
  timeoutMinutes: z.number().int().min(5).max(30).optional().default(15)
    .describe("Session timeout in minutes"),
  force: z.boolean().optional().default(false)
    .describe("Force cleanup of stale session before creating new one"),
});

export type ShakeBreakSetupInput = z.infer<typeof shakeBreakSetupSchema>;

const TERMINAL_WARNING = `STOP.
DAS IST EIN AKTIVER SHAKE-AND-BREAK-SICHERHEITSTEST.
DAS KANN FEHLER, DATENVERLUST ODER UNBEABSICHTIGTE NEBENEFFEKTE VERURSACHEN,
WENN DU NICHT IN EINER SAUBER ISOLIERTEN TESTUMGEBUNG BIST.

LEGE JETZT EINE SICHERHEITSKOPIE AN:
- GIT COMMIT ODER STASH
- BACKUP / SNAPSHOT
- GGF. DB-DUMP

NUTZE KEINE PRODUKTIONS-SECRETS.
NUTZE KEINE PRODUKTIONS-DATEN.
NUTZE KEINE PRODUKTIONS-ENDPUNKTE.`;

const TERMINAL_WARNING_ANSI = `\x1b[31;1m\n${TERMINAL_WARNING}\n\x1b[0m`;

/** Pattern to detect secret-like env vars */
const SECRET_PATTERNS = /(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIAL)$/i;

/** Neutralize external service env vars */
function generateSafeEnv(projectPath: string, port: number, dbUrl: string): { content: string; neutralized: string[] } {
  const neutralized: string[] = [];
  const envVars: Record<string, string> = {
    NODE_ENV: "test",
    FLASK_ENV: "testing",
    PORT: String(port),
    DATABASE_URL: dbUrl,
    JWT_SECRET: `shake-break-test-${randomBytes(16).toString("hex")}`,
    SESSION_SECRET: `shake-break-session-${randomBytes(16).toString("hex")}`,
    SMTP_HOST: "localhost",
    MAIL_HOST: "localhost",
    WEBHOOK_URL: `http://localhost:${port}/dev/null`,
    S3_ENDPOINT: "http://localhost:9999",
    STORAGE_URL: "http://localhost:9999",
    STRIPE_SECRET_KEY: "sk_test_shake_break_dummy",
    SENDGRID_API_KEY: "SG.shake-break-dummy",
  };

  neutralized.push("SMTP/MAIL", "WEBHOOK", "S3/STORAGE", "STRIPE", "SENDGRID");

  // Scan existing .env for additional secret vars
  const envPath = join(projectPath, ".env");
  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=/);
      if (match) {
        const key = match[1];
        if (SECRET_PATTERNS.test(key) && !envVars[key]) {
          envVars[key] = `shake-break-dummy-${key.toLowerCase()}`;
          neutralized.push(key);
        }
      }
    }
  }

  const content = Object.entries(envVars)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

  return { content, neutralized };
}

/** Find a free ephemeral port */
function findFreePort(): number {
  // Pick a random port in 49152-65535 and check availability
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    try {
      execSync(`lsof -ti:${port}`, { stdio: "pipe" });
      // Port is in use, try another
    } catch {
      // lsof exits non-zero = port is free
      return port;
    }
  }
  // Fallback
  return 49152 + Math.floor(Math.random() * 1000);
}

/** Determine DB setup */
function setupDatabase(
  projectPath: string,
  dbType: string | null,
): { dbUrl: string; dbType: "sqlite" | "postgres" | "mysql" | "none"; dbFallback: boolean; dockerContainerId: string | null; dbFallbackWarning?: string } {
  const tmpBase = `/tmp/a2p-sb-${randomBytes(8).toString("hex")}`;

  if (!dbType || dbType === "none") {
    return { dbUrl: "", dbType: "none", dbFallback: false, dockerContainerId: null };
  }

  const normalizedDb = dbType.toLowerCase();

  // Check for Docker for PostgreSQL/MySQL
  if (normalizedDb.includes("postgres") || normalizedDb.includes("mysql")) {
    let dockerAvailable = false;
    try {
      execSync("docker info", { stdio: "pipe", timeout: 5000 });
      dockerAvailable = true;
    } catch {
      // Docker not available
    }

    if (dockerAvailable) {
      const dbPort = findFreePort();
      const containerName = `a2p-sb-${randomBytes(4).toString("hex")}`;

      if (normalizedDb.includes("postgres")) {
        try {
          const containerId = execSync(
            `docker run -d --name ${containerName} -e POSTGRES_PASSWORD=test -e POSTGRES_DB=shakebreak -p ${dbPort}:5432 postgres:alpine`,
            { stdio: "pipe", timeout: 30000 }
          ).toString().trim();
          return {
            dbUrl: `postgresql://postgres:test@localhost:${dbPort}/shakebreak`,
            dbType: "postgres",
            dbFallback: false,
            dockerContainerId: containerId,
          };
        } catch {
          // Fall through to SQLite
        }
      } else {
        try {
          const containerId = execSync(
            `docker run -d --name ${containerName} -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=shakebreak -p ${dbPort}:3306 mysql:8`,
            { stdio: "pipe", timeout: 30000 }
          ).toString().trim();
          return {
            dbUrl: `mysql://root:test@localhost:${dbPort}/shakebreak`,
            dbType: "mysql",
            dbFallback: false,
            dockerContainerId: containerId,
          };
        } catch {
          // Fall through to SQLite
        }
      }
    }

    // SQLite fallback
    mkdirSync(tmpBase, { recursive: true });
    const limitedCategories = ["race_conditions", "injection_runtime"];
    return {
      dbUrl: `sqlite://${tmpBase}/test.db`,
      dbType: "sqlite",
      dbFallback: true,
      dockerContainerId: null,
      dbFallbackWarning: `Project uses ${dbType} but Docker is not available. Using SQLite fallback. ` +
        `Categories with limited accuracy: ${limitedCategories.join(", ")}. ` +
        `race_conditions: SQLite has different locking semantics. ` +
        `injection_runtime: SQLite has different SQL dialect. ` +
        `Findings in these categories should use confidence="hard-to-verify".`,
    };
  }

  // SQLite or unknown — use SQLite directly
  mkdirSync(tmpBase, { recursive: true });
  return {
    dbUrl: `sqlite://${tmpBase}/test.db`,
    dbType: "sqlite",
    dbFallback: false,
    dockerContainerId: null,
  };
}

/** Cleanup a stale session (best-effort) */
function cleanupSession(session: ShakeBreakSession): void {
  // Remove worktree
  try {
    if (existsSync(session.sandboxPath)) {
      execSync(`git worktree remove --force "${session.sandboxPath}"`, { stdio: "pipe", timeout: 10000 });
    }
  } catch { /* best-effort */ }

  // Kill port process
  try {
    execSync(`lsof -ti:${session.port} | xargs kill 2>/dev/null`, { stdio: "pipe", timeout: 5000 });
  } catch { /* best-effort */ }

  // Remove Docker container
  if (session.dockerContainerId) {
    try {
      execSync(`docker rm -f ${session.dockerContainerId}`, { stdio: "pipe", timeout: 10000 });
    } catch { /* best-effort */ }
  }

  // Remove temp DB directory
  if (session.dbUrl.startsWith("sqlite://")) {
    const dbPath = session.dbUrl.replace("sqlite://", "");
    const dbDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
    try {
      execSync(`rm -rf "${dbDir}"`, { stdio: "pipe", timeout: 5000 });
    } catch { /* best-effort */ }
  }
}

/** Collect all shake-break finding IDs from current state */
function collectShakeBreakFindingIds(state: { slices: Array<{ sastFindings: Array<{ id: string; tool: string }> }>; projectFindings: Array<{ id: string; tool: string }> }): string[] {
  const ids: string[] = [];
  for (const slice of state.slices) {
    for (const f of slice.sastFindings) {
      if (f.tool === "shake-break") ids.push(f.id);
    }
  }
  for (const f of state.projectFindings) {
    if (f.tool === "shake-break") ids.push(f.id);
  }
  return ids;
}

export function handleShakeBreakSetup(input: ShakeBreakSetupInput): string {
  // Apply defaults that Zod would apply at MCP layer but not in direct calls
  const timeoutMinutes = input.timeoutMinutes ?? 15;
  const forceCleanup = input.force ?? false;

  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();

  // Phase gate
  try { requirePhase(state.phase, ["security"], "a2p_shake_break_setup"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  // Adversarial review prerequisite
  if (!state.adversarialReviewState) {
    return JSON.stringify({
      error: "Shake & Break requires completed adversarial review. Run adversarial security review (Phase 1b) and confirm with a2p_complete_adversarial_review first.",
    });
  }

  // Active session check
  if (state.shakeBreakSession) {
    const sessionAge = (Date.now() - new Date(state.shakeBreakSession.startedAt).getTime()) / 60000;
    const isStale = sessionAge > state.shakeBreakSession.timeoutMinutes;

    if (!forceCleanup) {
      if (isStale) {
        return JSON.stringify({
          error: `Stale Shake & Break session detected (started ${Math.round(sessionAge)}min ago, timeout was ${state.shakeBreakSession.timeoutMinutes}min). Call with force: true to clean up and start fresh.`,
        });
      }
      return JSON.stringify({
        error: "Active Shake & Break session exists. Call a2p_shake_break_teardown first, or use force: true to clean up and restart.",
      });
    }

    // Force cleanup
    cleanupSession(state.shakeBreakSession);
    sm.clearShakeBreakSession();
  }

  // Setup sandbox
  const port = findFreePort();
  const dbConfig = setupDatabase(input.projectPath, state.architecture?.techStack.database ?? null);
  const envResult = generateSafeEnv(input.projectPath, port, dbConfig.dbUrl);

  // Create worktree
  const worktreePath = `/tmp/a2p-shake-break-${randomBytes(8).toString("hex")}`;
  try {
    execSync(`git -C "${input.projectPath}" worktree add "${worktreePath}" HEAD --detach`, {
      stdio: "pipe",
      timeout: 30000,
    });
  } catch (err) {
    // Cleanup DB if worktree failed
    if (dbConfig.dockerContainerId) {
      try { execSync(`docker rm -f ${dbConfig.dockerContainerId}`, { stdio: "pipe" }); } catch { /* */ }
    }
    return JSON.stringify({
      error: `Failed to create git worktree: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  // Write .env.shake-break in sandbox
  writeFileSync(join(worktreePath, ".env.shake-break"), envResult.content, "utf-8");

  // Determine start hint
  const lang = state.architecture?.techStack.language?.toLowerCase() ?? "";
  const framework = state.architecture?.techStack.framework?.toLowerCase() ?? "";
  let startHint = "Start the app in the sandbox directory using the generated .env.shake-break";
  if (lang.includes("typescript") || lang.includes("javascript") || framework.includes("express") || framework.includes("next") || framework.includes("fastify")) {
    startHint = `cd "${worktreePath}" && cp .env.shake-break .env && npm install && npm run dev`;
  } else if (lang.includes("python") || framework.includes("django") || framework.includes("flask") || framework.includes("fastapi")) {
    startHint = `cd "${worktreePath}" && cp .env.shake-break .env && pip install -r requirements.txt && python manage.py runserver 0.0.0.0:${port}`;
  }

  // Collect starting finding IDs
  const startingFindingIds = collectShakeBreakFindingIds(state);

  // Save session
  const session: ShakeBreakSession = {
    sandboxPath: worktreePath,
    port,
    dbUrl: dbConfig.dbUrl,
    dbType: dbConfig.dbType,
    dbFallback: dbConfig.dbFallback,
    dockerContainerId: dbConfig.dockerContainerId,
    categories: input.categories as ShakeBreakCategory[],
    startedAt: new Date().toISOString(),
    timeoutMinutes: timeoutMinutes,
    startingFindingIds,
  };

  sm.setShakeBreakSession(session);

  return JSON.stringify({
    terminalWarning: TERMINAL_WARNING,
    terminalWarningAnsi: TERMINAL_WARNING_ANSI,
    backupRecommendation: "GIT COMMIT/STASH, BACKUP/SNAPSHOT, DB-DUMP",
    userMustConfirm: true,
    sandboxPath: worktreePath,
    envFile: join(worktreePath, ".env.shake-break"),
    port,
    dbUrl: dbConfig.dbUrl,
    dbType: dbConfig.dbType,
    dbFallback: dbConfig.dbFallback,
    ...(dbConfig.dbFallbackWarning ? { dbFallbackWarning: dbConfig.dbFallbackWarning } : {}),
    dockerContainerId: dbConfig.dockerContainerId,
    startHint,
    timeoutMinutes: timeoutMinutes,
    categories: input.categories,
    neutralizedServices: envResult.neutralized,
  });
}
