import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import type { SslVerification } from "../state/types.js";

export const verifySslSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  domain: z.string().min(1).describe("Domain where HTTPS was verified (e.g. example.com)"),
  method: z.enum(["caddy-auto", "paas-auto", "manual"])
    .describe("How SSL was provisioned: caddy-auto (Let's Encrypt via Caddy), paas-auto (Vercel/Cloudflare/etc.), manual (certbot or other)"),
  issuer: z.string().min(1).describe("Certificate issuer: 'Let\\'s Encrypt', 'Cloudflare', 'Vercel', etc."),
  expiresAt: z.string().optional().describe("Certificate expiry date (ISO 8601). Omit for PaaS where expiry is managed automatically."),
  autoRenewal: z.boolean().describe("Whether certificate auto-renewal is configured (true for Caddy and all PaaS)"),
  httpsRedirect: z.boolean().describe("Whether HTTP requests redirect to HTTPS"),
  hstsPresent: z.boolean().describe("Whether Strict-Transport-Security header is present"),
});

export type VerifySslInput = z.infer<typeof verifySslSchema>;

export function handleVerifySsl(input: VerifySslInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_verify_ssl"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  // Warn if domain doesn't match infrastructure domain
  const warnings: string[] = [];
  if (state.infrastructure?.domain && state.infrastructure.domain !== input.domain) {
    warnings.push(
      `Domain mismatch: infrastructure has "${state.infrastructure.domain}" but SSL verified for "${input.domain}". ` +
      "Update infrastructure domain if needed."
    );
  }

  const now = new Date().toISOString();
  const verification: SslVerification = {
    domain: input.domain,
    verifiedAt: now,
    method: input.method,
    issuer: input.issuer,
    expiresAt: input.expiresAt ?? null,
    autoRenewal: input.autoRenewal,
    httpsRedirect: input.httpsRedirect,
    hstsPresent: input.hstsPresent,
  };

  try {
    sm.setSslVerification(verification);
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const renewalNote = input.autoRenewal
    ? input.method === "caddy-auto"
      ? "Caddy renews Let's Encrypt certificates automatically ~30 days before expiry. No cron job needed."
      : "PaaS handles certificate renewal automatically."
    : "Manual renewal required — set up a cron job or reminder before certificate expiry.";

  return JSON.stringify({
    success: true,
    verification,
    renewalNote,
    warnings: warnings.length > 0 ? warnings : undefined,
    hint: "SSL verification recorded. Deployment can now be marked complete via a2p_complete_phase or a2p_set_phase.",
  });
}
