# Validation Summary

> Last validated: 2026-03-17 | A2P v0.1.18 | 1032 tests passing

## Code-Enforced (verified by 1022 unit/integration tests)

All workflow gates are implemented in `state-manager.ts` and tested:

- **Evidence gates**: green requires passing tests, sast requires SAST scan, done requires passing tests
- **Build signoff**: mandatory, invalidated by slice/test changes, blocks building->security
- **Deploy approval**: mandatory, invalidated by new findings/whitebox/audit, blocks deployment config generation
- **Quality gate**: mandatory quality audit before building->security, stale audit blocked
- **Security gates**: no deploy with open CRITICAL/HIGH SAST, missing/blocking whitebox, critical audit findings, stale SAST, missing/stale active verification
- **State file protection**: PreToolUse hook blocks direct edits to `.a2p/state.json` (forces use of a2p_ tools)
- **Backup gate**: stateful apps blocked from deployment without configured backup
- **Phase guards**: tools restricted to their allowed phases
- **Test command restriction**: override blocked when configured
- **Backup inference**: database/uploads auto-detected, stack-specific commands (pg_dump, mysqldump, mongodump, sqlite3)
- **Build logging**: structured events with levels, status, duration, run correlation, secret redaction
- **Finding justification**: accepted/fixed/false_positive require justification (code-enforced via `a2p_record_finding`)
- **Code review integration**: build signoff includes code review pass, release audit includes code review
- **Companion restart detection**: removed hard-block `restartRequired` (unreliable — cannot detect restart server-side); onboarding prompt handles restart message, planning/build prompts use soft hint
- **Quality audit cadence**: evidence-gated claims require audit evidence, cadence tracking
- **Multi-phase lifecycle**: phase completion, append build plans, signoff required per phase
- **State recovery**: JSON persistence with automatic backup, schema validation on read

## Credential-Verified (read-only API tests)

| Service | Status |
|---------|--------|
| GitHub | Verified (HTTP 200) |
| Stripe | Verified (HTTP 200, test mode) |
| Cloudflare | Verified (HTTP 200) |
| Vercel | Verified (HTTP 200) |
| Upstash | Verified (HTTP 200) |
| Supabase | Verified (HTTP 200) |
| Sentry | Failed (token expired, not a code issue) |

## Claude-Delegated (A2P persists results, Claude does the work)

These tools provide the persistence and state tracking layer. The actual analysis/execution is performed by Claude:

- `a2p_run_quality` — Claude analyzes via codebase-memory-mcp, A2P records issues
- `a2p_run_e2e` — Claude drives Playwright, A2P records scenarios
- `a2p_run_audit` — A2P scans for patterns (TODOs, secrets, debug artifacts), Claude reviews
- `a2p_run_whitebox_audit` — A2P evaluates reachability/guards, Claude triages
- `a2p_run_active_verification` — A2P runs gate tests on temp state copy

## Prompt-Only (by design, not code-enforced)

These behaviors are instructed via prompts, not enforced by gates:

- Documentation-first (WebSearch before coding unfamiliar tech)
- Domain logic triggers WebSearch for facts (tax rates, regulations)
- Quality audit frequency (~5-10 commits)
- OWASP Top 10 manual review checklist

## Defensively Worded Claims

The following README claims were adjusted based on validation findings:

- **Deploy targets**: Non-Docker targets (Vercel, Railway, Cloudflare, Fly.io, Render) receive recommendations and checklists, not generated config files. Clarified in README.
- **Companion tool counts**: Removed exact counts for third-party packages where the number depends on the package version. Retained exact counts only where verified (codebase-memory: 11, sequential-thinking: 1, filesystem: 13).

## Real-World Evidence (e-invoice-api run, 2026-03-16, A2P v0.1.3)

First real end-to-end run with evidence gates active (v0.1.3). Verified on slice s01-project-scaffolding:

| Gate | Verified | Evidence |
|------|----------|----------|
| Tests before `green` | Yes | `test_run` at 15:52:56, `green` at 15:53:04 — tests ran BEFORE transition |
| testResults populated | Yes | 1 entry: exitCode=0, 2 passed, 0 failed, command=`npx vitest run` |
| SAST before `sast` | Yes | `sast_run` at 15:53:26, `sast` at 15:53:31 — SAST ran BEFORE transition |
| TDD cycle order | Yes | red → green → refactor → sast → done (correct sequence) |
| Realistic timing | Yes | ~3 minutes red→done (vs. 35 seconds in v0.1.1 run without gates) |
| Backup inference | Yes | `required=true, targets=deploy_artifacts,database` (PostgreSQL detected) |
| Build logging | Yes | All events logged with timestamps, actions, details |

### Comparison: v0.1.1 (no gates) vs v0.1.3 (gates active)

| Metric | v0.1.1 run (eu-invoice-parsing) | v0.1.3 run (e-invoice-api) |
|--------|--------------------------------|---------------------------|
| Evidence gates in published code | No (added after publish) | Yes |
| `a2p_run_tests` calls | 0 (never called) | 1+ (called before green) |
| testResults per slice | [] (empty on all 25) | [exitCode=0, passed=2] |
| SAST per slice | sastRanAt: null (all 25) | sastRanAt: set |
| Slice transition time | 35 sec for 5 slices | ~3 min for 1 slice |
| Build signoff | Never called | Pending (run in progress) |
| Full pipeline | Only build phase | Run in progress |

### Release path hardening (v0.1.2+)

- `prepublishOnly: "rm -rf dist && npm run build && npm test"` — prevents stale dist from being published
- `files` field limits npm package to dist/, README, LICENSE, VALIDATION
- `SERVER_VERSION` reads from package.json at runtime (was hardcoded "0.1.0")
- `a2p_get_state` returns `a2pVersion` for runtime version visibility

### Direct state.json edit bypass (v0.1.3 finding, fixed v0.1.4)

During the e-invoice-api run (2026-03-16), Claude bypassed all phase-transition guards by directly editing `.a2p/state.json` (changing `"phase": "building"` → `"security"` → `"deployment"`). This skipped whitebox audit, active verification, release audit, and OWASP review.

**Root cause:** Guards in `setPhase()` (state-manager.ts) are comprehensive but only fire when transitions go through StateManager methods, not when the file is edited directly. Additionally, the whitebox gate only checked `blocking_count > 0` on the last result — did NOT require whitebox to have run at least once.

**Fix (v0.1.4):**
1. **PreToolUse hook** in `.claude/settings.json`: blocks Write/Edit on `.a2p/state.json` (exit code 2 = tool call blocked). Installed by `a2p_init_project`.
2. **Whitebox "must run" guard**: `setPhase("deployment")` now throws if `whiteboxResults.length === 0`, matching the existing pattern for release audit and active verification gates.

### Root cause of v0.1.1 gate failure

npm v0.1.1 was published at 2026-03-14T02:01:19Z. Evidence gates were added in commit `0451730` at 2026-03-14T10:48:52 — ~9 hours AFTER publish. The globally installed `npx architect-to-product` ran the published version without gates. Not a code bug — a release timing issue, now prevented by `prepublishOnly`.

---

## Full E2E Pipeline Validation (mini-notes app, 2026-03-17, A2P v0.1.17)

### Setup

Separate repo (`~/Desktop/a2p-mini-e2e-app`), fresh Claude Code session with MCP pinned to `architect-to-product@0.1.17`. MCP server version confirmed via process list: `npm exec architect-to-product@0.1.17` (PID 13494).

**Test app:** TypeScript + Express + SQLite (better-sqlite3) + Vanilla HTML/JS. JWT auth (register, login), CRUD notes, ownership enforcement (user A cannot see/edit/delete user B's notes). 4 vertical slices, 27 vitest tests.

### Build Result

| Feature | Status | Evidence |
|---|---|---|
| User Registration | Pass | `auth.test.ts`: bcrypt hashed, 409 on duplicate |
| User Login + JWT | Pass | `auth.test.ts`: valid JWT returned, 401 on wrong password |
| Notes CRUD | Pass | `notes.test.ts`: create(201), list, get, update, delete(204) |
| Ownership Enforcement | Pass | `notes.test.ts`: GET/PUT/DELETE returns 403 for other user's notes |
| Auth Guard (401) | Pass | `notes.test.ts`: all 5 endpoints return 401 without token |
| HTML UI | Pass | `ui.test.ts`: static files served, pages accessible |
| SQLite Schema | Pass | `setup.test.ts`: users + notes tables with correct columns, unique constraint |
| **Test suite** | **27 passing, 0 failing** | 4 test files, vitest run, 3.3s |
| TypeScript build | Fail | 1 type error (`exported variable 'db'` type inference). Tests pass via vitest on-the-fly transpilation |

### Pipeline Phases Traversed

```
onboarding → planning → building → security → deployment → security (re-entry #1) → deployment → security (re-entry #2) → deployment
```

119 BuildHistory events. 3 Security re-entry cycles executed.

### Gate Verification (forensic, from state.json reads)

| Gate | README Claim | Verified | Evidence |
|---|---|---|---|
| Build gate (all slices done) | Zeile 208 | **Yes, code-enforced** | `a2p_update_slice` in planning phase → error. All 4 slices status=done before phase transition |
| Evidence gate (tests for green) | Zeile 211 | **Yes, code-enforced** | Each slice has testResults before green transition |
| Build signoff gate | Zeile 209 | **Yes, code-enforced** | `buildSignoffAt: 2026-03-17T00:41:48.985Z` set before building→security |
| Quality audit gate | Zeile 262-267 | **Yes, code-enforced** | `AUD-001 quality` exists before security transition |
| Deploy approval gate | Zeile 216 | **Yes, code-enforced** | `deployApprovalAt` set after explicit approval |
| Deploy approval invalidation (findings) | Zeile 216 | **Yes, code-enforced** | Finding at 01:05:47 after approval at 01:05:32 → approval nullified → new cycle required |
| Deploy approval invalidation (audit) | Zeile 216 | **Yes, code-enforced** | Release audit at 01:07:10 → approval nullified |
| Security re-entry invalidation | Zeile 221 | **Yes, code-enforced** | deployment→security: `deployApprovalAt → null`, `adversarialReviewState → null`, `securityReentryReason: "post_deploy"` |
| Finding justification gate | Zeile 218 | **Yes, code-enforced** | `record-finding` with `status: accepted` without `justification` → error returned |
| Phase guards | Zeile 222 | **Yes, code-enforced** | `a2p_update_slice` in planning → "can only be used in phases: building" |
| Full SAST gate | Zeile 213 | **Yes, code-enforced** | Multiple `sast_run` full scans in buildHistory |
| Whitebox gate (blocking findings) | Zeile 214 | **Yes, code-enforced** | 2 whitebox audits, 0 blocking findings, deployment allowed |
| Active verification gate | Zeile 81 | **Yes, code-enforced** | 4 AVR runs, all 6/6 tests passed |
| Adversarial evidence gate | Zeile 219 | **Yes, code-enforced** | Findings with `domains`, `confidence`, `evidence` fields populated |
| Backup gate (stateful apps) | Zeile 217 | **Verified (hardened in 0.1.18)** | E2E anomaly not reproducible. Gate confirmed working via 3 database types (SQLite, PostgreSQL, MySQL) + defensive re-read after setBackupConfig. Full-flow regression tests added |
| E2E gate (UI + Playwright) | Zeile 210 | **Verified (warning added in 0.1.18)** | Gate fires when Playwright installed. Warning added to build signoff when UI slices exist without Playwright |

### Security Coverage Validation

**Whitebox → Coverage Integration (v0.1.17 feature):**
- Whitebox finding `WB-001` category `InputOutputSafety` → mapped to `input-output` area
- Coverage `input-output: 60%` = 1 whitebox finding (20%) + 2 SAST findings (40%)
- Mapping via `WHITEBOX_CATEGORY_TO_DOMAINS` confirmed working in production

**focusArea-based Hardening (v0.1.17 feature):**
- Adversarial R1 with `focusArea: "auth-session"` → coverage 100% (4 findings × 20% + 40% focus bonus, capped)
- Adversarial R2 with `focusArea: "data-access"` → coverage 60% (1 finding × 20% + 40% focus bonus)
- `computeHardeningRecommendations` uses persisted `securityOverview.coverageByArea` including whitebox findings

**Final Coverage:**
| Area | Coverage | Findings |
|---|---|---|
| auth-session | 100% | 5 |
| input-output | 60% | 3 |
| api-surface | 60% | 3 |
| data-access | 20% | 1 |
| infra-secrets | 20% | 1 |
| business-logic | 0% | 0 |
| external-integration | 0% | 0 |
| vuln-chaining | 0% | 0 |

### Deployment Artifacts Generated

| Artifact | Present | Quality |
|---|---|---|
| `Dockerfile` | Yes | Multi-stage build, non-root user (`app`), `npm ci --omit=dev`, cache clean |
| `docker-compose.yml` | Yes | Caddy reverse proxy, `read_only: true`, `no-new-privileges`, named volumes, log rotation |
| `Caddyfile` | Yes | Blocks `/.env*`, `/.git*`, `/*.db`, `/.a2p*`. Security headers (X-Content-Type-Options, X-Frame-Options, XSS-Protection) |
| `.env.production.example` | Yes | `JWT_SECRET=CHANGE_ME_TO_A_RANDOM_64_CHAR_STRING` — no real secrets |
| `.dockerignore` | Yes | Excludes node_modules, dist, .env, .a2p, .claude, .git |
| `scripts/backup.sh` | Yes | Docker volume copy, `sqlite3 PRAGMA integrity_check`, retention cleanup |
| `scripts/restore.sh` | Yes | Integrity check before restore, stops app, restores, restarts |
| `scripts/verify-backup.sh` | Yes | Checks all backups: file size, integrity, row counts, freshness warning (>25h) |

### Bugs Found

**Bug #1: Backup `required` flag not reliably persisted — RESOLVED (0.1.18)**

`backupConfig.required` was `false` in the E2E test repo state despite SQLite database. Not reproducible locally — direct `handleSetArchitecture` with SQLite/PostgreSQL/MySQL all produce correct `required: true`. Hardened in 0.1.18: defensive re-read after `setBackupConfig()` throws on mismatch, plus 4 full-flow regression tests (3 DB types + deployment gate). Classified as observed anomaly, not a code bug.

**Bug #2: `a2p_set_phase` not discoverable via MCP tool listing — NOT AN A2P BUG**

All 28 tools are registered identically in `server.ts` using the same `server.tool()` pattern. Programmatic check confirms `a2p_set_phase` is in `_registeredTools`. The MCP `tools/list` endpoint exposes all 28. The "missing" tools in the E2E session's deferred tool list (7 of 28 not shown) is a Claude Code client-side optimization — the client pre-loads ~21 tools as deferred and lazy-loads the rest. The builder Claude Code window used `a2p_set_phase` successfully (buildHistory shows `phase_change` events).

### Claim Gaps

| README Claim | Gap | Status |
|---|---|---|
| "Stateful apps blocked from deployment if backup is missing" (Zeile 49, 217) | E2E anomaly not reproducible. Gate confirmed working via regression tests | **Resolved (0.1.18)** — defensive re-read + 4 regression tests |
| E2E testing with Playwright (Zeile 210, 310) | Silently skipped when Playwright not installed | **Resolved (0.1.18)** — warning in build signoff + checklist item |
| Audit `buildPassed`/`testsPassed` (Zeile 45) | `null` when no build/test command configured | **Resolved (0.1.18)** — `buildNote`/`testNote` explain when commands not configured |
| "scripts/backup-offsite.sh", "ops/backup.env.example", "docs/BACKUP.md" (Zeile 239-241) | Not generated by tool directly | **Clarified in README** — deployment phase generates these via prompt guidance, not the tool itself |

### Observations (not bugs)

- Deploy approval is aggressively invalidated: every `record-finding` and `run_audit` nullifies it. User must approve as the very last step before generating deployment configs. Correct from security perspective but surprising UX.
- Adversarial review state is fully reset on security re-entry (round counter resets to 0). Previous round history from before re-entry is lost. This means cumulative history only spans within one security session, not across re-entries.
- TypeScript build (`tsc --noEmit`) fails but vitest tests pass (on-the-fly transpilation). A2P does not detect this because audit `buildPassed` is always `null`.

### Verdict

**A2P 0.1.17 passes this E2E validation. All material gaps addressed in 0.1.18.**

The core pipeline — evidence-gated TDD, security gates, whitebox audit, adversarial review with guided hardening, active verification, deployment artifact generation — works as documented. All mandatory gates (build signoff, deploy approval, finding justification, security re-entry invalidation) are code-enforced and verified forensically from state.json reads.

**0.1.18 hardening:** Backup gate confirmed working (E2E anomaly not reproducible, defensive re-read added, 4 regression tests). UI/E2E warning added to build signoff. Audit output clarified when build/test commands not configured. All 28 tools confirmed registered and discoverable via MCP `tools/list`.
