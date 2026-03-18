# A2P — Architect-to-Product
AI engineering framework delivered as an MCP server. Turns AI-generated code into production-ready software with evidence-gated TDD, security review, backup strategy, and deployment automation.

**30 MCP tools · 1138 tests · Architecture → Plan → Build → Audit → Security → Deploy**

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Tests: 1097 passing](https://img.shields.io/badge/tests-1097%20passing-brightgreen)](docs/validation/) [![TypeScript](https://img.shields.io/badge/TypeScript-blue)](tsconfig.json)

---

**Best for:** developers using Claude Code, Cursor, or other MCP clients who want AI speed with test, security, and deployment discipline — whether building from scratch or hardening a vibe-coded MVP.

📖 [Getting Started](#quickstart) · [Workflow](docs/WORKFLOW.md) · [Security](docs/SECURITY.md) · [Reference](docs/REFERENCE.md) · [Deployment (Hetzner / VPS)](docs/HETZNER-DEPLOYMENT.md)

---

## Quickstart

```bash
npx architect-to-product init
```

This creates `.mcp.json` in your project. Then restart Claude Code and run:

```
/a2p
```

A2P starts with two onboarding paths:

1. **Discuss your idea** — For vibe coders. A2P asks structured questions and co-develops the architecture with you.
2. **Paste your architecture** — For engineers who already have an architecture. Paste it, A2P analyzes it, and starts building. This path is optimized for speed.

---

## What A2P is

A2P is an AI engineering framework packaged as an MCP server.

It adds engineering discipline to AI-assisted software development: architecture-driven planning, evidence-gated TDD, security review, backup strategy, and deployment generation.

The MCP server is the interface. The engineering system is the product.

In one sentence: **A2P is an AI engineering framework, packaged as an MCP server, for turning AI-generated code into production-ready software.**

---

## How it works

A2P drives software through a gated lifecycle:

**Architecture → Plan → Build → Audit → Security → Deploy**

During build, each feature (called a "slice") follows an evidence-gated TDD cycle:

**RED → GREEN → REFACTOR → SAST → DONE**

That means:
- tests define the requirement first
- implementation must prove it passes
- refactoring must preserve green tests
- security scanning is part of the slice workflow
- **state transitions are enforced in code, not just described in prompts**

The AI agent cannot skip a gate. If it tries to advance without meeting the conditions, the tool throws an error. There is no way around it.

### Lifecycle overview

```
onboarding → planning → building → security → deployment → complete
                ↑           ↓          ↑            ↓
                └── refactoring    ←───┘     (re-entry: full
                        ↓                    security cycle
                   e2e_testing               required again)
```

→ Full lifecycle, gates, and re-entry rules: [docs/WORKFLOW.md](docs/WORKFLOW.md)

---

## Why A2P exists

AI coding agents are fast, but they tend to skip discipline:
- they write code before tests
- they mark work "done" without sufficient evidence
- they suppress errors instead of fixing root causes
- they underinvest in security, backup, and deployment hardening

A2P adds the missing engineering system around the agent.

---

## Key capabilities

- **Evidence-gated development** — Slice progression is enforced through test and workflow evidence. No tests passing, no advancing.
- **Architecture-driven planning** — Work is broken into ordered vertical slices instead of ad-hoc task generation.
- **Security review built into the workflow** — Includes SAST (Semgrep + Bandit), exploitability-focused whitebox review, and optional runtime adversarial testing (Shake & Break).
- **Human oversight at critical gates** — Build signoff and deploy approval are mandatory. All other checkpoints are configurable.
- **Backup-aware deployment** — Stateful systems are blocked from deployment unless backup requirements are satisfied.
- **SSL/HTTPS enforcement** — Deployment cannot be marked complete without verified SSL certificate and auto-renewal. Caddy handles Let's Encrypt automatically; PaaS platforms handle SSL automatically.
- **Secret management** — 4-tier secret management (env-file, Docker Swarm, Infisical, external) is code-enforced before deployment configs can be generated.
- **Frontend aesthetics enforcement** — All UI slices follow Anthropic's frontend aesthetics guidelines: distinctive typography, cohesive color themes, motion, atmospheric backgrounds. Generic AI aesthetics (Inter font, purple gradients, cookie-cutter layouts) are explicitly prohibited.
- **Deployment generation** — Produces stack-specific Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, and hardening guides.
- **Code intelligence** — `codebase-memory-mcp` builds a code graph instead of scanning files raw — up to 100x fewer exploration tokens.
- **Structured build history** — Tool runs, statuses, durations, and findings are tracked in a queryable build log with secret redaction.

---

## Common use cases

### 1. Start a new project with guardrails
Use A2P from day one to define architecture, plan slices, build with TDD, and generate deployment artifacts.

```
/a2p → /a2p_planning → /a2p_build_slice (repeat per slice) → /a2p_audit → /a2p_security_gate → /a2p_whitebox → /a2p_audit (release) → /a2p_deploy
```

### 2. Harden a vibe-coded MVP
Skip straight to security, audits, refactoring, and deployment preparation — no slices needed.

```
/a2p → set architecture → transition to security
/a2p_security_gate → /a2p_whitebox → /a2p_refactor → /a2p_deploy
```

### 3. Re-scan before release
Transition back to security from deployment or complete — prior approvals are automatically invalidated and the full security cycle must be re-satisfied.

```
security re-entry → /a2p_security_gate → /a2p_whitebox → /a2p_deploy
```

---

## Without vs. with A2P

| Without A2P | With A2P |
|---|---|
| Ad-hoc AI coding | Architecture-driven vertical slices |
| Tests are optional | Evidence-gated TDD (enforced in code) |
| Security is manual or late | SAST + whitebox + optional runtime adversarial testing |
| Deployment is improvised | Stack-specific configs, backup/restore scripts, hardening guides |
| Backups are an afterthought | Backup strategy inferred from stack, gates enforced |
| SSL is "we'll add it later" | SSL/HTTPS verified before deployment completes, auto-renewal confirmed |
| Secrets in .env, maybe committed | 4-tier secret management enforced before deploy |
| "Done" is subjective | Gates are enforced in code, not just in prompts |
| No build history | Structured build log with levels, duration, run correlation |

---

## Validation

A2P includes active claim verification across the full pipeline.

- **Phase A/B:** Workflow, state management, and gate enforcement (96 QuickBill scenarios)
- **Phase C:** Real UI tests via Playwright against a running Next.js app (8 browser tests)
- **Phase D/E:** Deploy target reality check + companion tool count verification
- README claims are actively tracked, corrected, and verified against real behavior

→ Full validation results: [docs/validation/](docs/validation/)

---

## Client setup

A2P works with Claude Code, Claude Desktop, Cursor, VS Code, and any MCP-compatible AI coding assistant.

**Claude Code (CLI)**
```bash
claude mcp add architect-to-product -- npx architect-to-product
```

**Claude Desktop** — Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):
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

**Cursor** — Add to `.cursor/mcp.json`:
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

**VS Code** — Add to `.vscode/mcp.json`:
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

---

## Prompts

MCP prompts are invoked with `/` in Claude Code:

| Command | What it does |
|---|---|
| `/a2p` | Start onboarding — define architecture, UI design, tech stack, oversight config, companions |
| `/a2p_planning` | Break architecture into ordered vertical slices |
| `/a2p_build_slice` | Build the current slice with TDD (RED → GREEN → REFACTOR → SAST) + mandatory build signoff |
| `/a2p_refactor` | Code quality tool — analyze codebase for dead code, redundancy, coupling |
| `/a2p_e2e_testing` | AI testing tool — run visual E2E tests with Playwright |
| `/a2p_security_gate` | Full SAST scan + OWASP Top 10 review |
| `/a2p_whitebox` | Whitebox security audit + active verification |
| `/a2p_audit` | Quality audit (dev hygiene) or release audit (pre-publish) |
| `/a2p_deploy` | Generate deployment configs and launch checklist |

---

## Documentation

- [Workflow and lifecycle](docs/WORKFLOW.md) — state machine, gates, oversight, re-entry, multi-phase
- [Security model](docs/SECURITY.md) — SAST, whitebox, Shake & Break, security coverage, findings
- [Reference](docs/REFERENCE.md) — tools, prompts, stacks, companions, model preference
- [Deployment (Hetzner / VPS)](docs/HETZNER-DEPLOYMENT.md) — Docker VPS, Hetzner Cloud, 3-layer backup
- [Validation](docs/validation/) — claim verification, test evidence, reality checks

<details>
<summary>MCP Tools reference (30 tools)</summary>

| Tool | Phase | Description |
|---|---|---|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, extract phases, configure oversight, capture UI design |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture → ordered vertical slices (supports append for multi-phase) |
| `a2p_add_slice` | 1,2 | Insert a single slice mid-project |
| `a2p_set_phase` | * | Transition to a new workflow phase (enforces all gates) |
| `a2p_complete_phase` | 7 | Complete current product phase, advance to next |
| `a2p_get_state` | * | Read current project state |
| `a2p_update_slice` | 2 | Update slice status with review checkpoints and summaries |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go/flutter/dart/xctest/gradle) |
| `a2p_run_quality` | 2.5 | Code quality analysis — dead code, redundancy, coupling |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Static code analysis with Semgrep/Bandit, deduplicated findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_run_audit` | 2,6 | Quality audit or release audit. Critical release findings block deployment |
| `a2p_run_whitebox_audit` | 4 | Whitebox security audit — exploitability analysis of SAST findings |
| `a2p_run_active_verification` | 5 | Active verification — runtime gate tests |
| `a2p_build_signoff` | 2 | Confirm build works (mandatory before security phase) |
| `a2p_deploy_approval` | 7 | Approve deployment (mandatory before generating configs) |
| `a2p_set_secret_management` | 7 | Set secret management tier (mandatory before deployment configs) |
| `a2p_plan_infrastructure` | 7 | Plan server infrastructure for Hetzner Cloud |
| `a2p_record_server` | 7 | Record provisioned server details in project state |
| `a2p_deploy_to_server` | 7 | Generate rsync/ssh/docker deployment commands |
| `a2p_verify_ssl` | 7 | Record SSL/HTTPS verification (mandatory gate before deployment complete) |
| `a2p_generate_deployment` | 7 | Stack-specific deployment guidance |
| `a2p_shake_break_setup` | 5 | Set up isolated sandbox for runtime adversarial testing |
| `a2p_shake_break_teardown` | 5 | Tear down sandbox, record results |
| `a2p_get_build_log` | * | Query structured build log |
| `a2p_get_checklist` | * | Pre/post-deployment verification checklist |

</details>

<details>
<summary>Security coverage summary</summary>

A2P layers multiple security mechanisms from deterministic pattern matching to LLM-guided code review to active runtime testing.

**Coverage by numbers:** 32 deterministic probes · 25 adversarial review domains · 8 runtime test categories · 2 active verification categories · deployment artifact validation · dependency scanning · pre/post-deployment checklists

**Mechanisms:**
- **Probe** — Deterministic regex/AST pattern matching
- **SAST** — Semgrep + Bandit static analysis
- **Adversarial** — LLM-guided code review with confidence tracking and file:line evidence
- **Shake & Break** — Runtime adversarial testing with real HTTP requests in an isolated sandbox
- **Active Verification** — Runtime gate tests proving workflow invariants hold

**Domains covered:** SQL/command/NoSQL injection, XSS, path traversal, SSRF, insecure deserialization, auth middleware, IDOR, privilege escalation, mass assignment, hardcoded secrets, JWT, session fixation, CSRF, CORS, race conditions, business logic bypasses, file upload, webhook security, and more.

→ Full security coverage matrix: [docs/SECURITY.md](docs/SECURITY.md)

</details>

<details>
<summary>Companion MCP servers</summary>

A2P auto-configures companion MCP servers based on your tech stack.

**Core (always installed)**

| Companion | What it adds |
|---|---|
| `codebase-memory-mcp` | Code graph intelligence — up to 100x fewer exploration tokens |
| `mcp-server-git` | Git history, commits, diffs |
| `@modelcontextprotocol/server-filesystem` | File operations |
| `@modelcontextprotocol/server-sequential-thinking` | Step-by-step reasoning |

**Conditional (installed based on stack)**

| Companion | When |
|---|---|
| Playwright MCP | Frontend projects |
| GitHub MCP | GitHub repos |
| Supabase MCP | Supabase projects |
| `@stripe/mcp` | Payment/billing |
| `@cloudflare/mcp-server-cloudflare` | Cloudflare hosting |
| `@sentry/mcp-server` | Error tracking |
| `@upstash/mcp-server` | Serverless Redis/Queue |
| Semgrep MCP | Semgrep Pro users |
| Database MCPs | PostgreSQL, MongoDB, MySQL |

> **Security note:** Companion MCPs are third-party software with access to your project files and databases. Review the source repo and generated `.mcp.json` before enabling any companion.

**Frontend Aesthetics (enforced)**

A2P enforces [Anthropic's frontend aesthetics guidelines](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/frontend-design) for all `hasUI` slices. The build prompt requires distinctive typography, cohesive color themes, motion, atmospheric backgrounds, and creative spatial composition. Generic AI aesthetics (Inter/Roboto fonts, purple gradients, cookie-cutter layouts, emoji icons) are explicitly prohibited.

</details>

<details>
<summary>Supported stacks and deploy targets</summary>

**Languages:** Python, TypeScript/Node.js, Go, Rust, Java/Kotlin, Ruby, PHP, C#/.NET, Dart/Flutter, Swift

**Databases:** SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis

**Hosting:** Hetzner, DigitalOcean, AWS, Fly.io, Railway, Vercel, Cloudflare, Render, any VPS

**Deploy targets:**

| Target | What A2P generates |
|---|---|
| Docker VPS (Hetzner, DigitalOcean, any Ubuntu VPS) | Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, BACKUP.md, DEPLOYMENT.md, hardening checklist. Hetzner: automated provisioning, cloud-init, firewall, 3-layer backup |
| Vercel | Recommendations + checklist |
| Cloudflare Pages/Workers | Recommendations + checklist |
| Railway | Recommendations + checklist |
| Fly.io | Recommendations + checklist |
| Render | Recommendations + checklist |
| Mobile (Flutter, React Native) | Recommendations and checklists only — mobile toolchains are project-provided |

</details>

---

## Upgrading

### 1.0.3 → 1.0.4

**New: SSL/HTTPS verification gate (code-enforced)**
- New tool `a2p_verify_ssl` — records SSL/HTTPS verification with domain, method, issuer, auto-renewal status
- `deployment → complete` is now blocked without SSL verification — code-enforced gate, not just a checklist item
- `completeProductPhase` (final phase) is also blocked without SSL verification
- SSL verification is automatically invalidated when the infrastructure domain changes
- Caddy auto-renewal is documented — no certbot or cron jobs needed
- All PaaS paths (Vercel, Cloudflare, Railway, Fly.io, Render) include SSL gate instructions

**State changes:** New fields `sslVerifiedAt` (string | null) and `sslVerification` (object | null) in project state. Existing projects get `null` defaults automatically via Zod schema defaults — no migration needed.

### 1.0.2 → 1.0.3

**What changed (5 bugs from Mini Shop E2E):**
- SAST now excludes framework build artifacts (`.next/`, `.nuxt/`, `.svelte-kit/`, `.turbopack/`, `.output/`, `build/`, `.vercel/`, `.angular/`)
- SAST finding deduplication now includes `projectFindings` (was only checking slice findings)
- `addSASTFinding` / `updateSASTFinding` no longer trigger false "stale SAST" — recording a finding is not a code change
- Adversarial review security decision now requires a user-provided confirmation code (prevents agent auto-bypass)
- Deploy flow adds `chmod 600` for `.env.production` + secret management guidance in prompt and checklist
- New tool `a2p_set_secret_management` — 4-tier secret management choice (env-file / docker-swarm / infisical / external) is **code-enforced** before deployment configs can be generated

### 1.0.1 → 1.0.2

```bash
rm -rf ~/.npm/_npx                       # clear npx cache
npm view architect-to-product version    # verify 1.0.2 on registry
```

If you previously installed globally:
```bash
npm uninstall -g architect-to-product
```

**What changed:**
- README restructured: concise overview + deep-dive docs (WORKFLOW.md, SECURITY.md, REFERENCE.md)
- Tool count corrected: 27 (was 28 — duplicate `a2p_run_quality` row removed)
- Test count updated: 1084
- Added upgrade notes section

### 1.0.0 → 1.0.1

**What changed:**
- Fixed duplicate events in audit, SAST, whitebox, and active verification (same event logged twice per run)
- `pendingSecurityDecision` is now enforced as a hard deployment gate (was prompt-only before)

---

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 1138 tests
npm run build       # Build
npm run dev         # Dev mode
```

---

## License

MIT
