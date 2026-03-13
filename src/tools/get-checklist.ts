import { z } from "zod";
import { StateManager } from "../state/state-manager.js";

export const getChecklistSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type GetChecklistInput = z.infer<typeof getChecklistSchema>;

export function handleGetChecklist(input: GetChecklistInput): string {
  const sm = new StateManager(input.projectPath);

  if (!sm.exists()) {
    return JSON.stringify({ error: "No project found." });
  }

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
    ],
  };

  // Add tech-specific items
  if (tech?.database?.toLowerCase().includes("sqlite")) {
    checklist.postDeployment.push(
      { item: "SQLite WAL mode enabled", done: false },
      { item: "Database volume is named volume (not bind mount)", done: false }
    );
  }

  if (tech?.other?.some((t) => t.toLowerCase().includes("stripe"))) {
    checklist.preDeployment.push(
      { item: "Stripe live keys (not test keys!)", done: false },
      { item: "Stripe webhook URL updated to production domain", done: false },
      { item: "Stripe webhook signature validation active", done: false }
    );
  }

  if (tech?.other?.some((t) => t.toLowerCase().includes("firebase"))) {
    checklist.preDeployment.push(
      { item: "Firebase service account key as Docker secret", done: false },
      { item: "Production domain in Firebase authorized domains", done: false },
      { item: "NTP enabled on server (Firebase token verification)", done: false }
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
