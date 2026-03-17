import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";

export const deployToServerSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
});

export type DeployToServerInput = z.infer<typeof deployToServerSchema>;

/**
 * Generate the exact SSH/SCP/rsync commands to deploy to a provisioned server.
 * Returns an ordered command list — Claude executes them via Bash.
 */
export function handleDeployToServer(input: DeployToServerInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_deploy_to_server"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  if (!state.infrastructure) {
    return JSON.stringify({ error: "No infrastructure recorded. Call a2p_record_server first." });
  }

  if (!state.secretManagementTier) {
    return JSON.stringify({
      error: "Secret management tier not chosen. Call a2p_set_secret_management first. " +
        "Options: env-file, docker-swarm, infisical, external.",
    });
  }

  if (!state.deployApprovalAt) {
    return JSON.stringify({ error: "Deploy approval required. Call a2p_deploy_approval first." });
  }

  const infra = state.infrastructure;
  const host = infra.domain ?? infra.serverIp;
  const sshTarget = `${infra.sshUser}@${infra.serverIp}`;
  const appDir = "/opt/app";

  const rsyncExcludes = [
    ".git",
    "node_modules",
    ".env",
    ".env.*",
    "!.env.production.example",
    ".a2p",
    "__pycache__",
    ".venv",
    "target",
    ".next",
    "dist",
  ];

  const excludeFlags = rsyncExcludes.map(e => `--exclude='${e}'`).join(" ");

  const steps = [
    {
      step: 1,
      description: "Sync project files to server",
      command: `rsync -avz --delete ${excludeFlags} ${input.projectPath}/ ${sshTarget}:${appDir}/`,
      note: "Excludes .git, node_modules, .env files, .a2p state, build artifacts",
    },
    {
      step: 2,
      description: "Copy .env.production to server",
      command: `scp ${input.projectPath}/.env.production ${sshTarget}:${appDir}/.env.production`,
      note: "Ensure .env.production exists locally with all required secrets before running this",
    },
    {
      step: 2.5,
      description: "Secure .env.production file permissions",
      command: `ssh ${sshTarget} "chmod 600 ${appDir}/.env.production"`,
      note: "Restricts .env.production to owner-only read. For production secrets, consider Docker secrets or an external secrets manager.",
    },
    {
      step: 3,
      description: "Build and start containers on server",
      command: `ssh ${sshTarget} "cd ${appDir} && docker compose -f docker-compose.prod.yml up -d --build"`,
    },
    {
      step: 4,
      description: "Wait for containers to be healthy",
      command: `ssh ${sshTarget} "cd ${appDir} && sleep 10 && docker compose -f docker-compose.prod.yml ps"`,
    },
    {
      step: 5,
      description: "Health check",
      command: `curl -sf http://${host}/health || curl -sf https://${host}/health`,
      note: "Verify the application responds. HTTPS will work once DNS + Caddy are configured.",
    },
    {
      step: 6,
      description: "Check container logs for errors",
      command: `ssh ${sshTarget} "cd ${appDir} && docker compose -f docker-compose.prod.yml logs --tail=50"`,
      note: "Review for startup errors, crash loops, or connection issues",
    },
  ];

  // Secret management tier guidance
  const secretManagementNote = {
    tier1: "Default: .env.production via SCP + chmod 600 (steps 2 + 2.5 above).",
    tier2: "Docker Swarm: skip steps 2 + 2.5. Instead run 'docker swarm init' and 'scripts/create-secrets.sh' on server, then 'docker stack deploy -c docker-compose.prod.yml appname' instead of docker compose up.",
    tier3: "Infisical: replace step 2 with SCP of .env.infisical (2 vars: clientId + clientSecret only), chmod 600. All other secrets fetched at runtime from Infisical API.",
  };

  // Record deployment timestamp
  sm.updateLastDeployed();

  return JSON.stringify({
    infrastructure: {
      provider: infra.provider,
      serverIp: infra.serverIp,
      serverName: infra.serverName,
      sshUser: infra.sshUser,
      domain: infra.domain ?? null,
    },
    secretManagementNote,
    deploymentSteps: steps,
    postDeployChecks: [
      `curl -sf http://${host}/health — should return 200`,
      `curl -sf http://${host}/.env — should return 403/404 (blocked)`,
      `curl -sf http://${host}/.git/config — should return 403/404 (blocked)`,
      "Check HTTPS works (after DNS + Caddy configured)",
      "Check security headers (HSTS, X-Frame-Options, etc.)",
      "After HTTPS verified: call a2p_verify_ssl to record SSL verification (required gate before deployment complete)",
    ],
    domainSetup: infra.domain
      ? `DNS A-Record: ${infra.domain} -> ${infra.serverIp}. Caddy will auto-provision Let's Encrypt certificate.`
      : `No domain configured. Set DNS A-Record pointing to ${infra.serverIp}, then update Caddyfile with the domain.`,
  });
}
