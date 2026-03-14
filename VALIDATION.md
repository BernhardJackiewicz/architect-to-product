# Validation Summary

> Last validated: 2026-03-14 | A2P v0.1.1 | 737 tests passing

## Code-Enforced (verified by 737 unit/integration tests)

All workflow gates are implemented in `state-manager.ts` and tested:

- **Evidence gates**: green requires passing tests, sast requires SAST scan, done requires passing tests
- **Build signoff**: mandatory, invalidated by slice/test changes, blocks building->security
- **Deploy approval**: mandatory, invalidated by new findings/whitebox/audit, blocks deployment config generation
- **Security gates**: no deploy with open CRITICAL/HIGH SAST, blocking whitebox, critical audit findings, or stale SAST
- **Phase guards**: tools restricted to their allowed phases
- **Test command restriction**: override blocked when configured
- **Backup inference**: database/uploads auto-detected, stack-specific commands (pg_dump, mysqldump, mongodump, sqlite3)
- **Build logging**: structured events with levels, status, duration, run correlation, secret redaction
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
