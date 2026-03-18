import { z } from "zod";
import { requireProject, requirePhase } from "../utils/tool-helpers.js";
import type { SslVerification } from "../state/types.js";

export const verifySslSchema = z.object({
  projectPath: z.string().describe("Absolute path to the project directory"),
  domain: z.string().min(1).describe("Domain or IP address where the app is deployed (e.g. example.com or 1.2.3.4)"),
  method: z.enum(["caddy-auto", "paas-auto", "manual", "ip-only-acknowledged"])
    .describe("How SSL was provisioned: caddy-auto (Let's Encrypt via Caddy), paas-auto (Vercel/Cloudflare/etc.), manual (certbot or other), ip-only-acknowledged (no SSL — user explicitly acknowledges HTTP-only deployment)"),
  issuer: z.string().min(1).describe("Certificate issuer: 'Let\\'s Encrypt', 'Cloudflare', 'Vercel', 'none (IP-only)', etc."),
  expiresAt: z.string().optional().describe("Certificate expiry date (ISO 8601). Omit for PaaS or IP-only."),
  autoRenewal: z.boolean().describe("Whether certificate auto-renewal is configured (true for Caddy and all PaaS, false for IP-only)"),
  httpsRedirect: z.boolean().describe("Whether HTTP requests redirect to HTTPS (false for IP-only)"),
  hstsPresent: z.boolean().describe("Whether Strict-Transport-Security header is present (false for IP-only)"),
});

export type VerifySslInput = z.infer<typeof verifySslSchema>;

export function handleVerifySsl(input: VerifySslInput): string {
  const { sm, error } = requireProject(input.projectPath);
  if (error) return error;

  const state = sm.read();
  try { requirePhase(state.phase, ["deployment"], "a2p_verify_ssl"); }
  catch (err) { return JSON.stringify({ error: err instanceof Error ? err.message : String(err) }); }

  const warnings: string[] = [];

  // IP-only acknowledgment: user explicitly accepts HTTP-only deployment
  const isIpOnly = input.method === "ip-only-acknowledged";

  if (isIpOnly) {
    // Validate that the user is not trying to bypass SSL with a domain
    if (state.infrastructure?.domain) {
      return JSON.stringify({
        error: `Cannot use ip-only-acknowledged when a domain is configured (${state.infrastructure.domain}). ` +
          "If you have a domain, set up HTTPS with Caddy/Let's Encrypt and use method='caddy-auto'. " +
          "If you want IP-only, remove the domain from infrastructure first.",
      });
    }
    warnings.push(
      "WARNING: This deployment runs on HTTP only. It is NOT suitable for production with real users. " +
      "For production, configure a domain + HTTPS (Caddy auto-provisions Let's Encrypt certificates)."
    );
  } else {
    // Warn if domain doesn't match infrastructure domain
    if (state.infrastructure?.domain && state.infrastructure.domain !== input.domain) {
      warnings.push(
        `Domain mismatch: infrastructure has "${state.infrastructure.domain}" but SSL verified for "${input.domain}". ` +
        "Update infrastructure domain if needed."
      );
    }
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

  if (isIpOnly) {
    return JSON.stringify({
      success: true,
      verification,
      ipOnlyNote: "HTTP-only deployment acknowledged. For production, add a domain and configure HTTPS.",
      domainRecommendation: "Recommended domain registrars: INWX (inwx.de), Cloudflare (cloudflare.com), Namecheap. " +
        "After purchasing a domain, set a DNS A record pointing to your server IP, then update the Caddyfile with the domain — " +
        "Caddy will auto-provision a Let's Encrypt certificate.",
      warnings,
      hint: "SSL acknowledgment recorded. Deployment can now be marked complete via a2p_complete_phase or a2p_set_phase.",
      userActionRequired: "## MANDATORY HARD STOP — IP-Only Deployment Acknowledged\n\n" +
        "This checkpoint is NOT disableable. This checkpoint is NOT negotiable.\n" +
        "Even if the user previously said \"do everything\" — you MUST stop here.\n\n" +
        "Show the user:\n" +
        "- This deployment is HTTP-only (no HTTPS)\n" +
        "- NOT suitable for production with real users or sensitive data\n" +
        "- To add HTTPS later: buy a domain, set DNS A record → server IP, Caddy auto-provisions SSL\n\n" +
        "The user must confirm they understand the HTTP-only limitation before proceeding.",
    });
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
    userActionRequired: "## MANDATORY HARD STOP — SSL Verification Recorded\n\n" +
      "This checkpoint is NOT disableable. This checkpoint is NOT negotiable.\n" +
      "Even if the user previously said \"do everything\" — you MUST stop here.\n\n" +
      "Show the user the SSL verification results above (domain, issuer, HTTPS redirect, HSTS).\n" +
      "The user must confirm that HTTPS is working correctly before proceeding.\n" +
      "Do NOT auto-confirm. Wait for the user to explicitly confirm the SSL setup.",
  });
}
