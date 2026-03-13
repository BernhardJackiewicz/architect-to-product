import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

export const generateDeploymentSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GenerateDeploymentInput = z.infer<typeof generateDeploymentSchema>;

/**
 * Returns deployment guidance based on the project's tech stack.
 * Claude uses this to dynamically generate Dockerfile, docker-compose, Caddyfile, etc.
 */
export function handleGenerateDeployment(input: GenerateDeploymentInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

  const state = sm.read();
  if (!state.architecture) {
    return JSON.stringify({ error: "No architecture set." });
  }

  const tech = state.architecture.techStack;
  const progress = sm.getProgress();

  return JSON.stringify({
    projectName: state.projectName,
    techStack: tech,
    progress: {
      slicesDone: progress.doneSlices,
      slicesTotal: progress.totalSlices,
      openFindings: progress.openFindings,
    },
    deploymentGuide: {
      filesToGenerate: [
        "Dockerfile (multi-stage, non-root user)",
        "docker-compose.prod.yml (app + reverse proxy, named volumes, log rotation, security_opt)",
        "Caddyfile (HTTPS, security headers, path blocking for .env/.git/.db)",
        ".env.production.example (all required env vars with placeholders)",
        "scripts/backup.sh (database backup with retention)",
        "docs/DEPLOYMENT.md (step-by-step deployment guide)",
        "docs/LAUNCH_CHECKLIST.md (pre-launch verification checklist)",
      ],
      securityHardening: [
        "Docker: read_only filesystem, no-new-privileges, cap_drop ALL",
        "UFW/Docker patch: add iptables rules to /etc/ufw/after.rules",
        "SSH: key-only auth, non-standard port, fail2ban",
        "Docker logging: max-size 10m, max-file 5",
        "Internal services: expose (not ports) — only reverse proxy is public",
        "Secrets: Docker secrets or .env (never in image)",
      ],
      recommendations: buildRecommendations(tech),
    },
    hint: "Generate these files dynamically based on the tech stack. Do NOT use templates — adapt to the specific project.",
  });
}

function buildRecommendations(tech: {
  language: string;
  framework: string;
  database: string | null;
  frontend: string | null;
  hosting: string | null;
}): string[] {
  const recs: string[] = [];

  // Language-specific
  if (tech.language.toLowerCase().includes("python")) {
    recs.push("Use python:3.12-slim (not Alpine — wheel compatibility)");
    recs.push("Single Uvicorn worker with SQLite to avoid write contention");
    recs.push("Use uv for fast dependency installation");
  } else if (tech.language.toLowerCase().includes("typescript") || tech.language.toLowerCase().includes("node")) {
    recs.push("Multi-stage build: builder (npm ci) → production (copy node_modules)");
    recs.push("Use node:22-slim as base image");
  }

  // Database-specific
  if (tech.database?.toLowerCase().includes("sqlite")) {
    recs.push("Mount database DIRECTORY as named volume (not individual .db file)");
    recs.push("Set PRAGMA journal_mode=WAL, busy_timeout=5000, foreign_keys=ON");
    recs.push("Consider Litestream for continuous S3 replication");
  }

  // Hosting-specific
  if (tech.hosting?.toLowerCase().includes("hetzner")) {
    recs.push("Hetzner CX23: 2 vCPU, 4GB RAM, €3.49/month, Nuremberg datacenter");
    recs.push("Enable Hetzner automated backups (+20% = €0.70/month)");
  }

  // Frontend-specific
  if (tech.frontend) {
    recs.push("Serve static assets directly from Caddy (not through the app)");
    recs.push("Enable gzip/zstd compression in Caddyfile");
  }

  recs.push("Use UptimeRobot (free) for /health endpoint monitoring");
  recs.push("Use Sentry (free tier) for error tracking");

  return recs;
}
