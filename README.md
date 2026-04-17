# A2P — Architect-to-Product
AI engineering framework delivered as an MCP server. Turns AI-generated code into production-ready software with evidence-gated systems engineering, TDD, security review, backup strategy, and deployment automation.

**A2P v2: Evidence-gated AI systems engineering.** On top of the existing v1 delivery flow (hardening triad → test-first guard → completion review → security + deployment gates), v2 adds structured per-concern artifacts and code-enforced gates for thirteen systems-engineering concerns (data_model, invariants, state_machine, api_contracts, auth_permissions, failure_modes, observability, performance_under_load, migrations, concurrency_idempotency, distributed_state, cache_invalidation, security). Applicability is deterministic; the state-manager blocks `pending → ready_for_red` and `sast → done` when evidence is missing. No v1 behavior was removed. State version bumped 1 → 2 with backward-compatible migration.

**37 MCP tools · 1448 tests · Dogfood-validated (153/158 rubric, 50/50 adversarial) · Architecture → Plan → Build → Audit → Security → Deploy**

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Tests: 1448 passing](https://img.shields.io/badge/tests-1448%20passing-brightgreen)](docs/validation/) [![Dogfood: 97%](https://img.shields.io/badge/dogfood-153%2F158%20(97%25)-blue)](#dogfood-validation) [![TypeScript](https://img.shields.io/badge/TypeScript-blue)](tsconfig.json)
[![SafeSkill 76/100](https://img.shields.io/badge/SafeSkill-76%2F100_Passes%20with%20Notes-yellow)](https://safeskill.dev/scan/bernhardjackiewicz-architect-to-product)

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

During build, each feature (called a "slice") runs through the **native flow** — every step enforced in code, with a concrete tool call behind each gate:

**requirement hardening → test hardening → plan hardening (1–3 adversarial rounds + finalize) → ready_for_red → test-first guard → RED → GREEN → REFACTOR → SAST → completion review loop → DONE**

That means:
- Acceptance criteria, test matrix, and implementation plan are captured as structured artifacts with cascading hash invalidation before any code is written.
- A test-first guard (`a2p_verify_test_first`) diff-classifies the worktree against a baseline commit or file-hash snapshot and requires ≥1 test file touched, 0 production files touched, and a failing test run — it won't let the slice reach RED otherwise.
- A completion review loop (`a2p_completion_review`) runs after SAST. A2P auto-scans the diff for stub signals, diff-checks the implementation against `finalPlan.expectedFiles` and `interfacesToChange`, and enforces verdict consistency: any non-"met" AC, non-"deep" coverage, non-"ok" plan compliance, or unjustified stub signal forces NOT_COMPLETE and loops the slice back through `completion_fix` with a refreshed baseline.
- **State transitions are enforced in code, not just described in prompts.**

The AI agent cannot skip a gate. If it tries to advance without meeting the conditions, the state machine throws an error pointing at the missing tool call. The exception is a one-per-project **bootstrap slice** (marked `bootstrap: true`) that runs a legacy flow and is used only for A2P's own self-rebuild.

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

### Dogfood validation

A2P's native flow has been validated end-to-end by running A2P against itself in a controlled sandbox with hidden adversarial test suites and independent observer scoring.

| Metric | Run 1 | Run 2 (after bug fixes) |
|---|---|---|
| Hidden adversarial tests | 50/50 (100%) | 43/44 (98%) |
| Rubric total (strict) | 146/158 (92.4%) | 153/158 (97%) |
| Gate compliance (10 checks/slice) | 10/10 every slice | 10/10 every slice |
| Schublade-2 trap classes caught | 6/6 | 5/6 clean + 1 partial |
| Agent beat reference implementation | 3/6 scenarios | — |

**6 scenarios tested**: pure function (divide), HTTP integration (webhook), date parser (10 edge-case pitfalls), retry with abort (plan critique depth), median (semantic correctness trap), trivial constant (over-engineering trap).

**Key finding**: The hardening triad (requirements → tests → plan) is load-bearing, not ceremonial. Agents consistently anticipated edge cases that were absent from the reference implementations — including signed-zero IEEE-754 semantics, abort-mid-delay race conditions, year-0 Date.UTC quirks, and the even-length median trap. The 40–60% Schublade-2 improvement estimate from [docs/QUALITY-IMPACT.md](docs/QUALITY-IMPACT.md) is supported by the evidence; observed capture rate is closer to 60–70%.

**Real-world trial**: One slice (German phone number normalizer) built through the full native flow on the Handwerk CRM codebase (121 existing slices). Plan-hardening rounds 1–2 found two real algorithm bugs before any code was written: a plus-sign stripping order-of-operations error and an Austrian 0043-prefix misclassification.

→ Full dogfood artifacts: `a2p-dogfood/OBSERVATIONS-SUMMARY.md`, per-scenario scorecards in `a2p-dogfood/observations/`

---

## Known Limitations

A2P's gates are strong forcing functions, not absolute proof. This section is the honest list of things A2P **cannot** do, things it does **imperfectly**, and things that are **intentionally conservative**. Read it before relying on A2P for high-stakes production work.

> For a non-technical overview of *what the native flow actually improves* (and what it doesn't), see [docs/QUALITY-IMPACT.md](docs/QUALITY-IMPACT.md).

### Workflow & enforcement

- **A2P cannot stop manual `.a2p/state.json` mutation.** Any client-side state store can be edited out-of-band. Every gate described in [`docs/WORKFLOW.md`](docs/WORKFLOW.md) is enforced when tools are called through A2P — not when state is written directly. Treat the state file as trusted input from your own workflow.
- **A2P cannot verify that plan-hardening rounds are genuinely adversarial.** The 3-round cap with structural requirements is the limit of enforceable rigor. A rubber-stamped critique that fills the fields passes the gate. The model doing the work is responsible for actual adversariality; A2P only forces the artifact to exist.
- **A2P cannot verify that a `"met"` AC coverage claim is honest.** The completion review forces the model to make the claim explicitly, cross-referenced with fresh test and SAST runs — but "I ran the tests, they pass, AC met" is self-report at the end of the day.

### Diff-based guards (test-first, plan compliance, stub scan)

- **`.gitignore` parser is a simple subset.** Supports literal files, directory patterns (`build/`), and simple wildcards (`*.log`). Does **not** support negation (`!pattern`), nested `.gitignore` files, or full glob semantics. If you rely on complex ignore rules, use A2P inside a git repo — the git-backed diff path uses `git diff` directly and honors the full ignore spec.
- **File-hash baseline is capped at 50 000 files.** Projects larger than that will have partial baselines in the non-git fallback. Diffs may miss files beyond the cap. Recommendation: use A2P inside git for projects of any non-trivial size.
- **Symlinks are ignored in the file-hash fallback.** The baseline snapshot never follows symlinks — neither hashing them nor traversing through them. This is deliberate: symlinks create loop risks, can leak contents from outside the project tree, and have unstable targets. If you need symlink-aware diffing, use the git-backed path (git handles symlinks as target-text references). In non-git projects, symlinks are effectively invisible to A2P's baseline/diff logic.
- **Python `pass`-only stub detector matches single-line `def` signatures only.** A function with a multi-line signature (e.g. `def foo(\n    a,\n    b\n):\n    pass`) will not be flagged. Plain `def foo(): pass` — caught. `async def`, class methods, etc. — caught.
- **Plan-compliance interface-change scan is regex-based, TypeScript/JavaScript only.** It extracts exported symbols via a regex over `export function|const|class|interface|type|enum` declarations in changed `.ts`/`.tsx`/`.js`/`.jsx`/`.mjs`/`.cjs` files. Non-TS/JS files are checked at file granularity (`unplannedFiles`) but not at symbol level. Sufficiently creative refactors across non-TS files can drift without being flagged in `unplannedInterfaceChanges`.
- **Stub scan is pattern-based — cleverly disguised stubs escape.** A function that returns a hardcoded canned value matching the happy-path test will not be flagged by any of the patterns (TODO/FIXME/NotImplementedError/pass-only/etc.). Self-report via `shortcutsOrStubs` in the completion review is the complementary channel; it is enforced structurally (any non-empty → NOT_COMPLETE) but not semantically.

### Test infrastructure escape hatch

- **`StateManager.forceLegacyFlowForTests` is a static class field in production code** that, when set to `true`, disables the hardening triad and test-first guard for all non-bootstrap slices. It exists so legacy test suites can walk slices through the old `pending → red` path without seeding full hardening artifacts. It defaults to `false`, is never set from production code paths, and is visible only to test helpers (`useLegacySliceFlow()` in `tests/helpers/setup.ts`). A malicious or accidental write to this field from outside the test suite would silently disable the gates — treat it as a known test-only escape that should not exist in a future audit-hardened version.

### Self-rebuild verification

- **A2P has been dogfood-validated end-to-end** across 2 full runs (6 scenarios each) and 1 real-world trial on a 121-slice production codebase. The end-to-end loop — agent follows prompt → prompt routes through tools → tools update state → next step read from state — has been exercised with independent observer scoring against hidden adversarial test suites. Results: 50/50 hidden tests (run 1), 153/158 rubric (run 2, 97%), 10/10 gate compliance per slice. 6 gate-machinery bugs were found and fixed across 2 dogfood cycles; the methodology itself (hardening triad + test-first guard + completion review) was validated as load-bearing. See [Dogfood validation](#dogfood-validation) for full results.

### Platform notes

- **Windows is not in the CI matrix.** The codebase targets macOS and Linux; `fs.symlinkSync`-based tests may behave differently on Windows (where symlinks require admin or Developer Mode).

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
| `/a2p_build_slice` | Build the current slice through the native flow (hardening → test-first guard → RED → GREEN → REFACTOR → SAST → completion review → DONE) + mandatory build signoff |
| `/a2p_refactor` | Code quality tool — analyze codebase for dead code, redundancy, coupling |
| `/a2p_e2e_testing` | AI testing tool — run visual E2E tests with Playwright |
| `/a2p_security_gate` | Full SAST scan + OWASP Top 10 review |
| `/a2p_whitebox` | Whitebox security audit + active verification |
| `/a2p_audit` | Quality audit (dev hygiene) or release audit (pre-publish) |
| `/a2p_deploy` | Generate deployment configs and launch checklist |

---

## Documentation

- [Workflow and lifecycle](docs/WORKFLOW.md) — state machine, gates, oversight, re-entry, multi-phase
- [Quality impact](docs/QUALITY-IMPACT.md) — honest assessment of what the native flow buys you (non-technical)
- [Security model](docs/SECURITY.md) — SAST, whitebox, Shake & Break, security coverage, findings
- [Reference](docs/REFERENCE.md) — tools, prompts, stacks, companions, model preference
- [Deployment (Hetzner / VPS)](docs/HETZNER-DEPLOYMENT.md) — Docker VPS, Hetzner Cloud, 3-layer backup
- [Validation](docs/validation/) — claim verification, test evidence, reality checks

<details>
<summary>MCP Tools reference (37 tools)</summary>

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
| `a2p_update_slice` | 2 | Update slice status through the native flow (pending / ready_for_red / red / green / refactor / sast / completion_fix / done) with hardening + test-first + completion-review gates |
| `a2p_harden_requirements` | 2 | Record hardened requirements and overwrite slice AC; cascades invalidation of downstream hardening |
| `a2p_harden_tests` | 2 | Record hardened test matrix; rejects integration/UI slices without a real-service concern |
| `a2p_harden_plan` | 2 | Record adversarial plan-hardening rounds (1..3) and finalize with a structured `finalPlan` |
| `a2p_verify_test_first` | 2 | Diff-classify the worktree against the slice baseline, run the test command, enforce test-first discipline |
| `a2p_completion_review` | 2 | Record a completion review with stub scan + plan compliance + verdict consistency |
| `a2p_get_slice_hardening_status` | * | Read-only hardening + guard + review status for a slice |
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

## Changelog

| Version | Highlights |
|---|---|
| **1.1.0** | **Native slice hardening.** 6 new MCP tools (`a2p_harden_requirements`, `a2p_harden_tests`, `a2p_harden_plan`, `a2p_verify_test_first`, `a2p_completion_review`, `a2p_get_slice_hardening_status`). New statuses `ready_for_red` and `completion_fix`. Diff-based test-first guard with git + file-hash fallback. Completion review loop with plan-compliance scanner, automated stub scan, and verdict-consistency enforcement. Bootstrap flag for one-per-project legacy-flow exemption. Plan-hardening archive (`previousPlanHardenings`) preserves audit trail across cascade re-hardens. A2P metadata files (`.claude/`, `CLAUDE.md`, `.mcp.json`, `.gitignore`) excluded from test-first production-file classification. `completion_fix` auto-passes `verify_test_first` when tests are already green (prevents infinite loop on external-drift recovery). Prose `interfacesToChange` entries matched via bare-identifier extraction; type-only exports from planned files tolerated. Dogfood-validated: 50/50 adversarial tests, 153/158 rubric (97%), 6/6 Schublade-2 trap classes caught. 1351 tests (up from 1097). |
| **1.0.10** | Companion `config` written as `env` block in `.mcp.json` (fixes Supabase MCP crash). Supabase Cloud vs Local onboarding. Companion health warnings in `a2p_get_state`. |
| **1.0.5–1.0.9** | Gate hardening: mandatory hard stops for SSL, secret management, and security decisions. Anthropic frontend aesthetics enforcement for UI slices. IP-only SSL path. E2E full-cycle tests. Coverage dashboard at security gate. Docs unified to English. |
| **1.0.4** | SSL/HTTPS verification gate (`a2p_verify_ssl`). Deployment and phase completion blocked without SSL proof. |
| **1.0.3** | SAST excludes build artifacts. Finding dedup fix. Secret management tool (`a2p_set_secret_management`). Adversarial review requires confirmation code. |
| **1.0.2** | README restructured. Tool count corrected to 27. Upgrade notes added. |
| **1.0.1** | Fixed duplicate audit/SAST/whitebox events. `pendingSecurityDecision` enforced as deployment gate. |

---

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 1351 tests
npm run build       # Build
npm run dev         # Dev mode
```

**Running Claude Code against your local build.** The committed
`.mcp.json` pins to the published npm version so contributors and
external users always get a stable server. When you want Claude Code
to load your in-progress `dist/` instead, copy
`.mcp.local.json.example` to an out-of-repo override
(`~/.claude/settings.local.json` or a private `.mcp.local.json` you
gitignore) and edit the absolute path. The local override takes
precedence over the committed `.mcp.json`. Restart Claude Code after
any `npm run build` to pick up a fresh `dist/`.

---

## License

MIT
