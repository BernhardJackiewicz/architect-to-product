# A2P Reference

Full reference for MCP tools, prompts, supported stacks, deploy targets, and companion servers.

---

## MCP Tools (27)

| Tool | Phase | Description |
|------|-------|-------------|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, extract phases, configure oversight, capture UI design |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture → ordered vertical slices (supports `append` for multi-phase) |
| `a2p_add_slice` | 1,2 | Insert a single slice mid-project (e.g. integration discovered during build) |
| `a2p_set_phase` | * | Transition to a new workflow phase (enforces all gates: E2E, build signoff, quality audit, etc.) |
| `a2p_complete_phase` | 7 | Complete current product phase, advance to next (multi-phase projects) |
| `a2p_get_state` | * | Read current project state (includes phase info) |
| `a2p_update_slice` | 2 | Update slice status with review checkpoints and slice summaries |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go/flutter/dart/xctest/gradle) |
| `a2p_run_quality` | 2.5 | Code quality analysis — dead code, redundancy, coupling metrics |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Static code analysis with Semgrep/Bandit, deduplicated findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_run_audit` | 2,6 | Quality audit (dev hygiene) or release audit (pre-publish). Critical release findings block deployment |
| `a2p_run_whitebox_audit` | 4 | Whitebox security audit — exploitability analysis of SAST findings (reachable paths, guards, trust boundaries). Blocking findings prevent deployment |
| `a2p_run_active_verification` | 5 | Active verification — runtime gate tests (workflow gates, state recovery, deployment gates) |
| `a2p_build_signoff` | 2 | Confirm build works (mandatory before security phase, code-enforced) |
| `a2p_deploy_approval` | 7 | Approve deployment (mandatory before generating configs, code-enforced) |
| `a2p_plan_infrastructure` | 7 | Plan server infrastructure (sizing, security, cloud-init, provisioning commands) for Hetzner Cloud |
| `a2p_record_server` | 7 | Record provisioned server details in project state |
| `a2p_deploy_to_server` | 7 | Generate rsync/ssh/docker deployment commands for a provisioned server |
| `a2p_generate_deployment` | 7 | Stack-specific deployment guidance |
| `a2p_shake_break_setup` | 5 | Set up isolated sandbox for runtime adversarial testing (worktree, safe .env, port, DB) |
| `a2p_shake_break_teardown` | 5 | Tear down sandbox, auto-calculate finding count, record results |
| `a2p_get_build_log` | * | Query structured build log (filter by phase, slice, level, run, time range, errors) |
| `a2p_get_checklist` | * | Pre/post-deployment verification checklist |

---

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

---

## When to Use Which Prompt

You don't have to run the full pipeline. Each prompt works standalone — pick what you need:

**Full project from scratch:**
`/a2p` → `/a2p_planning` → `/a2p_build_slice` (repeat per slice) → `/a2p_audit` (quality) → `/a2p_e2e_testing` (if UI) → `/a2p_security_gate` → `/a2p_whitebox` → [Shake & Break optional] → `/a2p_audit` (release) → `/a2p_deploy`

**MVP built with vibe coding, now make it production-ready:**
- `/a2p` → set architecture → transition directly to security (no slices needed)
- `/a2p_security_gate` — find the vulnerabilities that vibe coding missed
- `/a2p_whitebox` — verify which findings are actually exploitable vs. noise
- `/a2p_refactor` — clean up the spaghetti, remove dead code
- `/a2p_deploy` — generate Dockerfile, docker-compose, Caddyfile instead of guessing

**Already deployed, need a security re-scan:**
- Transition back to security from deployment or complete phase — prior approvals are automatically invalidated
- `/a2p_security_gate` → `/a2p_whitebox` → full security cycle before re-deploying

**SAST reports too many findings, need to triage:**
- `/a2p_whitebox` — whitebox audit confirms exploitability, active verification tests that gates hold

**Added features without tests, need confidence before shipping:**
- `/a2p_audit` — catch TODOs, debug artifacts, hardcoded secrets, missing .gitignore entries, low test coverage
- `/a2p_refactor` — identify dead code and coupling from the feature sprawl
- `/a2p_e2e_testing` — visually verify nothing is broken
- `/a2p_security_gate` — catch injection, auth holes, hardcoded secrets

**Existing project, just need deployment:**
- `/a2p_deploy` — stack-specific configs, backup/restore/verify scripts, offsite sync, hardening guide

**Built the MVP with slices, now entering Phase 2:**
- `/a2p_planning` — create new slices for the next phase
- `/a2p_build_slice` — TDD per slice as usual

---

## Adding Slices vs Re-Planning

Two ways to add work during or after the build:

**`a2p_add_slice`** — Insert a single slice mid-build. Use this when you realize something is missing while building. Example: during build you discover you need a rate-limiting middleware before the API endpoints. Add it as a slice, build it with TDD, then continue. Build signoff is automatically invalidated when slices change.

**`/a2p_planning`** — Plan a whole new set of slices. Use this for the next product phase (Phase 0 done → plan Phase 1) or when you need a full re-plan. Uses `append: true` to add slices to the existing plan without losing completed work.

| Situation | Use |
|---|---|
| "We forgot to add input validation" | `a2p_add_slice` — one slice, insert and build |
| "Phase 0 is done, start Phase 1" | `/a2p_planning` — plan all Phase 1 slices |
| "I want to add a webhook integration" | `a2p_add_slice` — one integration slice |
| "The architecture changed significantly" | `/a2p_planning` — re-plan remaining work |
| "Existing repo, I want to add a feature" | `/a2p` → `/a2p_planning` → `/a2p_build_slice` |

**Adding a feature to an existing project:** If you have a repo that wasn't built with A2P, you can still use it. Run `/a2p` to onboard the existing codebase, then `/a2p_planning` to create slices for the new feature. A2P detects existing code via codebase-memory and only plans slices for what's missing — it won't rebuild what's already there.

---

## Supported Stacks

| Category | Technologies |
|----------|-------------|
| **Languages** | Python, TypeScript/Node.js, Go, Rust, Java/Kotlin, Ruby, PHP, C#/.NET, Dart/Flutter, Swift |
| **Databases** | SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis |
| **Hosting** | Hetzner, DigitalOcean, AWS, Fly.io, Railway, Vercel, Cloudflare, Render, any VPS |

---

## Supported Deploy Targets

| Target | What A2P generates |
|--------|-------------------|
| **Docker VPS** (Hetzner, DigitalOcean, any VPS) | File generation guidance for Dockerfile, docker-compose.prod.yml, Caddyfile, backup/restore/verify scripts, BACKUP.md, DEPLOYMENT.md. Security hardening checklist. Stack-specific recommendations. **Hetzner Cloud:** automated provisioning, cloud-init with production hardening, firewall rules, 3-layer backup strategy, rsync/docker deployment. See [HETZNER-DEPLOYMENT.md](HETZNER-DEPLOYMENT.md). |
| **Vercel** | Recommendations (Edge Functions, env vars, preview deploys). Checklist items. |
| **Cloudflare** (Pages/Workers) | Recommendations (wrangler.toml bindings, WAF, CDN). Checklist items. |
| **Railway** | Recommendations (railway up, managed DB add-ons). Checklist items. |
| **Fly.io** | Recommendations (fly.toml, Volumes, TLS). Checklist items. |
| **Render** | Recommendations (render.yaml Blueprint, Private Services). Checklist items. |
| **Mobile** (Flutter, React Native) | Recommendations only: build commands, TestFlight/Play Store distribution, multi-target coordination. No generated build scripts — mobile toolchains are project-provided. |

Docker VPS targets get full file generation guidance. PaaS targets (Vercel, Railway, Cloudflare, Fly.io, Render) get stack-specific recommendations and deployment checklists. Mobile targets get deployment recommendations and checklists but no generated build scripts — A2P orchestrates, mobile toolchains are project-provided.

---

## Companion MCP Servers

A2P auto-configures companion MCP servers based on your tech stack. Each companion is integration-tested against its real server to verify tool availability.

### Core (always installed)

| Companion | What it adds | Verified Tools |
|-----------|-------------|----------------|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Code graph intelligence — up to 100x fewer exploration tokens vs. raw file scanning | 11 tools |
| [mcp-server-git](https://github.com/modelcontextprotocol/servers) | Git history, commits, diffs | `git_log`, `git_diff`, `git_commit`, `git_status`, ... |
| [@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers) | File operations | 13 tools |
| [@modelcontextprotocol/server-sequential-thinking](https://github.com/modelcontextprotocol/servers) | Step-by-step reasoning for complex decisions | 1 tool |

### Conditional (installed based on stack)

| Companion | When | Key Tools |
|-----------|------|-----------|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Frontend projects | `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`, ... |
| [GitHub MCP](https://github.com/github/github-mcp-server) | GitHub repos | `list_issues`, `create_pull_request`, `search_code`, `get_file_contents`, ... |
| [Supabase MCP](https://github.com/supabase-community/supabase-mcp) | Supabase projects | `execute_sql`, `list_tables`, `apply_migration`, `deploy_edge_function`, ... |
| [@stripe/mcp](https://github.com/stripe/agent-toolkit) | Payment/billing | `create_product`, `create_price`, `create_payment_link`, `create_customer`, ... |
| [@cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | Cloudflare hosting | `worker_deploy`, `kv_put`, `d1_query`, `r2_put_object`, ... |
| [@sentry/mcp-server](https://github.com/getsentry/sentry-mcp-server) | Error tracking | `list_issues`, `get_issue_details`, `find_projects`, ... |
| [@upstash/mcp-server](https://github.com/upstash/mcp-server) | Serverless Redis/Queue | `redis_database_run_redis_commands`, `qstash_publish_message`, ... |
| [Semgrep MCP](https://semgrep.dev/) | Semgrep Pro users | `semgrep_scan`, `security_check` (OSS uses CLI fallback) |
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

---

## Model Preference

Configure which Claude model does the programming via `claudeModel` in `a2p_set_architecture`:

| Model | Best for | Trade-off |
|-------|----------|-----------|
| **`opus`** (default) | Production code, complex architectures | Maximum quality, slower, most expensive |
| `sonnet` | Standard features, good-enough code | Fast, cheaper, less deep analysis |
| `haiku` | Simple tasks, scaffolding | Fastest, cheapest, basic quality |

Stored in `.a2p/state.json` → `config.claudeModel`. Referenced in CLAUDE.md and all prompts.

---

## Documentation-First Principle

When the architecture uses unfamiliar technologies (exotic auth, new ORMs, niche APIs), Claude is instructed to:

1. **WebSearch** for the official documentation URL
2. **WebFetch** to read the relevant docs (Getting Started, API Reference, Configuration)
3. Document the source URL as a comment in the code
4. **Never** hallucinate API signatures, config options, or behavior

This rule is enforced in the shared Engineering Loop (all prompts), the build-slice prompt (detailed section), the security-gate prompt, and the generated CLAUDE.md.
