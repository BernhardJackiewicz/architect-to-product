# Phase D & E Results: Deploy Targets and Tool Count Claims

Date: 2026-03-14

---

## Phase D: Deploy Target Reality Check

### Key Finding: A2P Does NOT Generate Deployment Files

The `generate-deployment.ts` function returns a JSON object with a `filesToGenerate` array containing **description strings**, not actual file content. For example:

```
"Dockerfile (multi-stage, non-root user)"
"docker-compose.prod.yml (app + reverse proxy, named volumes, log rotation, security_opt)"
```

The `hint` field confirms this explicitly:
> "Generate these files dynamically based on the tech stack. Do NOT use templates -- adapt to the specific project."

**Architecture**: A2P acts as a guidance layer. It tells Claude Code WHAT to generate; Claude generates the actual files. A2P provides:
- A list of file descriptions to create
- Security hardening bullet points (text recommendations)
- Stack-specific recommendations (text strings)
- Backup commands (shell command strings, not scripts)
- Checklist items (JSON with done/not-done flags)

### Deploy Target Classification

| Target | What A2P provides | What is guidance-only | What requires credentials | What is truly end-to-end testable |
|--------|------------------|----------------------|--------------------------|----------------------------------|
| **Hetzner/Docker VPS** | File descriptions for Dockerfile, docker-compose.prod.yml, Caddyfile, backup scripts, .env.production.example, DEPLOYMENT.md. Checklist items for VPS hardening (SSH, UFW, fail2ban, unattended-upgrades, swap, logrotate). Pricing info ("CX23, 2 vCPU, 4GB, 3.49EUR/mo"). | All security hardening steps are text bullets. Docker best practices are recommendations. Backup commands are template strings with `$VARIABLES`. | VPS SSH access, DNS configuration, Hetzner account for automated backups. | File description generation (the JSON output). Checklist JSON structure. Recommendation logic per tech stack. No actual Dockerfile content is testable -- that comes from Claude. |
| **Vercel** | Recommendation text: "frontend/serverless only, no Docker needed, use Edge Functions" and "Backend API needs separate hosting". Checklist: project linked, env vars set, preview deployment tested. | Everything. A2P generates zero Vercel-specific files. The README claims "vercel.json, Edge Middleware, env var setup" but `generate-deployment.ts` does NOT list vercel.json in `filesToGenerate`. | Vercel account + CLI auth. | Only the recommendation string generation logic. |
| **Railway** | Recommendation text: "railway up with auto-detection, managed DB add-ons". Checklist: services configured, env vars set, custom domain. | Everything. No railway.toml or Procfile in `filesToGenerate`. The README claims "railway.toml / Procfile, service config" but the code doesn't generate these descriptions. | Railway account + CLI auth. | Only the recommendation string generation logic. |
| **Cloudflare** | Recommendation text: "Pages for static/SSR, Workers for API, no Docker needed", "wrangler.toml for bindings". Checklist: NS records, SSL Full Strict, WAF rules. | Everything. No wrangler.toml in `filesToGenerate`. The README claims "wrangler.toml, Page Rules, DNS config" but the code doesn't list these. | Cloudflare account + Wrangler auth. | Only the recommendation string generation logic. |
| **Fly.io** | Recommendation text: "Configure fly.toml, deploy with fly deploy, use Volumes". Checklist: app created, secrets set, TLS cert added. | Everything. No fly.toml in `filesToGenerate`. The README claims "fly.toml, secrets, volumes" but the code doesn't generate these file descriptions. | Fly.io account + CLI auth. | Only the recommendation string generation logic. |
| **Render** | Recommendation text: "render.yaml Blueprint for declarative infrastructure", "Private Services for internal backends". Checklist: Blueprint deployed, health check URL, auto-deploy. | Everything. No render.yaml in `filesToGenerate`. The README claims "render.yaml, health checks, auto-deploy" but the code doesn't generate these file descriptions. | Render account. | Only the recommendation string generation logic. |
| **AWS** | Recommendation text: "EC2 t3.micro or ECS Fargate", "Use RDS for managed database, S3 for backups". No specific checklist items. | Everything. No AWS-specific files mentioned. | AWS account + credentials. | Only the recommendation string generation logic. |
| **DigitalOcean** | Recommendation text: "Droplet 2GB from $12/mo", "Use Spaces for backups". No specific checklist items. | Everything. No DO-specific files mentioned. | DigitalOcean account + API token. | Only the recommendation string generation logic. |

### Critical Gap: README vs. Code Mismatch

The README (lines 393-398) claims specific output files per target:

| Target | README claims these files | Code actually lists |
|--------|--------------------------|-------------------|
| Docker VPS | Dockerfile, docker-compose.prod.yml, Caddyfile, backup scripts, BACKUP.md, DEPLOYMENT.md | YES -- these are in `filesToGenerate` (but as description strings, not content) |
| Vercel | vercel.json, Edge Middleware, env var setup | NO -- not in `filesToGenerate` |
| Cloudflare | wrangler.toml, Page Rules, DNS config | NO -- not in `filesToGenerate` |
| Railway | railway.toml / Procfile, service config | NO -- not in `filesToGenerate` |
| Fly.io | fly.toml, secrets, volumes | NO -- not in `filesToGenerate` |
| Render | render.yaml, health checks, auto-deploy | NO -- not in `filesToGenerate` |

**Only Docker VPS targets get file descriptions in `filesToGenerate`.** All other targets get text recommendations in the `recommendations` array and checklist items in `get-checklist.ts`, but no file generation guidance.

The `filesToGenerate` array is always the same Docker-oriented set (Dockerfile, docker-compose, Caddyfile, backup scripts, docs). For non-Docker targets like Vercel, Cloudflare, Railway, Fly.io, and Render, the code STILL returns Docker-oriented file descriptions -- which is incorrect for those platforms.

### Summary

A2P's deployment support is a two-tier system:
1. **Docker VPS (Hetzner, DigitalOcean, generic VPS)**: Well-supported with file descriptions, security hardening checklist, and stack-specific recommendations. But still guidance-only -- Claude generates the actual content.
2. **PaaS targets (Vercel, Railway, Cloudflare, Fly.io, Render, AWS)**: Only text recommendations and checklist items. The README's claims of specific output files (vercel.json, fly.toml, render.yaml, etc.) are not backed by code. These targets will still receive Docker file descriptions, which is misleading.

---

## Phase E: Companion Tool Count Claims

### Methodology

Each package was checked via `npm view <package> readme` to extract tool lists. Tool counts were verified by counting tool entries in the readme or, where not available, marked as unverifiable.

### Results

| # | Package | README Claim | Verified Count | Status | Notes |
|---|---------|-------------|---------------|--------|-------|
| 1 | codebase-memory-mcp | 11 tools | **11** | VERIFIED (exact) | Counted from tools available in this session |
| 2 | mcp-server-git | 12 tools | UNVERIFIABLE | UNVERIFIABLE | Package not found on npm under `@anthropic-ai/git-mcp-server` or `@modelcontextprotocol/server-git`. It's a Python package (`mcp-server-git` on PyPI) -- npm readme unavailable. |
| 3 | @modelcontextprotocol/server-filesystem | 14 tools | **13** | INACCURATE | npm readme lists 13 tools: read_text_file, read_media_file, read_multiple_files, write_file, edit_file, create_directory, list_directory, list_directory_with_sizes, move_file, search_files, directory_tree, get_file_info, list_allowed_directories. The `get_file_info` and `list_allowed_directories` tools appear in the full readme but not in the grep count. Recounting carefully: 13 bold-formatted tool entries. Claim of 14 is off by 1. |
| 4 | @modelcontextprotocol/server-sequential-thinking | 1 tool | **1** | VERIFIED (exact) | Single tool: `sequential_thinking` |
| 5 | @playwright/mcp | 22 tools | UNVERIFIABLE | UNVERIFIABLE | Package exists (v0.0.68) but npm readme returned empty. GitHub source would need to be checked. |
| 6 | GitHub MCP (github-mcp-server) | 41 tools | **26** (deprecated version) | LIKELY INACCURATE | The `@modelcontextprotocol/server-github` npm readme lists 26 tools. The package is deprecated in favor of `github/github-mcp-server` (Go binary, not on npm). The new version may have 41 tools, but this is unverifiable via npm. |
| 7 | @stripe/mcp | 28 tools | UNVERIFIABLE | UNVERIFIABLE | npm readme says "See the Stripe MCP documentation for a list of tools" -- no tool list in the readme itself. Tool count depends on API key permissions. |
| 8 | @cloudflare/mcp-server-cloudflare | 85 tools | **61** | INACCURATE | npm readme lists 61 named tools across all categories (KV: 5, R2: 7, D1: 4, Workers: 4, Durable Objects: 6, Queues: 7, Workers AI: 4, Workflows: 5, Templates: 3, W4P: 5, Service Bindings: 4, URL Routing: 4, Cron Triggers: 4, Zones: 5, Secrets: 3, Versions: 3, Wrangler: 2, Analytics: 1). Claim of 85 overstates by ~39%. |
| 9 | @sentry/mcp-server | 22 tools | UNVERIFIABLE | UNVERIFIABLE | Package exists (v0.29.0) but no readme available on npm (`ERROR: No README data found!`). |
| 10 | @upstash/mcp-server | 26 tools | UNVERIFIABLE | UNVERIFIABLE | Package exists (v0.2.1) but npm readme returned empty. |

### Tool Count Summary

| Status | Count |
|--------|-------|
| VERIFIED (exact match) | 2 (codebase-memory-mcp, sequential-thinking) |
| INACCURATE (verifiable mismatch) | 2 (filesystem: 13 not 14, cloudflare: 61 not 85) |
| LIKELY INACCURATE | 1 (GitHub: 26 in deprecated npm version, claim is 41 for new Go version) |
| UNVERIFIABLE | 5 (git, playwright, stripe, sentry, upstash) |

### Key Observations

1. **Cloudflare claim is significantly inflated**: 85 claimed vs 61 documented. This is the largest discrepancy -- overstated by 39%.
2. **Filesystem off by one**: 14 claimed vs 13 documented. Minor but still inaccurate.
3. **GitHub count may be for a different version**: The npm package (26 tools) is deprecated. The claim of 41 likely refers to the newer Go-based `github/github-mcp-server`, which is not npm-verifiable.
4. **Stripe tools are dynamic**: Tool availability depends on API key permissions, making any fixed count potentially misleading.
5. **5 of 10 packages** could not have their tool counts verified via npm readme alone, indicating the claims may be hard for users to independently verify.
