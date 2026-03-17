# A2P Workflow and Lifecycle

This document covers the full A2P project lifecycle: phases, gates, oversight configuration, and re-entry rules.

---

## Lifecycle Overview

```
onboarding → planning → building → security → deployment → complete
                ↑           ↓          ↑            ↓
                └── refactoring    ←───┘     (re-entry: full
                        ↓                    security cycle
                   e2e_testing               required again)
```

Each arrow is a gate — a set of conditions that must be met before the transition is allowed. Gates are enforced in code, not prompts. The AI agent cannot skip them.

---

## Phase Descriptions

### 0. Onboarding

Capture or co-develop the AI software architecture. Detect database and frontend tech. Automatically infer backup strategy from tech stack — databases and uploads get mandatory backup, hosting determines offsite provider. Describe UI via text, upload wireframes/mockups/screenshots, or let AI generate a design concept. Set up companion MCP servers via the MCP protocol. If the architecture defines phases, they get extracted automatically.

### 1. Planning

Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria. Three slice types: `feature` (default), `integration` (library/API adapters with TDD), `infrastructure` (CI, auth, monitoring).

### 2. Build Loop

Evidence-gated slices: RED (write tests) → GREEN (minimal implementation, requires passing tests) → REFACTOR (clean up) → SAST (security scan required) → DONE (requires passing tests).

Frontend slices with `hasUI: true` get visual verification via Playwright between GREEN and REFACTOR — when `uiVerification` is on (default for frontend projects), the human reviews screenshots before proceeding. Configurable review checkpoints (`oversight.sliceReview`: `off`, `all`, `ui-only`) pause after slices for human approval. Domain logic triggers a WebSearch step before tests to verify facts (tax rates, regulations, standards). Quality audits run every ~5-10 commits to catch TODOs, debug artifacts, hardcoded secrets, and test coverage gaps. **Code review** checks cross-slice consistency before build signoff. **Mandatory build signoff** after all slices are done — you verify the product works before spending tokens on audit and security. **Structured build log** tracks every tool run with log levels, duration, status, run correlation, and secret redaction — queryable by phase, slice, level, time range, or errors.

### 3. Security Gate

Full SAST scan (static code analysis via Semgrep + Bandit), dependency scanning (`npm audit`/`pip-audit`), OWASP Top 10 manual review. Fix all critical/high findings.

### 4. Whitebox Audit

Analyzes whether SAST findings are actually exploitable — checks reachable code paths, missing guards, trust boundaries, prompt-only enforcement. Blocking findings prevent deployment (enforced in code, not just prompts). Includes deterministic probes and evidence-based adversarial review.

### 5. Active Verification

Runtime gate tests that prove workflow invariants hold — state transitions require evidence, deployment gates block correctly, state survives round-trips. Deployment is blocked without a passing active verification.

### 5b. Shake & Break (optional)

Active runtime adversarial testing. Creates an isolated sandbox (git worktree + generated .env with neutralized external services + ephemeral port + optional Docker DB). Claude starts the app and sends real HTTP requests across 8 categories: auth/IDOR, race conditions, state manipulation, business logic, injection, token/session, file upload, webhook security. Findings are evidence-backed with actual request/response proof.

### 6. Release Audit

Code review pass (cross-file consistency, API coherence) + pre-publish verification — README completeness, temp file cleanup, aggregated SAST/quality findings, build/test pass, .gitignore coverage. Critical findings block deployment (enforced in code).

### 7. Deployment

Mandatory deploy approval before generating configs. Secret management tier must be chosen (4 tiers: env-file, Docker Swarm secrets, Infisical, external). Stack-specific Dockerfile, docker-compose, Caddyfile, backup/restore/verify scripts, backup strategy docs, hardening guides. Artifact security validation checks every generated file. Stateful apps are blocked from deployment if no backup is configured. SSL/HTTPS must be verified via `a2p_verify_ssl` before deployment can be marked complete — Caddy handles Let's Encrypt auto-renewal automatically, PaaS platforms handle SSL automatically.

---

## Slice TDD Cycle

Each feature ("slice") follows an evidence-gated TDD cycle:

```
RED → GREEN → REFACTOR → SAST → DONE
```

1. **Red** — Write failing tests that define what the feature should do. No production code yet.
2. **Green** — Minimal implementation to make tests pass. Requires passing test evidence.
3. **Refactor** — Clean up while keeping tests green.
4. **SAST** — Static analysis scan for security vulnerabilities.
5. **Done** — Tests pass again after refactoring. The slice is complete.

Each transition is evidence-gated — enforced in code, not just in prompts. You can't skip to "green" without test results. You can't skip to "done" without passing tests.

---

## Gates

| Gate | What it checks | Enforcement |
|------|---------------|-------------|
| **Build gate** | All slices must be `done` | Code-enforced |
| **Build signoff** | Human confirms product works (`a2p_build_signoff`). Invalidated by slice changes or new test runs | Code-enforced |
| **E2E gate** | Projects with UI slices + Playwright cannot skip E2E testing | Code-enforced |
| **Evidence gates** | Cannot mark slice `green` without passing tests, `sast` without SAST scan, `done` without passing tests | Code-enforced |
| **Security gate** | Cannot deploy with open CRITICAL/HIGH SAST findings | Code-enforced |
| **Full SAST gate** | At least one full SAST scan required before deployment | Code-enforced |
| **Whitebox gate** | Cannot deploy with blocking whitebox findings | Code-enforced |
| **Audit gate** | Cannot deploy with critical release audit findings | Code-enforced |
| **Deploy approval** | Human approves deployment (`a2p_deploy_approval`). Invalidated by new findings — must be last step | Code-enforced |
| **Backup gate** | Stateful apps blocked from deploying without backup configured | Code-enforced |
| **Secret management gate** | Secret management tier must be chosen (`a2p_set_secret_management`) before generating deployment configs | Code-enforced |
| **SSL gate** | SSL/HTTPS must be verified (`a2p_verify_ssl`) before deployment can be marked complete. Invalidated when infrastructure domain changes | Code-enforced |
| **Finding justification** | Cannot dismiss findings without justification | Code-enforced |
| **Adversarial evidence** | High/critical adversarial findings require confidence + file:line evidence | Code-enforced |
| **Phase guards** | Tools restricted to appropriate phases | Code-enforced |
| **Test command restriction** | Test command override blocked when configured | Code-enforced |
| **Companion restart** | `a2p_get_state` reports when restart is needed | Code-enforced |
| **Security re-entry** | Re-entering security invalidates all prior approvals | Code-enforced |

### Phase Transition Table

| Transition | MCP Tool? | Code Enforcement? |
|---|---|---|
| onboarding → planning | Yes (`a2p_create_build_plan`) | Yes |
| planning → building | No (prompt-guided) | Yes (SM.setPhase + Guards) |
| building → security | No (prompt-guided) | Yes (SM.setPhase + Signoff + Quality Gate) |
| security → deployment | No (prompt-guided) | Yes (SM.setPhase + SAST/Whitebox/Audit/Verification/Backup Gates) |
| deployment → complete | No (prompt-guided) | Yes (SM.setPhase + SSL Gate) |

Phase transitions that lack a dedicated MCP tool are prompt-guided — the AI agent calls `a2p_set_phase` based on prompt instructions. All transitions enforce their gate conditions in code regardless.

---

## Human Oversight Configuration

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

### Recommended Configurations

**Solo developer (default):** Plan approval on, UI verification on (if frontend), everything else off. Build signoff and deploy approval are always on. Backup strategy auto-inferred from stack. Model: opus.

**Team / enterprise:** All oversight on — every phase gets human review, every UI change gets screenshot approval. Backup warnings visible in deploy approval. Model: opus.

**Rapid prototyping:** Plan approval off, slice review off, UI verification off. You still get mandatory build signoff and deploy approval. Backup still inferred — even fast prototypes need a restore plan. Model: sonnet for speed.

---

## Prompt-Guided Behaviors

Some behaviors are enforced via prompts rather than code gates. This is by design — Claude follows the prompt instructions:

| Behavior | Prompt | Notes |
|---|---|---|
| Documentation-first (WebSearch before code) | `/a2p_build_slice` | No code gate |
| Domain logic triggers WebSearch | `/a2p_build_slice` | No code gate |
| Quality audits every ~5-10 commits | `/a2p_build_slice` | No commit counter |
| OWASP Top 10 manual review | `/a2p_security_gate` | No code gate |

These are not bugs — they represent behaviors where prompt-level enforcement is appropriate and code-level enforcement would add complexity without meaningful benefit.

---

## Security Re-Entry

After deployment or completion, transition back to security for re-scans. All prior approvals are automatically invalidated:

- Deploy approval → nullified
- Adversarial review → nullified
- SAST timestamps → nullified

The full security cycle must be re-satisfied before deploying again. This prevents deploying with stale security evidence after code changes.

---

## Multi-Phase Projects

For multi-phase projects (e.g. Phase 0: Spikes, Phase 1: MVP, Phase 2: Scale), the lifecycle loop repeats per phase:

```
Phase 0: Plan → Build → BUILD SIGNOFF → E2E Testing → Security → Whitebox → [Shake & Break] → Release Audit → DEPLOY APPROVAL → Deploy → complete_phase
Phase 1: Plan → Build → BUILD SIGNOFF → E2E Testing → Security → Whitebox → [Shake & Break] → Release Audit → DEPLOY APPROVAL → Deploy → complete_phase
...
```

Use `a2p_complete_phase` to finish the current phase and advance to the next.

---

## Security-Only Mode

For existing repos that just need security scanning, skip the build phase entirely:

```
init → set_architecture → security
```

No slices, no build signoff — findings are stored at project level.

---

## Full Pipeline Diagram

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
[Shake & Break] (optional — runtime adversarial testing in sandbox)
     │
     ▼
Release Audit (code review + pre-publish checks)
     │
     ▼
DEPLOY APPROVAL [MANDATORY] ─── "Ready to ship?" + backup status
     │  🛑 Blocks deployment if stateful app has no backup configured
     ▼
Secret Management Tier [MANDATORY] ─── env-file / docker-swarm / infisical / external
     │
     ▼
Deployment (configs + backup/restore/verify scripts)
     │
     ▼
SSL VERIFICATION [MANDATORY] ─── a2p_verify_ssl (HTTPS + auto-renewal confirmed)
     │  🛑 Blocks deployment→complete without SSL verification
     │
     ├──→ Security Re-Entry ──→ Security Gate (re-scan after changes)
     │    (invalidates prior approvals, forces full security cycle)
     ▼
Complete
     │
     └──→ Security Re-Entry ──→ Security Gate (post-release audit)
```
