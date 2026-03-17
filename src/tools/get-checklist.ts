import { z } from "zod";
import { requireProject } from "../utils/tool-helpers.js";

export const getChecklistSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GetChecklistInput = z.infer<typeof getChecklistSchema>;

export function handleGetChecklist(input: GetChecklistInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  const progress = sm.getProgress();
  const tech = state.architecture?.techStack;

  const checklist = {
    preDeployment: [
      { item: "All slices completed", done: progress.doneSlices === progress.totalSlices },
      { item: "No open CRITICAL/HIGH SAST findings", done: progress.openFindings === 0 },
      { item: "All quality issues resolved", done: progress.qualityIssues === 0 },
      { item: "Tests passing (0 failures)", done: progress.testsFailed === 0 },
      { item: "Strong secrets generated (JWT_SECRET, API keys)", done: false },
      { item: "CORS configured for production domain only", done: false },
      { item: ".env.production with real values", done: false },
      { item: "Debug mode disabled", done: false },
      { item: "DB user has least-privilege permissions (not root/admin)", done: false },
      { item: "No real PII in seed/test data", done: false },
    ],
    infrastructure: [
      { item: "VPS provisioned and hardened (SSH key-only, fail2ban)", done: false },
      { item: "UFW firewall active with Docker patch applied", done: false },
      { item: "Docker log rotation configured (/etc/docker/daemon.json)", done: false },
      { item: "DNS A record pointing to server IP", done: false },
      { item: "Docker Compose up and running", done: false },
      { item: "SSL certificate obtained (check Caddy logs)", done: false },
    ],
    postDeployment: [
      { item: "/health returns OK", done: false },
      { item: "/.env returns 403/404 (blocked by Caddy)", done: false },
      { item: "/.git/ returns 403/404", done: false },
      { item: "HTTPS enforced (HTTP redirects)", done: false },
      { item: "Security headers present (HSTS, X-Frame-Options, etc.)", done: false },
      { item: "Auth flow works end-to-end", done: false },
      { item: "UptimeRobot monitoring active", done: false },
      { item: "Backup script/cron active", done: false },
      { item: "Cookie security flags set (HttpOnly, Secure, SameSite)", done: false },
      { item: "CORS restricted to production domain (no wildcard with credentials)", done: false },
      { item: "Backup encryption configured (or access control on backup directory)", done: false },
      { item: "Session timeout configured", done: false },
      { item: "JWT expiry configured (≤ 24h recommended)", done: false },
      { item: "Webhook signature verification active", done: false },
      { item: "DB connection uses TLS/SSL", done: false },
      { item: "Metrics/admin endpoints not publicly accessible", done: false },
      { item: "DR runbook documented and recovery tested", done: false },
    ],
  };

  // E2E testing item for UI slices
  const hasUISlices = state.slices.some((s) => s.hasUI);
  if (hasUISlices) {
    const hasE2EResults = state.buildHistory.some((e) => e.action === "e2e_test");
    checklist.preDeployment.push({
      item: "E2E tests executed for UI slices (requires playwright-mcp companion)",
      done: hasE2EResults,
    });
  }

  // Backup-specific items
  const backupConfig = state.backupConfig;
  if (backupConfig.enabled && backupConfig.required) {
    // Remove generic backup item — we have specific ones
    const genericIdx = checklist.postDeployment.findIndex(
      (i) => i.item.startsWith("Backup script/cron")
    );
    if (genericIdx >= 0) checklist.postDeployment.splice(genericIdx, 1);

    checklist.infrastructure.push(
      { item: "Backup scripts generated and tested locally", done: false },
      { item: `Backup scheduler active (${backupConfig.schedule} at ${backupConfig.time})`, done: state.backupStatus.configured },
      { item: `Retention configured (${backupConfig.retentionDays} days)`, done: false },
      { item: "Restore documentation present (BACKUP.md)", done: false },
    );

    if (backupConfig.offsiteProvider !== "none") {
      checklist.infrastructure.push(
        { item: `Offsite backup to ${backupConfig.offsiteProvider} configured`, done: false },
      );
    }

    checklist.postDeployment.push(
      { item: "First backup completed successfully", done: false },
    );

    if (backupConfig.verifyAfterBackup) {
      checklist.postDeployment.push(
        { item: "Backup verification: restore to temp + integrity check passed", done: false },
      );
    }

    if (backupConfig.preDeploySnapshot) {
      checklist.postDeployment.push(
        { item: "Pre-deploy snapshot taken before production deployment", done: false },
      );
    }
  }

  // Platform-specific items (mobile / cross-platform / desktop)
  const platform = tech?.platform;
  const isMobile = platform === "mobile" || platform === "cross-platform";

  if (isMobile) {
    checklist.preDeployment.push(
      { item: "Code signing configured (iOS Provisioning Profile, Android Keystore)", done: false },
      { item: "App ID / Bundle ID registered (Apple / Google)", done: false },
      { item: "No secrets in shipped client artifact verified", done: false },
      { item: "Release build hardening enabled (obfuscation/minification/symbol handling as applicable)", done: false },
      { item: "Release artifact built in non-debug mode", done: false },
    );
    checklist.infrastructure.push(
      { item: "TestFlight / Play Store Internal Testing configured", done: false },
    );
    checklist.postDeployment.push(
      { item: "App Store / Play Store listing draft prepared", done: false },
      { item: "Deep links / universal links configured and tested", done: false },
      { item: "Push notification certificates configured", done: false },
      { item: "Client local storage for sensitive data reviewed", done: false },
      { item: "TLS / ATS / Network Security Config reviewed", done: false },
      { item: "Signing / provisioning / release packaging verified", done: false },
    );
  }

  if (platform === "cross-platform") {
    checklist.preDeployment.push(
      { item: "Desktop release packaging reviewed for embedded config/secrets", done: false },
      { item: "Code signing / notarization status reviewed if target platform requires it", done: false },
    );
  }

  // Compliance items (GoBD, GDPR) — activated by keywords in features/otherTech
  const allFeaturesAndTech = [...(tech?.other ?? []), ...(state.architecture?.features ?? [])].map(f => f.toLowerCase()).join(" ");
  const hasCompliance = /gobd|gdpr|dsgvo|compliance|retention|audit.?trail|archivierung|archiving/.test(allFeaturesAndTech);

  if (hasCompliance) {
    checklist.preDeployment.push(
      { item: "Append-only / immutable storage configured for audit data", done: false },
      { item: "Retention policy documented (duration, deletion, export)", done: false },
    );
    checklist.postDeployment.push(
      { item: "Audit trail immutability verified", done: false },
      { item: "Data export for GDPR/DSGVO functional", done: false },
    );
  }

  // External validator items (KoSIT, veraPDF, etc.) — activated by keywords in otherTech
  const otherLower = (tech?.other ?? []).map(t => t.toLowerCase()).join(" ");
  const hasValidator = /kosit|verapdf|mustangproject|e.?invoice.?validat|xml.?validat|pdf.?validat/.test(otherLower);

  if (hasValidator) {
    checklist.preDeployment.push(
      { item: "External validator installed and version-pinned", done: false },
      { item: "Validation test suite covers reject-cases", done: false },
    );
    checklist.postDeployment.push(
      { item: "Validator version documented in release notes", done: false },
    );
  }

  // Add tech-specific items
  const db = tech?.database?.toLowerCase() ?? "";
  const hosting = tech?.hosting?.toLowerCase() ?? "";
  const other = tech?.other?.map((t) => t.toLowerCase()) ?? [];

  if (db.includes("sqlite")) {
    checklist.postDeployment.push(
      { item: "SQLite WAL mode enabled", done: false },
      { item: "Database volume is named volume (not bind mount)", done: false }
    );
  }

  if (db.includes("postgres")) {
    checklist.postDeployment.push(
      { item: "PostgreSQL connection pooling active (PgBouncer)", done: false },
      { item: "pg_dump backup cron configured with retention", done: false },
      { item: "max_connections tuned for expected load", done: false }
    );
  }

  if (db.includes("mysql") || db.includes("mariadb")) {
    checklist.postDeployment.push(
      { item: "mysqldump backup cron configured with retention", done: false },
      { item: "innodb_buffer_pool_size tuned (50-70% RAM)", done: false },
      { item: "Default charset set to utf8mb4", done: false }
    );
  }

  if (db.includes("mongo")) {
    checklist.postDeployment.push(
      { item: "MongoDB auth enabled with dedicated app user", done: false },
      { item: "Replica Set initialized (required for oplog)", done: false },
      { item: "mongodump backup cron configured with retention", done: false }
    );
  }

  if (db.includes("redis") || other.some((t) => t.includes("redis"))) {
    checklist.postDeployment.push(
      { item: "Redis maxmemory policy configured", done: false },
      { item: "Redis persistence configured (AOF or RDB)", done: false }
    );
  }

  if (hosting.includes("debian") || hosting.includes("ubuntu") || hosting.includes("vps") || hosting.includes("linux")) {
    checklist.infrastructure.push(
      { item: "unattended-upgrades active for security patches", done: false },
      { item: "Swap configured (2x RAM, max 4GB)", done: false },
      { item: "logrotate configured for application logs", done: false }
    );
  }

  if (other.some((t) => t.includes("stripe"))) {
    checklist.preDeployment.push(
      { item: "Stripe live keys (not test keys!)", done: false },
      { item: "Stripe webhook URL updated to production domain", done: false },
      { item: "Stripe webhook signature validation active", done: false }
    );
  }

  if (other.some((t) => t.includes("firebase"))) {
    checklist.preDeployment.push(
      { item: "Firebase service account key as Docker secret", done: false },
      { item: "Production domain in Firebase authorized domains", done: false },
      { item: "NTP enabled on server (Firebase token verification)", done: false }
    );
  }

  if (other.some((t) => t.includes("auth0") || t.includes("keycloak"))) {
    checklist.preDeployment.push(
      { item: "Auth callback URLs set to production domain", done: false },
      { item: "Token expiry configured for production", done: false }
    );
  }

  if (other.some((t) => t.includes("sendgrid") || t.includes("mailgun"))) {
    checklist.preDeployment.push(
      { item: "SPF/DKIM/DMARC DNS records configured", done: false },
      { item: "Production API key (not sandbox)", done: false }
    );
  }

  if (other.some((t) => t.includes("clerk"))) {
    checklist.preDeployment.push(
      { item: "Clerk auth callback URLs set to production domain", done: false },
      { item: "Clerk production instance keys (not development keys)", done: false },
      { item: "Clerk webhook endpoint configured for user sync", done: false }
    );
  }

  if (other.some((t) => t.includes("resend"))) {
    checklist.preDeployment.push(
      { item: "Resend SPF/DKIM/DMARC DNS records configured", done: false },
      { item: "Resend production API key (not sandbox)", done: false },
      { item: "Resend sending domain verified", done: false }
    );
  }

  if (other.some((t) => t.includes("upstash"))) {
    checklist.preDeployment.push(
      { item: "Upstash Redis URL configured for production", done: false },
      { item: "Upstash rate-limit configuration tuned", done: false }
    );
  }

  if (other.some((t) => t.includes("sentry"))) {
    checklist.preDeployment.push(
      { item: "Sentry DSN configured for production", done: false },
      { item: "Sentry source maps uploaded for production build", done: false },
      { item: "Sentry release tracking configured", done: false }
    );
  }

  if (hosting.includes("render")) {
    checklist.infrastructure.push(
      { item: "Render Blueprint (render.yaml) deployed", done: false },
      { item: "Render health check URL configured and passing", done: false },
      { item: "Render auto-deploy from GitHub branch configured", done: false }
    );
  }

  if (hosting.includes("vercel")) {
    checklist.infrastructure.push(
      { item: "Vercel project linked and environment variables set", done: false },
      { item: "Vercel preview deployment tested successfully", done: false }
    );
  }

  if (hosting.includes("cloudflare")) {
    checklist.infrastructure.push(
      { item: "Cloudflare NS records configured and active", done: false },
      { item: "Cloudflare SSL mode set to Full (Strict)", done: false },
      { item: "Cloudflare WAF rules configured", done: false }
    );
  }

  if (hosting.includes("fly")) {
    checklist.infrastructure.push(
      { item: "Fly.io app created with fly launch", done: false },
      { item: "Fly.io secrets set via fly secrets set", done: false },
      { item: "Fly.io TLS certificate added via fly certs add", done: false }
    );
  }

  if (hosting.includes("railway")) {
    checklist.infrastructure.push(
      { item: "Railway services configured (web + DB)", done: false },
      { item: "Railway environment variables set", done: false },
      { item: "Railway custom domain configured", done: false }
    );
  }

  return JSON.stringify({
    projectName: state.projectName,
    checklist,
    summary: {
      total: Object.values(checklist).flat().length,
      automated: Object.values(checklist)
        .flat()
        .filter((c) => c.done).length,
      manual: Object.values(checklist)
        .flat()
        .filter((c) => !c.done).length,
    },
  });
}
