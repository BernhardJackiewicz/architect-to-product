# Validation Summary

> Last validated: 2026-03-16 | A2P v0.1.3 | 858 tests passing

## Code-Enforced (verified by 858 unit/integration tests)

All workflow gates are implemented in `state-manager.ts` and tested:

- **Evidence gates**: green requires passing tests, sast requires SAST scan, done requires passing tests
- **Build signoff**: mandatory, invalidated by slice/test changes, blocks building->security
- **Deploy approval**: mandatory, invalidated by new findings/whitebox/audit, blocks deployment config generation
- **Quality gate**: mandatory quality audit before building->security, stale audit blocked
- **Security gates**: no deploy with open CRITICAL/HIGH SAST, blocking whitebox, critical audit findings, stale SAST, missing/stale active verification
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

### Root cause of v0.1.1 gate failure

npm v0.1.1 was published at 2026-03-14T02:01:19Z. Evidence gates were added in commit `0451730` at 2026-03-14T10:48:52 — ~9 hours AFTER publish. The globally installed `npx architect-to-product` ran the published version without gates. Not a code bug — a release timing issue, now prevented by `prepublishOnly`.
