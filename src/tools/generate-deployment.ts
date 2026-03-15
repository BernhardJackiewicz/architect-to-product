import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";

export const generateDeploymentSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GenerateDeploymentInput = z.infer<typeof generateDeploymentSchema>;

/**
 * Returns deployment guidance based on the project's tech stack.
 * Claude uses this to dynamically generate Dockerfile, docker-compose, Caddyfile, etc.
 */
export function handleGenerateDeployment(input: GenerateDeploymentInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_generate_deployment"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  if (!state.architecture) {
    return JSON.stringify({ error: "No architecture set." });
  }

  if (!state.deployApprovalAt) {
    return JSON.stringify({
      error: "Deploy approval required. Call a2p_deploy_approval first.",
    });
  }

  const tech = state.architecture.techStack;
  const progress = sm.getProgress();
  const backupConfig = state.backupConfig;
  const hasDbTarget = backupConfig.targets.includes("database");

  // Determine if a server/backend deployment context exists
  const platform = tech.platform;
  const hasServerContext = platform !== "mobile" || !!tech.hosting || !!tech.database;

  const filesToGenerate: string[] = [];
  const securityHardening: string[] = [];

  if (hasServerContext) {
    filesToGenerate.push(
      "Dockerfile (multi-stage, non-root user)",
      "docker-compose.prod.yml (app + reverse proxy, named volumes, log rotation, security_opt)",
      "Caddyfile (HTTPS, security headers, path blocking for .env/.git/.db)",
      ".env.production.example (all required env vars with placeholders)",
      `scripts/backup.sh (${hasDbTarget ? "database + " : ""}deployment artifact backup with retention + manifest)`,
      "scripts/restore.sh (restore from backup with verification)",
      "scripts/backup-verify.sh (verify backup integrity + freshness)",
      "ops/backup.env.example (backup config: paths, retention, offsite)",
      "docs/BACKUP.md (strategy, schedule, restore, verification)",
    );

    if (backupConfig.offsiteProvider !== "none") {
      filesToGenerate.push(`scripts/backup-offsite.sh (sync to ${backupConfig.offsiteProvider})`);
    }

    securityHardening.push(
      "Docker: read_only filesystem, no-new-privileges, cap_drop ALL",
      "UFW/Docker patch: add iptables rules to /etc/ufw/after.rules",
      "SSH: key-only auth, non-standard port, fail2ban",
      "Docker logging: max-size 10m, max-file 5",
      "Internal services: expose (not ports) — only reverse proxy is public",
      "Secrets: Docker secrets or .env (never in image)",
    );
  }

  // Always generate deployment docs
  filesToGenerate.push(
    "docs/DEPLOYMENT.md (step-by-step deployment guide)",
    "docs/LAUNCH_CHECKLIST.md (pre-launch verification checklist)",
  );

  // Build response
  const isMobilePlatform = platform === "mobile" || platform === "cross-platform";
  const deploymentGuide: Record<string, unknown> = {
    filesToGenerate,
    ...(securityHardening.length > 0 ? { securityHardening } : {}),
    recommendations: buildRecommendations(tech, hasServerContext),
  };

  // Backup guide only when server context exists
  if (hasServerContext) {
    deploymentGuide.backupGuide = {
      config: backupConfig,
      ...(hasDbTarget ? {
        dbCommand: getBackupCommand(tech.database),
        restoreCommand: getRestoreCommand(tech.database),
      } : {}),
      schedulerHint: getSchedulerHint(tech.hosting),
      verifyHint: backupConfig.verifyAfterBackup
        ? "After each backup: restore to temp, verify integrity."
        : "Manual verification recommended.",
      offsiteHint: getOffsiteHint(backupConfig.offsiteProvider),
    };

    if (backupConfig.required && !state.backupStatus.configured) {
      deploymentGuide.backupWarning = {
        message: "BACKUP REQUIRED but not configured. Stateful app — data loss risk.",
        stateful: true,
        missingTargets: backupConfig.targets,
      };
    }
  }

  // Mobile deployment note — guidance only, no artifact promises
  if (isMobilePlatform) {
    deploymentGuide.mobileDeploymentNote = "Mobile deployment is handled outside A2P via platform-specific toolchains (Xcode, Android Studio, flutter build, eas build). See recommendations for guidance. A2P does not generate mobile build scripts or store configs.";
  }

  return JSON.stringify({
    projectName: state.projectName,
    techStack: tech,
    progress: {
      slicesDone: progress.doneSlices,
      slicesTotal: progress.totalSlices,
      openFindings: progress.openFindings,
    },
    deploymentGuide,
    hint: hasServerContext
      ? "Generate these files dynamically based on the tech stack. Do NOT use templates — adapt to the specific project."
      : "This is a mobile/client project. Server deployment files are only needed if a backend is part of the architecture.",
  });
}

function buildRecommendations(tech: {
  language: string;
  framework: string;
  database: string | null;
  frontend: string | null;
  hosting: string | null;
  platform?: string | null;
}, hasServerContext: boolean): string[] {
  const recs: string[] = [];

  // Language-specific Docker/container recommendations — only for server deployments
  const lang = tech.language.toLowerCase();
  if (hasServerContext && lang.includes("python")) {
    recs.push("Use python:3.12-slim (not Alpine — wheel compatibility)");
    recs.push("Single Uvicorn worker with SQLite to avoid write contention");
    recs.push("Use uv for fast dependency installation");
  } else if (hasServerContext && (lang.includes("typescript") || lang.includes("node"))) {
    recs.push("Multi-stage build: builder (npm ci) → production (copy node_modules)");
    recs.push("Use node:22-slim as base image");
  } else if (hasServerContext && lang.includes("go")) {
    recs.push("Multi-stage: golang:1.23 → scratch/distroless, CGO_ENABLED=0 for static binary");
    recs.push("Single static binary — no runtime dependencies needed");
  } else if (hasServerContext && lang.includes("rust")) {
    recs.push("Multi-stage: rust:1.82 → debian:bookworm-slim, cargo build --release");
    recs.push("Strip binary with strip --strip-all to reduce image size");
  } else if (hasServerContext && (lang.includes("java") || lang.includes("kotlin"))) {
    recs.push("Multi-stage: eclipse-temurin:21 → temurin:21-jre (JRE only for production)");
    recs.push("Use Gradle/Maven layer caching for faster rebuilds");
  } else if (hasServerContext && lang.includes("ruby")) {
    recs.push("Use ruby:3.3-slim as base image");
    recs.push("bundle install --without development test, use Puma as app server");
  } else if (hasServerContext && lang.includes("php")) {
    recs.push("Use php:8.3-fpm + Caddy (simpler than nginx + php-fpm)");
    recs.push("composer install --no-dev, enable opcache for production performance");
  } else if (hasServerContext && (lang.includes("c#") || lang.includes(".net") || lang.includes("csharp"))) {
    recs.push("Multi-stage: mcr.microsoft.com/dotnet/sdk → aspnet runtime");
    recs.push("Use PublishTrimmed for smaller image size");
  }

  // Database-specific
  const db = tech.database?.toLowerCase() ?? "";
  if (db.includes("sqlite")) {
    recs.push("Mount database DIRECTORY as named volume (not individual .db file)");
    recs.push("Set PRAGMA journal_mode=WAL, busy_timeout=5000, foreign_keys=ON");
    recs.push("Consider Litestream for continuous S3 replication");
  } else if (db.includes("postgres")) {
    recs.push("Use dedicated PostgreSQL container or managed DB (not embedded)");
    recs.push("Set up pg_dump cron backup with retention policy");
    recs.push("Use PgBouncer for connection pooling, tune max_connections");
  } else if (db.includes("mysql") || db.includes("mariadb")) {
    recs.push("Use dedicated MySQL/MariaDB container with named volume");
    recs.push("Set up mysqldump cron backup with retention policy");
    recs.push("Tune innodb_buffer_pool_size (50-70% of available RAM)");
  } else if (db.includes("mongo")) {
    recs.push("Use Replica Set (even single-node for oplog support)");
    recs.push("Set up mongodump cron backup with retention policy");
    recs.push("Enable --auth and create dedicated app user");
  } else if (db.includes("redis")) {
    recs.push("Set maxmemory + eviction policy (allkeys-lru for cache, noeviction for queue)");
    recs.push("Enable appendonly yes for persistence (AOF)");
    recs.push("Run Redis in separate container with named volume");
  }

  // Hosting-specific
  const hosting = tech.hosting?.toLowerCase() ?? "";
  if (hosting.includes("hetzner")) {
    recs.push("Hetzner CX23: 2 vCPU, 4GB RAM, €3.49/month, Nuremberg datacenter");
    recs.push("Enable Hetzner automated backups (+20% = €0.70/month)");
  } else if (hosting.includes("digitalocean")) {
    recs.push("DigitalOcean Droplet 2GB from $12/mo, consider Managed DB option");
    recs.push("Use Spaces (S3-compatible) for backups and static assets");
  } else if (hosting.includes("aws")) {
    recs.push("EC2 t3.micro (Free Tier) or ECS Fargate for container orchestration");
    recs.push("Use RDS for managed database, S3 for backups");
  } else if (hosting.includes("fly")) {
    recs.push("Configure fly.toml, deploy with fly deploy, use Volumes for persistent data");
    recs.push("Fly.io handles TLS automatically — no Caddy needed");
  } else if (hosting.includes("railway")) {
    recs.push("Simplest setup: railway up with auto-detection, managed DB add-ons available");
    recs.push("Railway handles HTTPS and scaling — focus on app code");
  } else if (hosting.includes("vercel")) {
    recs.push("Vercel: frontend/serverless only — no Docker needed, use Edge Functions");
    recs.push("Backend API needs separate hosting (Railway, Fly.io, or VPS)");
  } else if (hosting.includes("render")) {
    recs.push("Render: render.yaml Blueprint for declarative infrastructure (web + DB + workers)");
    recs.push("Render handles TLS, auto-deploy from GitHub — focus on render.yaml and health checks");
    recs.push("Use Private Services for internal backends, Environment Groups for shared vars");
  } else if (hosting.includes("cloudflare")) {
    recs.push("Cloudflare Pages for static/SSR, Workers for API — no Docker needed");
    recs.push("Use wrangler.toml for bindings (KV, D1, R2), wrangler secret for secrets");
    recs.push("WAF, DDoS protection, and CDN included — configure Page Rules for caching");
  } else if (hosting.includes("debian") || hosting.includes("ubuntu") || hosting.includes("vps")) {
    recs.push("Enable unattended-upgrades for automatic security patches");
    recs.push("Configure swap (2x RAM, max 4GB), set up logrotate for app logs");
    recs.push("Use systemd hardening (ProtectSystem, NoNewPrivileges, PrivateTmp)");
  }

  // Frontend-specific
  if (tech.frontend) {
    recs.push("Serve static assets directly from Caddy (not through the app)");
    recs.push("Enable gzip/zstd compression in Caddyfile");
  }

  // Mobile / cross-platform deployment recommendations
  const fw = tech.framework.toLowerCase();
  const platform = tech.platform;
  const isMobilePlatform = platform === "mobile" || platform === "cross-platform";

  if (isMobilePlatform) {
    if (fw.includes("flutter")) {
      recs.push("Backend → Docker-VPS (existing deployment). Mobile: `flutter build ios --release` / `flutter build apk --release`");
      recs.push("Distribution: TestFlight (iOS) + Play Store Internal Testing (Android)");
    } else if (fw.includes("react native") || fw.includes("expo")) {
      recs.push("Backend → Docker-VPS (existing deployment). Mobile: `eas build` or `fastlane` for native builds");
      recs.push("Distribution: TestFlight (iOS) + Play Store Internal Testing (Android)");
    } else {
      recs.push("Backend → Docker-VPS (existing deployment). Mobile: platform-specific release build");
      recs.push("Distribution: TestFlight (iOS) + Play Store Internal Testing (Android)");
    }
    recs.push("Deploy backend first, configure API base URL, then distribute mobile builds");
    recs.push("Backend + mobile versions must be compatible — API versioning recommended");
  }

  recs.push("Use UptimeRobot (free) for /health endpoint monitoring");
  recs.push("Use Sentry (free tier) for error tracking");

  return recs;
}

function getBackupCommand(database: string | null): string {
  const db = (database ?? "").toLowerCase();
  if (db.includes("postgres") || db.includes("supabase"))
    return "pg_dump -Fc -f $BACKUP_FILE $DATABASE_URL";
  if (db.includes("mysql") || db.includes("mariadb"))
    return "mysqldump --single-transaction --defaults-file=$MYSQL_DEFAULTS_FILE $DB_NAME > $BACKUP_FILE";
  if (db.includes("mongo"))
    return "mongodump --uri=$MONGO_URI --archive=$BACKUP_FILE --gzip";
  if (db.includes("sqlite"))
    return "sqlite3 $DB_PATH '.backup $BACKUP_FILE' && sqlite3 $BACKUP_FILE 'PRAGMA integrity_check;'";
  return "# No database-specific backup — customize for your data store";
}

function getRestoreCommand(database: string | null): string {
  const db = (database ?? "").toLowerCase();
  if (db.includes("postgres") || db.includes("supabase"))
    return "pg_restore -d $DATABASE_URL $BACKUP_FILE";
  if (db.includes("mysql") || db.includes("mariadb"))
    return "mysql --defaults-file=$MYSQL_DEFAULTS_FILE $DB_NAME < $BACKUP_FILE";
  if (db.includes("mongo"))
    return "mongorestore --uri=$MONGO_URI --archive=$BACKUP_FILE --gzip";
  if (db.includes("sqlite"))
    return "# Stop application first, then: cp $BACKUP_FILE $DB_PATH && sqlite3 $DB_PATH 'PRAGMA integrity_check;'";
  return "# No database-specific restore — customize for your data store";
}

function getSchedulerHint(hosting: string | null): string {
  const h = (hosting ?? "").toLowerCase();
  if (h.includes("hetzner") || h.includes("digitalocean") || h.includes("vps") ||
      h.includes("debian") || h.includes("ubuntu") || h.includes("linux"))
    return "systemd timer preferred (logging + failure notification). Cron as fallback.";
  return "Configure backup scheduling per your hosting provider's capabilities.";
}

function getOffsiteHint(provider: string): string {
  switch (provider) {
    case "s3": return "aws s3 cp or rclone sync. Configure lifecycle rules for retention.";
    case "b2": return "b2 upload-file or rclone sync. Cost-effective for backups.";
    case "spaces": return "s3cmd or rclone. DigitalOcean Spaces is S3-compatible.";
    case "hetzner_storage": return "rclone with Hetzner Storage Box (SFTP) or Object Storage (S3-compatible).";
    default: return "No offsite configured. Consider S3, B2, or hosting provider's object storage.";
  }
}
