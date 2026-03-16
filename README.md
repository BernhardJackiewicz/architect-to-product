# A2P — Architect-to-Product

MCP server that turns AI-generated code into production-ready software with TDD, security scanning, and deployment automation. Up to 100 times fewer exploration tokens for claude code.

**25 MCP tools** · **928 tests** · **Architecture → Plan → Build (evidence-gated) → Quality Audit (cadence) → Code Review → Signoff → E2E Testing → Security → Whitebox → Verify → Release Audit → Deploy → Backup**

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 928 passing](https://img.shields.io/badge/tests-928%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()

---

Vibe coding with Claude Code, Cursor, or any AI coding assistant generates code fast — but ships it without tests, with security holes, and with no deployment story. You spend more time fixing what the AI wrote than you saved.

- AI-generated code frequently introduces security vulnerabilities — and coding agents will delete validation, disable auth, or relax database policies just to make errors go away
- "It works on my machine" turns into a 3am production incident

**Architect-to-Product** is an MCP server that turns AI-generated code into production-ready software. It adds TDD, static code analysis, and deployment automation to AI coding workflows.

Evidence-gated development requires passing tests before any slice can advance — enforced in code, not just in prompts. Built-in SAST tools (Semgrep for all languages, Bandit for Python) run static code analysis and OWASP Top 10 reviews before deploy. Stack-aware backup strategy infers what needs protecting — databases, uploads, deployment artifacts — and generates backup, restore, and verification scripts automatically. Stack-specific deployment configs mean you ship on day one, not day thirty.

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
- **Evidence-gated development** — every feature requires passing tests before advancing (code-enforced)
- **Static code analysis** — Semgrep + Bandit scan for vulnerabilities automatically
- **Whitebox security audit** — verifies whether SAST findings are actually exploitable (reachable paths, guards, trust boundaries)
- **Active verification** — runtime gate tests that prove workflow invariants hold (state transitions, deployment gates, recovery)
- **Code audits** — Quality audits during development, release audits before publish (TODOs, debug artifacts, secrets, .gitignore, test coverage, README)
- **Security reviews** — OWASP Top 10 review before deploy
- **Structured build log** — every tool run tracked with log levels, duration, status, run correlation, and automatic secret redaction. Composable filters by phase, slice, level, time range, or errors
- **Configurable human oversight** — mandatory build signoff and deploy approval, optional plan approval, slice review, UI screenshot verification, and security signoff
- **Backup strategy** — Automatic inference of backup targets (database, uploads, artifacts) from tech stack. Stack-aware backup/restore commands, retention policies, verification scripts, offsite sync. Stateful apps are blocked from deployment if backup is missing
- **Deployment generation** — stack-specific Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, hardening guides

A2P is not a replacement for engineers — it is the engineering reality layer that most architectures forget.

Humans design features, flows, data models, and business logic. What they skip: logging, backup strategy, restore verification, deploy checks, test evidence, release hygiene, and proof that the code is actually secure — not just scanner-clean. A2P forces these layers in automatically. Every slice needs test evidence before it can advance. Every deployment needs a backup plan, a full security scan, and human sign-off. Every finding gets triaged for real exploitability, not just pattern-matched.

Most AI-generated — and human-built — architectures don't fail because the main idea was wrong. They fail because of missing defaults, missing safeguards, and missing operational discipline. A2P closes that gap systematically.

## Without vs. With architect-to-product

| Without a2p | With a2p |
|---|---|
| Vibe code a feature | Architecture-driven vertical slices |
| Manually write some tests (maybe) | Evidence-gated slices: RED → GREEN → REFACTOR (green requires passing tests, done requires passing tests + SAST) |
| Miss security vulnerabilities | Automated SAST + OWASP Top 10 review + whitebox exploitability analysis |
| SAST reports 50 findings, most are noise | Whitebox audit confirms which findings are actually exploitable |
| Ship with TODOs, console.logs, .env in repo | Quality + release audits catch hygiene issues, block deploy on critical findings |
| AI runs without stopping | Mandatory build signoff + deploy approval, UI screenshot review, configurable oversight at every phase |
| AI hallucinates API signatures for unfamiliar libraries | Documentation-first: reads official docs via WebSearch + WebFetch before writing code |
| No backup strategy, pray nothing breaks | Stack-aware backup inference with restore scripts, verification, and deployment gate enforcement |
| Copy-paste a Dockerfile from StackOverflow | Generated Dockerfile + docker-compose + Caddyfile + backup scripts |
| No build history, no idea what failed when | Structured build log with levels, duration, run correlation, and secret redaction |
| Hope for the best | Ship to production with confidence |

## Key Benefits

- **100x fewer tokens** — Code graph intelligence via codebase-memory-mcp replaces raw file scanning — saves context window and money
- **Develop faster** — Vertical slices with TDD, no yak shaving
- **Fewer bugs** — Evidence-gated development: every slice requires passing tests before advancing (RED → GREEN → REFACTOR, code-enforced)
- **Ship secure** — Static code analysis (Semgrep + Bandit) + OWASP Top 10 review + whitebox exploitability analysis built into the AI coding workflow
- **Whitebox audit** — SAST finds patterns, whitebox proves exploitability: reachable code paths, missing guards, prompt-only enforcement. Blocking findings prevent deployment (enforced in code)
- **Active verification** — Runtime gate tests prove that workflow invariants actually hold: state transitions require evidence, deployment gates block on critical findings, state survives round-trips
- **Human oversight** — Mandatory build signoff (before wasting tokens on audit/security) and deploy approval. Configurable plan approval, slice review, UI screenshot verification, and security signoff. Two gates are always on, the rest you control
- **Code review** — Structured code review at build signoff (cross-slice consistency) and release audit (cross-file consistency, API coherence)
- **Finding justification** — Security findings can't be silently dismissed — accepted/fixed/false_positive require justification (code-enforced)
- **Audit before release** — Quality audits catch debug artifacts, hardcoded secrets, and test coverage gaps during development. Release audits verify README, .gitignore, temp files, and aggregate findings before publish. Critical release findings block deployment (enforced in code)
- **Automated backup strategy** — Stack-aware inference of what needs protecting (database, uploads, artifacts). Generates backup, restore, and verification scripts with stack-specific commands (`pg_dump`, `mysqldump`, `mongodump`, `sqlite3 .backup`). Retention policies, offsite sync, and deployment gate enforcement for stateful apps
- **Automated cloud deployment** — Hetzner Cloud: infrastructure planning (server sizing, cloud-init, firewall), provisioning via API, and deployment (rsync + docker compose) — all from Claude. Server hardening (SSH, fail2ban, UFW, unattended-upgrades) included in cloud-init
- **Deploy on day one** — Stack-specific Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, hardening guides
- **Code quality** — Built-in code quality tool: dead code detection, redundancy analysis, coupling metrics
- **Documentation first** — When the architecture uses unfamiliar tech (exotic auth, new ORMs, niche APIs), Claude reads the official docs via WebSearch + WebFetch instead of hallucinating API signatures. Enforced in every prompt, documented in CLAUDE.md
- **Model preference** — Configure which Claude model does the programming (`opus`, `sonnet`, `haiku`). Default: opus (Claude Opus 4.6 with maximum effort). Stored in project config, referenced by all prompts
- **Structured logging** — Build events with log levels, status, duration tracking, run correlation, secret redaction, and output previews. Filter build logs by level, run, phase, or errors
- **Any stack** — Python, TypeScript, Go, Rust, Java, Ruby, PHP, C#, Dart/Flutter, Swift — PostgreSQL, MySQL, MongoDB, Redis
- **Mobile / cross-platform** — Platform-aware architecture (`mobile`, `cross-platform`, `backend-only`, `web`). Mobile checklist items (code signing, TestFlight, release hardening). Compliance items (GoBD, GDPR). External validator items (KoSIT, veraPDF). Multi-target deployment guidance (backend first, then mobile distribution). No false artifact promises — A2P orchestrates, toolchains are project-provided. Verified with a real Flutter/Dart + Kotlin/Spring Boot project on physical iPhone (14 slices, OCR pipeline, KoSIT validation, GoBD archive). Known limits: Gradle test counts require `--console=plain` or JUnit XML output; mobile E2E runs via `a2p_run_tests`, not the Playwright-based `a2p_run_e2e`

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
    "uiVerification": true,
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
| `uiVerification` | `true`* | No | Human reviews Playwright screenshots after visual verification of UI slices. *Auto-enabled when frontend detected |
| `securitySignoff` | `false` | No | Explicit go/no-go after security gate (in addition to code-enforced gates) |

### Always-On Gates (Code-Enforced)

These cannot be bypassed — they are enforced in code, not just in prompts:

- **Build gate**: Cannot leave building phase until all slices are `done`
- **Build signoff gate**: Cannot proceed to security without human build signoff (`a2p_build_signoff`). Signoff is invalidated by any slice change or new test run — must re-signoff
- **E2E gate**: Projects with UI slices (`hasUI: true`) and Playwright installed cannot skip E2E testing — `building→security` and `refactoring→security` are blocked. Must go through `e2e_testing` phase first
- **Evidence gates**: Cannot mark slice as `green` without passing tests, `sast` without SAST scan, `done` without passing tests
- **Security gate**: Cannot deploy with open CRITICAL/HIGH SAST findings
- **Full SAST gate**: Cannot deploy without at least one full SAST scan (`a2p_run_sast mode=full`)
- **Whitebox gate**: Cannot deploy with blocking whitebox findings (confirmed exploitable auth/secrets/tenant issues)
- **Audit gate**: Cannot deploy with critical release audit findings
- **Deploy approval gate**: Cannot generate deployment configs without human deploy approval (`a2p_deploy_approval`). Approval is invalidated by new findings, whitebox results, or audit results — must re-approve
- **Backup gate**: Stateful apps (database or uploads) are blocked from deploying without configured backup (enforced in code)
- **Finding justification gate**: Cannot set finding status to `accepted`, `fixed`, or `false_positive` without a justification (code-enforced via `a2p_record_finding`)
- **Companion restart detection**: `a2p_get_state` reports `restartRequired: true` when companions are configured but session hasn't been restarted
- **Phase guards**: Tools are restricted to appropriate phases (e.g. tests only in building, SAST full only in security, deployment only in deployment phase)
- **Test command restriction**: Test command override blocked when a test command is configured — prevents fabricated test results

### Backup Strategy

A2P automatically infers a backup strategy from your tech stack during onboarding. No manual configuration needed — if your app has a database or handles uploads, A2P knows it needs backups.

**How inference works:**
- **Database detected** (PostgreSQL, MySQL, SQLite, MongoDB) → `required: true`, target `"database"` added, stack-specific `pg_dump`/`mysqldump`/`mongodump`/`sqlite3 .backup` commands generated
- **Uploads/media detected** (features mentioning upload, file storage, media, images) → `required: true`, targets `"uploads"` + `"local_media"` added
- **Hosting detected** → offsite provider inferred (Hetzner → `hetzner_storage`, AWS → `s3`, DigitalOcean → `spaces`)
- **Stateless apps** → `enabled: true` but `required: false`, only `"deploy_artifacts"` backup (no warnings, no gates)

**What gets generated during deployment:**
- `scripts/backup.sh` — database + artifact backup with retention and manifest
- `scripts/restore.sh` — restore from backup with verification
- `scripts/backup-verify.sh` — verify backup integrity and freshness
- `scripts/backup-offsite.sh` — sync to offsite provider (if configured)
- `ops/backup.env.example` — backup configuration (paths, retention, offsite credentials)
- `docs/BACKUP.md` — strategy, schedule, restore procedures, verification steps

**Security by design:**
- MySQL: uses `--defaults-file` instead of `-p$PASSWORD` — no password leaks in scripts or logs
- SQLite restore: warns to stop the application first for consistent restore
- Scheduler: recommends systemd timers over cron on VPS/Linux (better logging, failure notification)

**Deployment checklist integration:**
- Backup scripts generated and tested locally
- Backup scheduler active (daily at 02:00)
- Retention configured (14 days default)
- Restore documentation present
- Offsite backup configured (if provider detected)
- First backup completed successfully
- Backup verification passed (restore to temp + integrity check)
- Pre-deploy snapshot taken

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

**Solo developer (default):** Plan approval on, UI verification on (if frontend), everything else off. Build signoff and deploy approval are always on. Backup strategy auto-inferred from stack. Model: opus.

**Team / enterprise:** All oversight on — every phase gets human review, every UI change gets screenshot approval. Backup warnings visible in deploy approval. Model: opus.

**Rapid prototyping:** Plan approval off, slice review off, UI verification off. You still get mandatory build signoff and deploy approval. Backup still inferred — even fast prototypes need a restore plan. Model: sonnet for speed.

## How it works

The full AI workflow automation pipeline:

```
AI Assistant
     │
     ▼
Architecture + Oversight Config + Backup Inference
     │
     ▼
Planning (vertical slices) ─── [planApproval? → STOP]
     │
     ▼
Build (evidence-gated slices) ─── [sliceReview? → STOP after each slice]
     │  ← [uiVerification? → STOP for UI screenshot review]
     │  ← Quality Audit (cadence: every ~3 slices)
     │  ← Code Review (cross-slice consistency)
     ▼
BUILD SIGNOFF [MANDATORY] ─── "Does the product actually work?"
     │
     ▼
E2E Testing (Playwright) ─── [if UI slices + Playwright: MANDATORY]
     │
     ▼
Security Gate (SAST + OWASP) ─── [securitySignoff? → STOP]
     │
     ▼
Whitebox Audit (exploitability analysis)
     │
     ▼
Active Verification (gate-enforced)
     │
     ▼
Release Audit (code review + pre-publish checks)
     │
     ▼
DEPLOY APPROVAL [MANDATORY] ─── "Ready to ship?" + backup status
     │  🛑 Blocks deployment if stateful app has no backup configured
     ▼
Deployment (configs + backup/restore/verify scripts)
```

For multi-phase projects (e.g. Phase 0: Spikes, Phase 1: MVP, Phase 2: Scale), this loop repeats per phase automatically.

```
Phase 0: Plan → Build → BUILD SIGNOFF → E2E Testing → Security → Whitebox → Release Audit → DEPLOY APPROVAL (+ backup check) → Deploy → complete_phase
Phase 1: Plan → Build → BUILD SIGNOFF → E2E Testing → Security → Whitebox → Release Audit → DEPLOY APPROVAL (+ backup check) → Deploy → complete_phase
...
```

1. **Onboarding**: Capture or co-develop the AI software architecture. Detect database and frontend tech. Automatically infer backup strategy from tech stack — databases and uploads get mandatory backup, hosting determines offsite provider. Describe UI via text, upload wireframes/mockups/screenshots, or let AI generate a design concept. Set up companion MCP servers via the MCP protocol. If the architecture defines phases, they get extracted automatically.
2. **Planning**: Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria. Three slice types: `feature` (default), `integration` (library/API adapters with TDD), `infrastructure` (CI, auth, monitoring).
3. **Build Loop**: Evidence-gated slices: RED (write tests) → GREEN (minimal implementation, requires passing tests) → REFACTOR (clean up) → SAST (security scan required) → DONE (requires passing tests). Frontend slices with `hasUI: true` get visual verification via Playwright between GREEN and REFACTOR — when `uiVerification` is on (default for frontend projects), the human reviews screenshots before proceeding. Configurable review checkpoints (`oversight.sliceReview`: `off`, `all`, `ui-only`) pause after slices for human approval. Domain logic triggers a WebSearch step before tests to verify facts (tax rates, regulations, standards). Quality audits run every ~5-10 commits to catch TODOs, debug artifacts, hardcoded secrets, and test coverage gaps. **Code review** checks cross-slice consistency before build signoff. **Mandatory build signoff** after all slices are done — you verify the product works before spending tokens on audit and security. **Structured build log** tracks every tool run with log levels, duration, status, run correlation, and secret redaction — queryable by phase, slice, level, time range, or errors.
4. **Security Gate**: Full SAST scan (static code analysis via Semgrep + Bandit), OWASP Top 10 manual review, dependency audit. Acts as an AI code review tool and AI code scanner for your entire codebase. Fix all critical/high findings.
5. **Whitebox Audit**: Analyzes whether SAST findings are actually exploitable — checks reachable code paths, missing guards, trust boundaries, prompt-only enforcement. Blocking findings prevent deployment (enforced in code, not just prompts).
6. **Active Verification** (gate-enforced): Runtime gate tests that prove workflow invariants hold — state transitions require evidence, deployment gates block correctly, state survives round-trips. Deployment is blocked without a passing active verification.
7. **Release Audit**: Code review pass (cross-file consistency, API coherence) + pre-publish verification — README completeness, temp file cleanup, aggregated SAST/quality findings, build/test pass, .gitignore coverage. Critical findings in the release audit block deployment (enforced in code).
8. **Deployment**: **Mandatory deploy approval** before generating configs. Stack-specific Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, backup strategy docs, hardening guides. Stateful apps are blocked from deployment if no backup is configured. Stack-specific launch checklist. **Automated Hetzner Cloud deployment**: infrastructure planning (server sizing, cloud-init, firewall), provisioning via API, and deployment (rsync + docker compose) — all executed by Claude.

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

## MCP Tools (25)

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
| `a2p_get_build_log` | * | Query structured build log (filter by phase, slice, level, run, time range, errors) |
| `a2p_get_checklist` | * | Pre/post-deployment verification checklist |

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
`/a2p` → `/a2p_planning` → `/a2p_build_slice` (repeat per slice) → `/a2p_audit` (quality) → `/a2p_e2e_testing` (if UI) → `/a2p_security_gate` → `/a2p_whitebox` → `/a2p_audit` (release) → `/a2p_deploy`

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
- `/a2p_deploy` — stack-specific configs, backup/restore/verify scripts, offsite sync, hardening guide

**Built the MVP with slices, now entering Phase 2:**
- `/a2p_planning` — create new slices for the next phase
- `/a2p_build_slice` — TDD per slice as usual

### Adding slices vs. re-planning

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

**Adding a feature to an existing project:** If you have a repo that wasn't built with a2p, you can still use it. Run `/a2p` to onboard the existing codebase, then `/a2p_planning` to create slices for the new feature. A2p detects existing code via codebase-memory and only plans slices for what's missing — it won't rebuild what's already there. The new feature goes through the full pipeline: TDD, SAST, security gate, and deployment.

## Supported Stacks

| Category | Technologies |
|----------|-------------|
| **Languages** | Python, TypeScript/Node.js, Go, Rust, Java/Kotlin, Ruby, PHP, C#/.NET, Dart/Flutter, Swift |
| **Databases** | SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis |
| **Hosting** | Hetzner, DigitalOcean, AWS, Fly.io, Railway, Vercel, Cloudflare, Render, any VPS |

## Supported Deploy Targets

| Target | What A2P generates |
|--------|-------------------|
| **Docker VPS** (Hetzner, DigitalOcean, any VPS) | File generation guidance for Dockerfile, docker-compose.prod.yml, Caddyfile, backup/restore/verify scripts, BACKUP.md, DEPLOYMENT.md. Security hardening checklist. Stack-specific recommendations. **Hetzner Cloud: automated provisioning** — `a2p_plan_infrastructure` computes server sizing + cloud-init + firewall rules, Claude provisions via Hetzner API, `a2p_deploy_to_server` generates rsync/docker deployment commands. |
| **Vercel** | Recommendations (Edge Functions, env vars, preview deploys). Checklist items (project linked, env vars set, preview tested). |
| **Cloudflare** (Pages/Workers) | Recommendations (wrangler.toml bindings, WAF, CDN). Checklist items (NS records, SSL Full Strict, WAF rules). |
| **Railway** | Recommendations (railway up, managed DB add-ons). Checklist items (services configured, env vars, custom domain). |
| **Fly.io** | Recommendations (fly.toml, Volumes, TLS). Checklist items (app created, secrets set, TLS cert). |
| **Render** | Recommendations (render.yaml Blueprint, Private Services). Checklist items (Blueprint deployed, health check, auto-deploy). |

| **Mobile** (Flutter, React Native) | Recommendations only: build commands, TestFlight/Play Store distribution, multi-target coordination (backend first, then mobile). No generated build scripts — mobile toolchains are project-provided. |

Docker VPS targets get full file generation guidance (Dockerfile, compose, Caddy, backup scripts). PaaS targets (Vercel, Railway, Cloudflare, Fly.io, Render) get stack-specific recommendations and deployment checklists — Claude generates the platform-specific config files based on these recommendations. Mobile targets get deployment recommendations and checklists (code signing, release hardening, store submission) but no generated build scripts — A2P orchestrates, mobile toolchains (Xcode, Android Studio, Flutter SDK) are project-provided.

## Companion MCP Servers

a2p auto-configures companion MCP servers based on your tech stack. Each companion is integration-tested against its real server to verify tool availability. These MCP tools extend your AI development tool with specialized capabilities.

### Core (always installed)

| Companion | What it adds | Verified Tools |
|-----------|-------------|----------------|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Code graph intelligence — up to 100x fewer exploration tokens vs. raw file scanning | 11 tools: `index_repository`, `search_graph`, `search_code`, `trace_call_path`, ... |
| [mcp-server-git](https://github.com/modelcontextprotocol/servers) | Git history, commits, diffs | `git_log`, `git_diff`, `git_commit`, `git_status`, ... |
| [@modelcontextprotocol/server-filesystem](https://github.com/modelcontextprotocol/servers) | File operations | 13 tools: `write_file`, `list_directory`, `read_file`, `search_files`, ... |
| [@modelcontextprotocol/server-sequential-thinking](https://github.com/modelcontextprotocol/servers) | Step-by-step reasoning for complex decisions | 1 tool: `sequentialthinking` |

### Conditional (installed based on stack)

| Companion | When | Key Tools |
|-----------|------|-----------|
| [Playwright MCP](https://github.com/microsoft/playwright-mcp) | Frontend projects | `browser_navigate`, `browser_click`, `browser_fill_form`, `browser_take_screenshot`, ... |
| [GitHub MCP](https://github.com/github/github-mcp-server) | GitHub repos | `list_issues`, `create_pull_request`, `search_code`, `get_file_contents`, ... |
| [Supabase MCP](https://github.com/supabase-community/supabase-mcp) | Supabase projects | `execute_sql`, `list_tables`, `apply_migration`, `deploy_edge_function`, ... |
| [@stripe/mcp](https://github.com/stripe/agent-toolkit) | Payment/billing | `create_product`, `create_price`, `create_payment_link`, `create_customer`, ... |
| [@cloudflare/mcp-server-cloudflare](https://github.com/cloudflare/mcp-server-cloudflare) | Cloudflare hosting | `worker_deploy`, `kv_put`, `d1_query`, `r2_put_object`, `zones_list`, `secret_put`, ... |
| [@sentry/mcp-server](https://github.com/getsentry/sentry-mcp-server) | Error tracking | `list_issues`, `get_issue_details`, `find_projects`, `analyze_issue_with_seer`, ... |
| [@upstash/mcp-server](https://github.com/upstash/mcp-server) | Serverless Redis/Queue | `redis_database_run_redis_commands`, `qstash_publish_message`, `workflow_logs_list`, ... |
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
- **vs. manual deployment setup** — Weeks of DevOps vs. generated configs, backup/restore scripts, and verification on day one.
- **vs. vibe coding without a2p** — You ship fast but accumulate security debt, untested features, and manual deployment. a2p is the safety net that makes vibe coding production-viable.

Works alongside autonomous AI agents — a2p adds the engineering rigor (TDD, SAST, deployment) that autonomous AI coding needs.

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 928 tests
npm run build       # Build
npm run dev         # Dev mode
```

## Validation

Full validation results: [`docs/validation/`](docs/validation/)

- Phase A/B: Workflow, state management, and gate enforcement validation (96 QuickBill scenarios)
- Phase C: Real UI tests via Playwright against a running Next.js app (8 browser tests, all pass)
- Phase D/E: Deploy target reality check + companion tool count verification
- README claim verification with gap analysis and corrections

## License

MIT
