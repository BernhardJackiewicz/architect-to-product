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
