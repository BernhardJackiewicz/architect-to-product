# A2P — Architect-to-Product

MCP server that turns AI-generated code into production-ready software with TDD, security scanning, and deployment automation. Up to 100 times fewer exploration tokens for claude code.

**18 MCP tools** · **666 tests** · **Architecture → Plan → Build → Audit → Security → Whitebox → Deploy**

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 658 passing](https://img.shields.io/badge/tests-666%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()

---

Vibe coding with Claude Code, Cursor, or any AI coding assistant generates code fast — but ships it without tests, with security holes, and with no deployment story. You spend more time fixing what the AI wrote than you saved.

- AI-generated code frequently introduces security vulnerabilities — and coding agents will delete validation, disable auth, or relax database policies just to make errors go away
- "It works on my machine" turns into a 3am production incident

**Architect-to-Product** is an MCP server that turns AI-generated code into production-ready software. It adds TDD, static code analysis, and deployment automation to AI coding workflows.

AI-driven test driven development (AI TDD) ensures every feature works. Built-in SAST tools (Semgrep for all languages, Bandit for Python) run static code analysis and OWASP Top 10 reviews before deploy. Stack-specific deployment configs mean you ship on day one, not day thirty.

## Quick Start

```bash
npm install -g architect-to-product
claude mcp add architect-to-product -- npx architect-to-product
```

Then restart Claude Code and type: **`/a2p`**

The onboarding will co-develop your architecture, auto-configure companion MCP servers, and install SAST tools. One restart, then you're building.

## What A2P Actually Does

A2P is an MCP server that orchestrates an AI engineering workflow. Instead of vibe coding features, A2P builds software in vertical slices with TDD and security gates.

It coordinates:
- **Up to 100x fewer exploration tokens** — codebase-memory-mcp builds a code graph instead of scanning files raw
- **Test-driven development** — every feature has tests before implementation
- **Static code analysis** — Semgrep + Bandit scan for vulnerabilities automatically
- **Whitebox security audit** — verifies whether SAST findings are actually exploitable (reachable paths, guards, trust boundaries)
- **Active verification** — runtime gate tests that prove workflow invariants hold (state transitions, deployment gates, recovery)
- **Code audits** — Quality audits during development, release audits before publish (TODOs, debug artifacts, secrets, .gitignore, test coverage, README)
- **Security reviews** — OWASP Top 10 review before deploy
- **Structured build log** — every tool run tracked with log levels, duration, status, run correlation, and automatic secret redaction. Composable filters by phase, slice, level, time range, or errors
- **Configurable human oversight** — mandatory build signoff and deploy approval, optional plan approval, slice review, and security signoff
- **Deployment generation** — stack-specific Dockerfile, docker-compose, Caddyfile, backup scripts

A2P is not a replacement for engineers. It is an engineering safety net for AI-generated code.

## Without vs. With architect-to-product

| Without a2p | With a2p |
|---|---|
| Vibe code a feature | Architecture-driven vertical slices |
| Manually write some tests (maybe) | TDD per slice: RED → GREEN → REFACTOR |
| Miss security vulnerabilities | Automated SAST + OWASP Top 10 review + whitebox exploitability analysis |
| SAST reports 50 findings, most are noise | Whitebox audit confirms which findings are actually exploitable |
| Ship with TODOs, console.logs, .env in repo | Quality + release audits catch hygiene issues, block deploy on critical findings |
| AI runs without stopping | Mandatory build signoff + deploy approval, configurable oversight at every phase |
| AI hallucinates API signatures for unfamiliar libraries | Documentation-first: reads official docs via WebSearch + WebFetch before writing code |
| Copy-paste a Dockerfile from StackOverflow | Generated Dockerfile + docker-compose + Caddyfile + backup scripts |
| No build history, no idea what failed when | Structured build log with levels, duration, run correlation, and secret redaction |
| Hope for the best | Ship to production with confidence |

## Key Benefits

- **100x fewer tokens** — Code graph intelligence via codebase-memory-mcp replaces raw file scanning — saves context window and money
- **Develop faster** — Vertical slices with TDD, no yak shaving
- **Fewer bugs** — AI-driven test driven development (TDD): every feature has tests before implementation (RED → GREEN → REFACTOR)
- **Ship secure** — Static code analysis (Semgrep + Bandit) + OWASP Top 10 review + whitebox exploitability analysis built into the AI coding workflow
- **Whitebox audit** — SAST finds patterns, whitebox proves exploitability: reachable code paths, missing guards, prompt-only enforcement. Blocking findings prevent deployment (enforced in code)
- **Active verification** — Runtime gate tests prove that workflow invariants actually hold: state transitions require evidence, deployment gates block on critical findings, state survives round-trips
- **Human oversight** — Mandatory build signoff (before wasting tokens on audit/security) and deploy approval. Configurable plan approval, slice review, and security signoff. Two gates are always on, the rest you control
- **Audit before release** — Quality audits catch debug artifacts, hardcoded secrets, and test coverage gaps during development. Release audits verify README, .gitignore, temp files, and aggregate findings before publish. Critical release findings block deployment (enforced in code)
- **Deploy on day one** — Stack-specific Dockerfile, docker-compose, Caddyfile, backup scripts
- **Code quality** — Built-in code quality tool: dead code detection, redundancy analysis, coupling metrics
- **Documentation first** — When the architecture uses unfamiliar tech (exotic auth, new ORMs, niche APIs), Claude reads the official docs via WebSearch + WebFetch instead of hallucinating API signatures. Enforced in every prompt, documented in CLAUDE.md
- **Model preference** — Configure which Claude model does the programming (`opus`, `sonnet`, `haiku`). Default: opus (Claude Opus 4.6 with maximum effort). Stored in project config, referenced by all prompts
- **Structured logging** — Build events with log levels, status, duration tracking, run correlation, secret redaction, and output previews. Filter build logs by level, run, phase, or errors
- **Any stack** — Python, TypeScript, Go, Rust, Java, Ruby, PHP, C#, PostgreSQL, MySQL, MongoDB, Redis

## Human Oversight

A2P gives you granular control over where the AI pauses for human review. Two gates are always on (non-negotiable), the rest you configure during onboarding.

### Oversight Configuration

Set during onboarding via `a2p_set_architecture`:

```json
{
  "oversight": {
    "sliceReview": "off",
    "planApproval": true,
    "buildSignoff": true,
    "deployApproval": true,
    "securitySignoff": false
  }
}
```

| Setting | Default | Mandatory? | What it does |
|---------|---------|------------|-------------|
| `buildSignoff` | `true` | **Yes, always on** | After all slices are built: "Does the product work?" — prevents wasting tokens on audit/security for broken code |
| `deployApproval` | `true` | **Yes, always on** | Before deployment: explicit go/no-go with finding summary |
| `planApproval` | `true` | No | Must approve slice plan before building starts |
| `sliceReview` | `"off"` | No | `"off"` = auto-proceed, `"ui-only"` = pause after UI slices, `"all"` = pause after every slice |
| `securitySignoff` | `false` | No | Explicit go/no-go after security gate (in addition to code-enforced gates) |

### Always-On Gates (Code-Enforced)

These cannot be bypassed — they are enforced in code, not just in prompts:

- **Build gate**: Cannot leave building phase until all slices are `done`
- **Evidence gates**: Cannot mark slice as `green` without passing tests, `sast` without SAST scan, `done` without passing tests
- **Security gate**: Cannot deploy with open CRITICAL/HIGH SAST findings
- **Whitebox gate**: Cannot deploy with blocking whitebox findings (confirmed exploitable auth/secrets/tenant issues)
- **Audit gate**: Cannot deploy with critical release audit findings

### Model Preference

Configure which Claude model does the programming via `claudeModel` in `a2p_set_architecture`:

| Model | Best for | Trade-off |
|-------|----------|-----------|
| **`opus`** (default) | Production code, complex architectures | Maximum quality, slower, most expensive |
| `sonnet` | Standard features, good-enough code | Fast, cheaper, less deep analysis |
| `haiku` | Simple tasks, scaffolding | Fastest, cheapest, basic quality |

Stored in `.a2p/state.json` → `config.claudeModel`. Referenced in CLAUDE.md and all prompts.

### Documentation-First Principle

When the architecture uses unfamiliar technologies (exotic auth, new ORMs, niche APIs), Claude is instructed to:
1. **WebSearch** for the official documentation URL
2. **WebFetch** to read the relevant docs (Getting Started, API Reference, Configuration)
3. Document the source URL as a comment in the code
4. **Never** hallucinate API signatures, config options, or behavior

This rule is enforced in the shared Engineering Loop (all prompts), the build-slice prompt (detailed section), the security-gate prompt, and the generated CLAUDE.md.

### Recommended Configurations

**Solo developer (default):** Plan approval on, everything else off. Build signoff and deploy approval are always on. Model: opus.

**Team / enterprise:** All oversight on — every phase gets human review. Model: opus.

**Rapid prototyping:** Plan approval off, slice review off. You still get mandatory build signoff and deploy approval. Model: sonnet for speed.

## How it works

The full AI workflow automation pipeline:

```
AI Assistant
     │
     ▼
Architecture + Oversight Config
     │
     ▼
Planning (vertical slices) ─── [planApproval? → STOP]
     │
     ▼
Build (TDD loop per slice) ─── [sliceReview? → STOP after each slice]
     │  ← Quality Audit (every ~5-10 commits)
     ▼
BUILD SIGNOFF [MANDATORY] ─── "Does the product actually work?"
     │
     ▼
Security Gate (SAST + OWASP) ─── [securitySignoff? → STOP]
     │
     ▼
Whitebox Audit (exploitability analysis)
     │
     ▼
Active Verification (runtime gate tests)
     │
     ▼
Release Audit (pre-publish checks)
     │
     ▼
DEPLOY APPROVAL [MANDATORY] ─── "Ready to ship?"
     │
     ▼
Deployment
```

For multi-phase projects (e.g. Phase 0: Spikes, Phase 1: MVP, Phase 2: Scale), this loop repeats per phase automatically.

```
Phase 0: Plan → Build → BUILD SIGNOFF → Security → Whitebox → Release Audit → DEPLOY APPROVAL → Deploy → complete_phase
Phase 1: Plan → Build → BUILD SIGNOFF → Security → Whitebox → Release Audit → DEPLOY APPROVAL → Deploy → complete_phase
...
```

1. **Onboarding**: Capture or co-develop the AI software architecture. Detect database and frontend tech. Describe UI via text, upload wireframes/mockups/screenshots, or let AI generate a design concept. Set up companion MCP servers via the MCP protocol. If the architecture defines phases, they get extracted automatically.
2. **Planning**: Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria. Three slice types: `feature` (default), `integration` (library/API adapters with TDD), `infrastructure` (CI, auth, monitoring).
3. **Build Loop**: TDD per slice: RED (write failing tests) → GREEN (minimal implementation) → REFACTOR (clean up) → SAST (lightweight AI security testing). Frontend slices with `hasUI: true` get visual verification via Playwright between GREEN and REFACTOR. Configurable review checkpoints (`oversight.sliceReview`: `off`, `all`, `ui-only`) pause after slices for human approval. Domain logic triggers a WebSearch step before tests to verify facts (tax rates, regulations, standards). Quality audits run every ~5-10 commits to catch TODOs, debug artifacts, hardcoded secrets, and test coverage gaps. **Mandatory build signoff** after all slices are done — you verify the product works before spending tokens on audit and security. **Structured build log** tracks every tool run with log levels, duration, status, run correlation, and secret redaction — queryable by phase, slice, level, time range, or errors.
4. **Security Gate**: Full SAST scan (static code analysis via Semgrep + Bandit), OWASP Top 10 manual review, dependency audit. Acts as an AI code review tool and AI code scanner for your entire codebase. Fix all critical/high findings.
5. **Whitebox Audit**: Analyzes whether SAST findings are actually exploitable — checks reachable code paths, missing guards, trust boundaries, prompt-only enforcement. Blocking findings prevent deployment (enforced in code, not just prompts).
6. **Active Verification**: Runtime gate tests that prove workflow invariants hold — state transitions require evidence, deployment gates block correctly, state survives round-trips.
7. **Release Audit**: Pre-publish verification — README completeness, temp file cleanup, aggregated SAST/quality findings, build/test pass, .gitignore coverage. Critical findings in the release audit block deployment (enforced in code).
8. **Deployment**: **Mandatory deploy approval** before generating configs. Stack-specific Dockerfile, docker-compose, Caddyfile, backup scripts, hardening guides. Stack-specific launch checklist.

## Client Configuration

Works with Claude Code, Cursor AI, and any MCP-compatible AI coding assistant:

### Claude Code (CLI)

```bash
claude mcp add architect-to-product -- npx architect-to-product
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

### Cursor AI

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

## MCP Tools (18)

| Tool | Phase | Description |
|------|-------|-------------|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, extract phases, configure oversight, capture UI design |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture → ordered vertical slices (supports `append` for multi-phase) |
| `a2p_add_slice` | 1,2 | Insert a single slice mid-project (e.g. integration discovered during build) |
| `a2p_complete_phase` | 7 | Complete current product phase, advance to next |
| `a2p_get_state` | * | Read current project state (includes phase info) |
| `a2p_update_slice` | 2 | Update slice status with review checkpoints and slice summaries |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go) |
| `a2p_run_quality` | 2.5 | Code quality analysis — dead code, redundancy, coupling metrics |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Static code analysis with Semgrep/Bandit, deduplicated findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_run_audit` | 2,6 | Quality audit (dev hygiene) or release audit (pre-publish). Critical release findings block deployment |
| `a2p_run_whitebox_audit` | 4 | Whitebox security audit — exploitability analysis of SAST findings (reachable paths, guards, trust boundaries). Blocking findings prevent deployment |
| `a2p_run_active_verification` | 5 | Active verification — runtime gate tests (workflow gates, state recovery, deployment gates) |
| `a2p_generate_deployment` | 7 | Stack-specific deployment guidance |
| `a2p_get_checklist` | 7 | Pre/post-deployment verification checklist |

## Prompts (9)

MCP prompts are invoked with `/` in Claude Code:

| Command | What it does |
|---------|-------------|
| `/a2p` | Start onboarding — define architecture, UI design, tech stack, oversight config, companions |
| `/a2p_planning` | Break architecture into ordered vertical slices |
| `/a2p_build_slice` | Build the current slice with TDD (RED → GREEN → REFACTOR → SAST) + mandatory build signoff |
| `/a2p_refactor` | Code quality tool — analyze codebase for dead code, redundancy, coupling |
| `/a2p_e2e_testing` | AI testing tool — run visual E2E tests with Playwright |
| `/a2p_security_gate` | Full SAST scan + OWASP Top 10 review |
| `/a2p_whitebox` | Whitebox security audit + active verification — exploitability analysis + runtime gate tests |
| `/a2p_audit` | Quality audit (dev hygiene every ~5-10 commits) or release audit (pre-publish verification) |
| `/a2p_deploy` | Generate deployment configs and launch checklist + mandatory deploy approval |

### When to use which prompt

You don't have to run the full pipeline. Each prompt works standalone — pick what you need:

**Full project from scratch:**
`/a2p` → `/a2p_planning` → `/a2p_build_slice` (repeat per slice) → `/a2p_audit` (quality) → `/a2p_security_gate` → `/a2p_whitebox` → `/a2p_audit` (release) → `/a2p_deploy`

**MVP built with vibe coding, now make it production-ready:**
- `/a2p_security_gate` — find the vulnerabilities that vibe coding missed
- `/a2p_whitebox` — verify which findings are actually exploitable vs. noise
- `/a2p_refactor` — clean up the spaghetti, remove dead code
- `/a2p_deploy` — generate Dockerfile, docker-compose, Caddyfile instead of guessing

**SAST reports too many findings, need to triage:**
- `/a2p_whitebox` — whitebox audit confirms exploitability, active verification tests that gates hold

**Added features without tests, need confidence before shipping:**
- `/a2p_audit` — catch TODOs, debug artifacts, hardcoded secrets, missing .gitignore entries, low test coverage
- `/a2p_refactor` — identify dead code and coupling from the feature sprawl
- `/a2p_e2e_testing` — visually verify nothing is broken
- `/a2p_security_gate` — catch injection, auth holes, hardcoded secrets

**Existing project, just need deployment:**
- `/a2p_deploy` — stack-specific configs, backup scripts, hardening guide

**Built the MVP with slices, now entering Phase 2:**
- `/a2p_planning` — create new slices for the next phase
- `/a2p_build_slice` — TDD per slice as usual

## Supported Stacks

| Category | Technologies |
|----------|-------------|
| **Languages** | Python, TypeScript/Node.js, Go, Rust, Java/Kotlin, Ruby, PHP, C#/.NET |
| **Databases** | SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis |
| **Hosting** | Hetzner, DigitalOcean, AWS, Fly.io, Railway, Vercel, Cloudflare, Render, any VPS |

## Supported Deploy Targets

| Target | Method | What gets generated |
|--------|--------|-------------------|
| **Docker VPS** (Hetzner, DigitalOcean, any VPS) | Dockerfile + docker-compose + Caddy | Dockerfile, docker-compose.prod.yml, Caddyfile, backup.sh, DEPLOYMENT.md |
| **Vercel** | Vercel CLI | vercel.json, Edge Middleware, env var setup |
| **Cloudflare** (Pages/Workers) | Wrangler CLI / MCP | wrangler.toml, Page Rules, DNS config |
| **Railway** | Railway CLI | railway.toml / Procfile, service config |
| **Fly.io** | Fly CLI | fly.toml, secrets, volumes |
| **Render** | Blueprint | render.yaml, health checks, auto-deploy |

Each deploy path includes: env var handling, basic hardening, smoke checks, and domain checklist.

## Companion MCP Servers

a2p auto-configures companion MCP servers based on your tech stack. Each companion is integration-tested against its real server to verify tool availability. These MCP tools extend your AI development tool with specialized capabilities.

### Core (always installed)

| Companion | What it adds | Verified Tools |
|-----------|-------------|----------------|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Code graph intelligence — up to 100x fewer exploration tokens vs. raw file scanning | 11 tools: `index_repository`, `search_graph`, `search_code`, `trace_call_path`, ... |
| [mcp-server-git](https://github.com/modelcontextprotocol/servers) | Git history, commits, diffs | 12 tools: `git_log`, `git_diff`, `git_commit`, `git_status`, ... |
| [@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers) | File operations | 14 tools: `write_file`, `list_directory`, `read_file`, `search_files`, ... |
| [@modelcontextprotocol/server-sequential-thinking](https://github.com/modelcontextprotocol/servers) | Step-by-step reasoning for complex decisions | 1 tool: `sequentialthinking` |

### Conditional (installed based on stack)

| Companion | When | Verified Tools |
|-----------|------|----------------|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Frontend projects | 22 tools: `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`, `browser_resize`, ... |
| [GitHub MCP](https://github.com/github/github-mcp-server) | GitHub repos | 41 tools: `list_issues`, `create_pull_request`, `search_code`, `get_file_contents`, ... |
| [Supabase MCP](https://github.com/supabase-community/supabase-mcp) | Supabase projects | 29 tools: `execute_sql`, `list_tables`, `apply_migration`, `deploy_edge_function`, ... |
| [@stripe/mcp](https://github.com/stripe/agent-toolkit) | Payment/billing | 28 tools: `create_product`, `create_price`, `create_payment_link`, `create_customer`, ... |
| [@cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | Cloudflare hosting | 85 tools: `worker_deploy`, `kv_put`, `d1_query`, `r2_put_object`, `zones_list`, `secret_put`, ... |
| [@sentry/mcp-server](https://github.com/getsentry/sentry-mcp-server) | Error tracking | 22 tools: `list_issues`, `get_issue_details`, `find_projects`, `analyze_issue_with_seer`, ... |
| [@upstash/mcp-server](https://github.com/upstash/mcp-server) | Serverless Redis/Queue | 26 tools: `redis_database_run_redis_commands`, `qstash_publish_message`, `workflow_logs_list`, ... |
| [Semgrep MCP](https://semgrep.dev/) | Semgrep Pro users | `semgrep_scan`, `security_check`, `get_abstract_syntax_tree` (OSS uses CLI fallback) |
| [Atlassian MCP](https://developer.atlassian.com/) | Jira/Confluence | Remote MCP via OAuth |

### Database MCPs

| Companion | When |
|-----------|------|
| [@modelcontextprotocol/server-postgres](https://github.com/modelcontextprotocol/servers) | PostgreSQL |
| [@mongodb-js/mongodb-mcp-server](https://github.com/mongodb-js/mongodb-mcp-server) | MongoDB |
| [mcp-server-mysql](https://github.com/benborla/mcp-server-mysql) | MySQL/MariaDB |

### CLI-only (no MCP server, uses CLI commands)

| Tool | When |
|------|------|
| Vercel CLI (`vercel`) | Vercel / Next.js hosting |
| Clerk | Auth integration |
| Resend | Email integration |

> **Security note:** Companion MCPs are third-party software with access to your project files and databases. Before enabling a companion: check the source repo (author, stars, open issues), review the `.mcp.json` that gets generated, and confirm you trust the server. Official packages (`@modelcontextprotocol/*`, `@playwright/mcp`, `mcp.supabase.com`) are maintained by their respective organizations. Community packages are not audited by us — use at your own discretion.

## How is this different?

- **vs. AI coding assistants alone (Claude Code, Cursor AI, Copilot)** — They generate code. a2p adds the TDD, security scanning, and deployment that AI coding assistants skip.
- **vs. create-\*-app scaffolders** — Static templates vs. dynamic architecture-driven AI app builder with TDD and security gates.
- **vs. manual deployment setup** — Weeks of DevOps vs. generated configs on day one.
- **vs. vibe coding without a2p** — You ship fast but accumulate security debt, untested features, and manual deployment. a2p is the safety net that makes vibe coding production-viable.

Works alongside autonomous AI agents — a2p adds the engineering rigor (TDD, SAST, deployment) that autonomous AI coding needs.

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 666 tests
npm run build       # Build
npm run dev         # Dev mode
```

## License

MIT
