import { describe, it, expect } from "vitest";
import { DEPLOY_PROMPT } from "../../src/prompts/deploy.js";

describe("Deploy paths", () => {
  // ─── All 6 deploy paths present ──────────────────────────────────────────

  describe("Docker VPS path", () => {
    it("includes Docker VPS deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Docker VPS");
    });

    it("includes Dockerfile generation", () => {
      expect(DEPLOY_PROMPT).toContain("Dockerfile");
    });

    it("includes docker-compose generation", () => {
      expect(DEPLOY_PROMPT).toContain("docker-compose.prod.yml");
    });

    it("includes Caddyfile generation", () => {
      expect(DEPLOY_PROMPT).toContain("Caddyfile");
    });

    it("includes backup script", () => {
      expect(DEPLOY_PROMPT).toContain("backup.sh");
    });

    it("includes env var handling", () => {
      expect(DEPLOY_PROMPT).toContain(".env.production.example");
    });

    it("includes secret management section with chmod 600", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Automated Hetzner Deployment")
      );
      expect(section).toContain("chmod 600");
      expect(section).toContain("plaintext on disk");
      expect(section).toContain("outside the project directory");
      expect(section).toContain("/run/secrets/");
    });

    it("includes Docker Swarm secrets tier with pros and cons", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Automated Hetzner Deployment")
      );
      expect(section).toContain("Docker Swarm secrets");
      expect(section).toContain("docker swarm init");
      expect(section).toContain("docker secret create");
      expect(section).toContain("docker stack deploy");
      expect(section).toContain("encrypted at rest");
    });

    it("includes Infisical tier with setup guidance", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Automated Hetzner Deployment")
      );
      expect(section).toContain("Infisical");
      expect(section).toContain("infisical run");
      expect(section).toContain("Machine Identity");
      expect(section).toContain("Universal Auth");
      expect(section).toContain("infisical.com");
    });

    it("includes all 4 secret management tiers", () => {
      expect(DEPLOY_PROMPT).toContain("Tier 1:");
      expect(DEPLOY_PROMPT).toContain("Tier 2:");
      expect(DEPLOY_PROMPT).toContain("Tier 3:");
      expect(DEPLOY_PROMPT).toContain("Tier 4:");
    });

    it("asks user to choose secret management tier", () => {
      expect(DEPLOY_PROMPT).toContain("Which secret management tier");
    });

    it("includes SSH hardening", () => {
      expect(DEPLOY_PROMPT).toMatch(/SSH.*key/i);
    });

    it("includes fail2ban", () => {
      expect(DEPLOY_PROMPT).toContain("fail2ban");
    });
  });

  describe("Vercel path", () => {
    it("includes Vercel deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Vercel");
    });

    it("includes vercel.json", () => {
      expect(DEPLOY_PROMPT).toContain("vercel.json");
    });

    it("includes vercel env add", () => {
      expect(DEPLOY_PROMPT).toContain("vercel env add");
    });

    it("includes preview deployment", () => {
      expect(DEPLOY_PROMPT).toMatch(/[Pp]review/);
    });

    it("includes Edge Middleware", () => {
      expect(DEPLOY_PROMPT).toContain("Edge Middleware");
    });

    it("mentions Vercel MCP", () => {
      expect(DEPLOY_PROMPT).toContain("Vercel MCP");
    });
  });

  describe("Cloudflare path", () => {
    it("includes Cloudflare deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Cloudflare");
    });

    it("includes wrangler", () => {
      expect(DEPLOY_PROMPT).toContain("wrangler");
    });

    it("includes KV/D1/R2 bindings", () => {
      expect(DEPLOY_PROMPT).toContain("KV");
      expect(DEPLOY_PROMPT).toContain("D1");
      expect(DEPLOY_PROMPT).toContain("R2");
    });

    it("includes wrangler secret", () => {
      expect(DEPLOY_PROMPT).toContain("wrangler secret");
    });

    it("includes WAF Rules", () => {
      expect(DEPLOY_PROMPT).toContain("WAF");
    });

    it("includes SSL Full Strict", () => {
      expect(DEPLOY_PROMPT).toContain("Full (Strict)");
    });

    it("mentions Cloudflare MCP", () => {
      expect(DEPLOY_PROMPT).toContain("Cloudflare MCP");
    });
  });

  describe("Railway path", () => {
    it("includes Railway deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Railway");
    });

    it("includes railway.toml or Procfile", () => {
      expect(DEPLOY_PROMPT).toContain("railway.toml");
    });

    it("includes railway variables set", () => {
      expect(DEPLOY_PROMPT).toContain("railway variables set");
    });

    it("includes railway up", () => {
      expect(DEPLOY_PROMPT).toContain("railway up");
    });

    it("includes private networking", () => {
      expect(DEPLOY_PROMPT).toMatch(/[Pp]rivate.*[Nn]etwork/);
    });
  });

  describe("Fly.io path", () => {
    it("includes Fly.io deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Fly.io");
    });

    it("includes fly.toml", () => {
      expect(DEPLOY_PROMPT).toContain("fly.toml");
    });

    it("includes fly secrets set", () => {
      expect(DEPLOY_PROMPT).toContain("fly secrets set");
    });

    it("includes fly volumes create", () => {
      expect(DEPLOY_PROMPT).toContain("fly volumes create");
    });

    it("includes fly deploy", () => {
      expect(DEPLOY_PROMPT).toContain("fly deploy");
    });

    it("includes fly certs add", () => {
      expect(DEPLOY_PROMPT).toContain("fly certs add");
    });
  });

  describe("Render path", () => {
    it("includes Render deploy path", () => {
      expect(DEPLOY_PROMPT).toContain("Deploy to Render");
    });

    it("includes render.yaml", () => {
      expect(DEPLOY_PROMPT).toContain("render.yaml");
    });

    it("includes Blueprint", () => {
      expect(DEPLOY_PROMPT).toContain("Blueprint");
    });

    it("includes Environment Groups", () => {
      expect(DEPLOY_PROMPT).toContain("Environment Groups");
    });

    it("includes Private Services", () => {
      expect(DEPLOY_PROMPT).toContain("Private services");
    });

    it("includes auto-deploy from GitHub", () => {
      expect(DEPLOY_PROMPT).toMatch(/[Aa]uto-[Dd]eploy/);
    });

    it("includes health check configuration", () => {
      expect(DEPLOY_PROMPT).toMatch(/[Hh]ealth [Cc]heck/);
    });
  });

  // ─── Universal checks after every deploy path ────────────────────────────

  describe("Universal checks", () => {
    it("includes universal checks section", () => {
      expect(DEPLOY_PROMPT).toContain("Universal Checks");
    });

    it("checks /health returns 200", () => {
      expect(DEPLOY_PROMPT).toContain("/health");
      expect(DEPLOY_PROMPT).toContain("200");
    });

    it("checks sensitive paths blocked", () => {
      expect(DEPLOY_PROMPT).toContain("/.env");
      expect(DEPLOY_PROMPT).toContain("/.git");
    });

    it("checks HTTPS enforced", () => {
      expect(DEPLOY_PROMPT).toContain("HTTPS");
    });

    it("checks security headers", () => {
      expect(DEPLOY_PROMPT).toContain("HSTS");
      expect(DEPLOY_PROMPT).toContain("X-Frame-Options");
      expect(DEPLOY_PROMPT).toContain("X-Content-Type-Options");
    });

    it("checks auth flow", () => {
      expect(DEPLOY_PROMPT).toMatch(/[Aa]uth.*end-to-end/);
    });

    it("checks error tracking (Sentry)", () => {
      expect(DEPLOY_PROMPT).toContain("Sentry");
    });

    it("checks monitoring", () => {
      expect(DEPLOY_PROMPT).toContain("Monitoring");
    });

    it("checks backup mechanism", () => {
      expect(DEPLOY_PROMPT).toContain("Backup");
    });
  });

  // ─── SSL verification gate ────────────────────────────────────────────────

  describe("SSL verification gate", () => {
    it("includes a2p_verify_ssl in Hetzner flow", () => {
      expect(DEPLOY_PROMPT).toContain("a2p_verify_ssl");
    });

    it("includes SSL verification as mandatory gate", () => {
      expect(DEPLOY_PROMPT).toContain("SSL Verification — MANDATORY GATE");
    });

    it("includes auto-renewal note for Caddy", () => {
      expect(DEPLOY_PROMPT).toContain("Caddy renews Let's Encrypt certificates automatically");
    });

    it("includes SSL gate in universal checks", () => {
      expect(DEPLOY_PROMPT).toContain("SSL certificate auto-renewal confirmed");
    });

    it("each PaaS path mentions SSL gate", () => {
      // All PaaS paths should mention a2p_verify_ssl
      const paths = ["Vercel", "Cloudflare", "Railway", "Fly.io", "Render"];
      for (const path of paths) {
        const idx = DEPLOY_PROMPT.indexOf(`Deploy to ${path}`);
        if (idx === -1) continue;
        const section = DEPLOY_PROMPT.substring(idx, idx + 1000);
        expect(section).toContain("a2p_verify_ssl");
      }
    });
  });

  // ─── Each deploy path has required sections ──────────────────────────────

  describe("Each deploy path has env var handling", () => {
    it("Docker VPS has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Deploy to Vercel")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });

    it("Vercel has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Vercel"),
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });

    it("Cloudflare has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare"),
        DEPLOY_PROMPT.indexOf("Deploy to Railway")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });

    it("Railway has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Railway"),
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });

    it("Fly.io has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io"),
        DEPLOY_PROMPT.indexOf("Deploy to Render")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });

    it("Render has env var handling", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Render"),
        DEPLOY_PROMPT.indexOf("Universal Checks")
      );
      expect(section).toMatch(/[Ee]nv var/);
    });
  });

  describe("Each deploy path has smoke checks", () => {
    it("Docker VPS has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Deploy to Vercel")
      );
      expect(section).toMatch(/[Ss]moke/);
    });

    it("Vercel has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Vercel"),
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare")
      );
      expect(section).toMatch(/[Ss]moke/);
    });

    it("Cloudflare has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare"),
        DEPLOY_PROMPT.indexOf("Deploy to Railway")
      );
      expect(section).toMatch(/[Ss]moke/);
    });

    it("Railway has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Railway"),
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io")
      );
      expect(section).toMatch(/[Ss]moke/);
    });

    it("Fly.io has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io"),
        DEPLOY_PROMPT.indexOf("Deploy to Render")
      );
      expect(section).toMatch(/[Ss]moke/);
    });

    it("Render has smoke checks", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Render"),
        DEPLOY_PROMPT.indexOf("Universal Checks")
      );
      expect(section).toMatch(/[Ss]moke/);
    });
  });

  describe("Each deploy path has domain checklist", () => {
    it("Docker VPS has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Deploy to Vercel")
      );
      expect(section).toMatch(/[Dd]omain/);
    });

    it("Vercel has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Vercel"),
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare")
      );
      expect(section).toMatch(/[Dd]omain/);
    });

    it("Cloudflare has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare"),
        DEPLOY_PROMPT.indexOf("Deploy to Railway")
      );
      expect(section).toMatch(/[Dd]omain/);
    });

    it("Railway has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Railway"),
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io")
      );
      expect(section).toMatch(/[Dd]omain/);
    });

    it("Fly.io has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io"),
        DEPLOY_PROMPT.indexOf("Deploy to Render")
      );
      expect(section).toMatch(/[Dd]omain/);
    });

    it("Render has domain checklist", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Render"),
        DEPLOY_PROMPT.indexOf("Universal Checks")
      );
      expect(section).toMatch(/[Dd]omain/);
    });
  });

  describe("Each deploy path has hardening", () => {
    it("Docker VPS has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Docker VPS"),
        DEPLOY_PROMPT.indexOf("Deploy to Vercel")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });

    it("Vercel has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Vercel"),
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });

    it("Cloudflare has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Cloudflare"),
        DEPLOY_PROMPT.indexOf("Deploy to Railway")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });

    it("Railway has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Railway"),
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });

    it("Fly.io has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Fly.io"),
        DEPLOY_PROMPT.indexOf("Deploy to Render")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });

    it("Render has hardening", () => {
      const section = DEPLOY_PROMPT.substring(
        DEPLOY_PROMPT.indexOf("Deploy to Render"),
        DEPLOY_PROMPT.indexOf("Universal Checks")
      );
      expect(section).toMatch(/[Hh]ardening/);
    });
  });
});
