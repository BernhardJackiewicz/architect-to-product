# A2P — Architect-to-Product

MCP server that turns AI-generated code into production-ready software with TDD, security scanning, and deployment automation.

15 MCP tools that add test driven development, static code analysis, and deployment automation to your AI coding workflow. From architecture to `docker-compose up` in one pipeline. 527 tests.

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 527 passing](https://img.shields.io/badge/tests-527%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()

---

Vibe coding with Claude Code, Cursor, or any AI coding assistant generates code fast — but ships it without tests, with security holes, and with no deployment story. You spend more time fixing what the AI wrote than you saved.

- 45% of AI-generated code introduces security vulnerabilities — and coding agents will delete validation, disable auth, or relax database policies just to make errors go away
- "It works on my machine" turns into a 3am production incident

**architect-to-product** is an MCP server that adds what vibe coding lacks: a structured AI workflow automation pipeline from architecture to production. AI-driven test driven development (AI TDD) ensures every feature works. Built-in SAST tools (Semgrep for all languages, Bandit for Python) run static code analysis and OWASP Top 10 reviews before deploy. Stack-specific deployment configs mean you ship on day one, not day thirty.

## Without vs. With architect-to-product

| Without a2p | With a2p |
|---|---|
| Vibe code a feature | Architecture-driven vertical slices |
| Manually write some tests (maybe) | TDD per slice: RED → GREEN → REFACTOR |
| Miss security vulnerabilities | Automated SAST + OWASP Top 10 review |
| Copy-paste a Dockerfile from StackOverflow | Generated Dockerfile + docker-compose + Caddyfile + backup scripts |
| Hope for the best | Ship to production with confidence |

## Key Benefits

- **Develop faster** — Vertical slices with TDD, no yak shaving
- **Fewer bugs** — AI-driven test driven development (TDD): every feature has tests before implementation (RED → GREEN → REFACTOR)
- **Ship secure** — Static code analysis (Semgrep + Bandit) + OWASP Top 10 review built into the workflow
- **Deploy on day one** — Stack-specific Dockerfile, docker-compose, Caddyfile, backup scripts
- **Code quality** — Built-in code quality tool: dead code detection, redundancy analysis, coupling metrics
- **Any stack** — Python, TypeScript, Go, Rust, Java, Ruby, PHP, C#, PostgreSQL, MySQL, MongoDB, Redis

## How it works

The full AI workflow automation pipeline:

```
Architecture → Plan → Build (TDD) → Security Gate → Deploy
```

For multi-phase projects (e.g. Phase 0: Spikes, Phase 1: MVP, Phase 2: Scale), this loop repeats per phase automatically.

```
Phase 0: Plan → Build → Security → Deploy → complete_phase
Phase 1: Plan → Build → Security → Deploy → complete_phase
...
```

1. **Onboarding**: Capture or co-develop the AI software architecture. Detect database and frontend tech. Describe UI via text, upload wireframes/mockups/screenshots, or let AI generate a design concept. Set up companion MCP servers via the MCP protocol. If the architecture defines phases, they get extracted automatically.
2. **Planning**: Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria. Three slice types: `feature` (default), `integration` (library/API adapters with TDD), `infrastructure` (CI, auth, monitoring).
3. **Build Loop**: TDD per slice: RED (write failing tests) → GREEN (minimal implementation) → REFACTOR (clean up) → SAST (lightweight AI security testing). Frontend slices with `hasUI: true` get visual verification via Playwright between GREEN and REFACTOR. Configurable review checkpoints (`reviewMode`: `off`, `all`, `ui-only`) pause after slices for human approval. Domain logic triggers a WebSearch step before tests to verify facts (tax rates, regulations, standards).
4. **Security Gate**: Full SAST scan (static code analysis via Semgrep + Bandit), OWASP Top 10 manual review, dependency audit. Acts as an AI code review tool and AI code scanner for your entire codebase. Fix all critical/high findings.
5. **Deployment**: Generate Dockerfile, docker-compose, Caddyfile, backup scripts, hardening guides. Stack-specific launch checklist.

## Quick Start

```bash
# Install globally
npm install -g architect-to-product

# Register in Claude Code
claude mcp add architect-to-product -- npx architect-to-product
```

Then restart Claude Code and use the `a2p` prompt. The onboarding will:
1. Co-develop or capture your architecture
2. Auto-generate a `.mcp.json` with all needed companion MCP servers (database, Playwright, codebase-memory)
3. Install SAST tools (Semgrep, Bandit for Python) for the security gate
4. Ask you to restart Claude Code **once** — after that, everything is ready

No manual `claude mcp add` commands needed for companions.

## Client Configuration

Works with any MCP-compatible AI coding assistant:

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

## MCP Tools (15)

| Tool | Phase | Description |
|------|-------|-------------|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, extract phases, set review mode, capture UI design |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture → ordered vertical slices (supports `append` for multi-phase) |
| `a2p_add_slice` | 1,2 | Insert a single slice mid-project (e.g. integration discovered during build) |
| `a2p_complete_phase` | 4 | Complete current product phase, advance to next |
| `a2p_get_state` | * | Read current project state (includes phase info) |
| `a2p_update_slice` | 2 | Update slice status with review checkpoints and slice summaries |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go) |
| `a2p_run_quality` | 2.5 | Code quality analysis: dead code, redundancy, coupling metrics |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Run SAST tools (Semgrep/Bandit), record findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_generate_deployment` | 4 | Get stack-specific deployment guidance |
| `a2p_get_checklist` | 4 | Pre/post-deployment verification checklist |

## Prompts (7)

Type these in Claude Code to trigger each workflow phase:

| Command | What it does |
|---------|-------------|
| `a2p` | Start onboarding: define architecture, UI design, tech stack, companions |
| `a2p planning` | Break architecture into ordered vertical slices |
| `a2p build` | Build the current slice with TDD (RED → GREEN → REFACTOR → SAST) |
| `a2p refactor` | Code quality tool: analyze codebase for dead code, redundancy, coupling |
| `a2p e2e` | AI testing tool: run visual E2E tests with Playwright |
| `a2p security` | Full SAST scan + OWASP Top 10 review |
| `a2p deploy` | Generate deployment configs and launch checklist |

### When to use which prompt

You don't have to run the full pipeline. Each prompt works standalone — pick what you need:

**Full project from scratch:**
`a2p` → `a2p planning` → `a2p build` (repeat per slice) → `a2p security` → `a2p deploy`

**MVP built with vibe coding, now make it production-ready:**
- `a2p security` — find the vulnerabilities that vibe coding missed
- `a2p refactor` — clean up the spaghetti, remove dead code
- `a2p deploy` — generate Dockerfile, docker-compose, Caddyfile instead of guessing

**Added features without tests, need confidence before shipping:**
- `a2p refactor` — identify dead code and coupling from the feature sprawl
- `a2p e2e` — visually verify nothing is broken
- `a2p security` — catch injection, auth holes, hardcoded secrets

**Existing project, just need deployment:**
- `a2p deploy` — stack-specific configs, backup scripts, hardening guide

**Built the MVP with slices, now entering Phase 2:**
- `a2p planning` — create new slices for the next phase
- `a2p build` — TDD per slice as usual

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

## Disclaimer

This is not a guarantee of bug-free code. It's an engineering-grade safety net that catches what vibe coding misses.

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 500 tests
npm run build       # Build
npm run dev         # Dev mode
```

## License

MIT
