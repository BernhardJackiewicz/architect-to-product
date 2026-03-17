import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";

export const setSecretManagementSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  tier: z.enum(["env-file", "docker-swarm", "infisical", "external"])
    .describe("Secret management tier chosen by the USER. Do NOT choose this autonomously — ask the user first."),
});

export type SetSecretManagementInput = z.infer<typeof setSecretManagementSchema>;

const TIER_DESCRIPTIONS: Record<string, { name: string; summary: string; nextSteps: string[] }> = {
  "env-file": {
    name: ".env file (Tier 1)",
    summary: "Secrets in .env.production with chmod 600. Simplest setup, suitable for MVP/sandbox.",
    nextSteps: [
      "Generate .env.production.example with placeholders",
      "docker-compose.prod.yml uses env_file: .env.production",
      "SCP + chmod 600 on deploy",
    ],
  },
  "docker-swarm": {
    name: "Docker Swarm secrets (Tier 2)",
    summary: "Secrets encrypted at rest in Swarm Raft log. No external dependency, zero cost.",
    nextSteps: [
      "Run 'docker swarm init' on server",
      "Generate scripts/create-secrets.sh for each secret",
      "Generate docker-compose.prod.yml with secrets: section",
      "Generate scripts/docker-entrypoint.sh to export /run/secrets/* as env vars",
      "Deploy via 'docker stack deploy' instead of 'docker compose up'",
    ],
  },
  "infisical": {
    name: "Infisical (Tier 3)",
    summary: "External secrets manager with audit trail, rotation, web UI. Free tier: 3 projects, 5 identities.",
    nextSteps: [
      "Create Machine Identity in Infisical dashboard (Universal Auth)",
      "Add all secrets to Infisical project (production environment)",
      "User provides clientId + clientSecret (store in shell var only, never in files)",
      "Modify Dockerfile to install Infisical CLI + set ENTRYPOINT",
      "docker-compose.prod.yml passes only INFISICAL_CLIENT_ID + CLIENT_SECRET",
      "On server: .env.infisical with 2 vars only, chmod 600",
    ],
  },
  "external": {
    name: "External secrets manager (Tier 4)",
    summary: "HashiCorp Vault, AWS Secrets Manager, Doppler, or similar. For compliance-mandated environments.",
    nextSteps: [
      "Generate .env.production.example as documentation of required vars",
      "Implementation is provider-specific — user's DevOps/Security team handles integration",
    ],
  },
};

export function handleSetSecretManagement(input: SetSecretManagementInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_set_secret_management"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  try {
    const updated = sm.setSecretManagementTier(input.tier);
    const info = TIER_DESCRIPTIONS[input.tier];

    return JSON.stringify({
      success: true,
      tier: input.tier,
      tierName: info.name,
      summary: info.summary,
      nextSteps: info.nextSteps,
      hint: `Secret management set to ${info.name}. Generate deployment configs with a2p_generate_deployment — ` +
        "they will be adapted to this tier.",
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
