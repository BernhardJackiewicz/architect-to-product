# README Gaps — Updated After Phase A-E

> As of: 2026-03-14 (after credential tests + gap closure)
> Basis: 96 QuickBill tests + 737 existing tests + 7 credential API tests + 6 code inspections

---

## 1. Closed Gaps (Since First Run)

These gaps were verified in Phase A/B and are now covered:

| Gap | Result | Method |
|---|---|---|
| Prompt count (9 claimed) | **VERIFIED** — exactly 9 | server.ts code inspection |
| uiDesign parameter | **VERIFIED** — schema + storage | set-architecture.ts code inspection |
| MySQL --defaults-file | **VERIFIED** — no password leak | generate-deployment.ts line 211 |
| MongoDB --uri --gzip | **VERIFIED** — correct | generate-deployment.ts line 213 |
| Fly.io guidance | **VERIFIED** — 2 recs + 3 checklist | Code inspection |
| Render guidance | **VERIFIED** — 3 recs + 3 checklist | Code inspection |
| GitHub API | **VERIFIED** — HTTP 200 | Live API call |
| Stripe API | **VERIFIED** — HTTP 200, test mode | Live API call |
| Cloudflare API | **VERIFIED** — HTTP 200 | Live API call |
| Vercel API | **VERIFIED** — HTTP 200 | Live API call |
| Upstash API | **VERIFIED** — HTTP 200 | Live API call |
| Supabase API | **VERIFIED** — HTTP 200 | Live API call |
| codebase-memory: 11 tools | **VERIFIED** — exactly 11 | Session count |
| sequential-thinking: 1 tool | **VERIFIED** — exactly 1 | npm readme |

---

## 2. README Corrections Needed (INACCURATE)

Claims in the README that do not match the code.

### 2.1 Deploy Target File Generation (HIGH)

**Problem**: README suggests that A2P generates target-specific config files for each deploy target (vercel.json, fly.toml, render.yaml, wrangler.toml). However, the code returns the same Docker-oriented `filesToGenerate` for ALL targets — including Vercel, Cloudflare, etc.

**What actually happens**:
- Docker VPS (Hetzner, DO, generic): File descriptions for Dockerfile, docker-compose, Caddyfile, backup scripts — **correct**
- Vercel/Railway/Cloudflare/Fly.io/Render: Receive text recommendations + checklist items, but NO platform-specific file descriptions

**Recommendation**: Either correct the README (clarify: recs + checklist, no config files) or extend the code (platform-specific filesToGenerate).

**Status (2026-03-14)**: README table already corrected — PaaS targets say "Recommendations" + "Checklist items". Code bug (Docker filesToGenerate for all targets) still exists, but is no longer misleading due to README wording.

### 2.2 Cloudflare Tool Count (MEDIUM)

**Claim**: 85 tools
**Verified**: 61 tools (npm readme, count across all categories)
**Difference**: 39% overstated

### 2.3 Filesystem Tool Count (LOW)

**Claim**: 14 tools
**Verified**: 13 tools (npm readme)
**Difference**: 1 tool too many

### 2.4 GitHub Tool Count (LOW)

**Claim**: 41 tools
**Verified**: 26 tools (in the old npm version, which is deprecated)
**Status**: New Go version (github/github-mcp-server) may have 41, but is not verifiable via npm

---

## 3. Failed (FAILED)

| Item | Status | Reason |
|---|---|---|
| Sentry token | 401 Unauthorized | Token expired or needs region endpoint (de.sentry.io instead of sentry.io) |
| Atlassian | Not testable | Only cloud ID available, no auth token |

---

## 4. Prompt-Only Claims (By Design, No Code Fix Needed)

Claims that exist only in prompts. This is by design — Claude follows the prompts.

| Claim | Prompt | Enforcement |
|---|---|---|
| Documentation-first (WebSearch before code) | `/a2p_build_slice` | No code gate |
| Domain logic triggers WebSearch | `/a2p_build_slice` | No code gate |
| Quality audits every ~5-10 commits | `/a2p_build_slice` | No counter |
| OWASP Top 10 manual review | `/a2p_security_gate` | No code gate |

**Recommendation**: Optionally label these as "prompt-guided" in the README. Not a bug, no fix needed.

---

## 5. Unverifiable (UNVERIFIABLE)

Tool counts that cannot be checked via npm readme:

| Package | Claim | Why not verifiable |
|---|---|---|
| mcp-server-git | 12 tools | Python package (PyPI), not on npm |
| @playwright/mcp | 22 tools | npm readme empty |
| @stripe/mcp | 28 tools | "See documentation" — count depends on API key permissions |
| @sentry/mcp-server | 22 tools | No README on npm |
| @upstash/mcp-server | 26 tools | npm readme empty |

**Impact**: Low. Users don't count tools. The numbers may be outdated though.

---

## 6. Open Test Gaps (Not Missing, But Not Covered in This Run)

| Gap | Reason | Impact |
|---|---|---|
| ~~Real UI browser test~~ | ~~QuickBill app does not exist as code~~ | **CLOSED** — QuickBill built, 8 Playwright tests pass (see PHASE_C_RESULTS.md) |
| run_tests real execution | Needs running test suite | Low — SM.addTestResult validates |
| run_sast real execution | Needs Semgrep/Bandit | Low — SM.markSastRun validates |
| Backup deploy-gate hard block | Existing test (backup-integration.test.ts, gate-enforcement.test.ts) | Low — code-verified |

---

## 7. Architecture Gaps (Unchanged)

| Transition | MCP Tool? | Code Enforcement? |
|---|---|---|
| onboarding -> planning | Yes (`a2p_create_build_plan`) | Yes |
| planning -> building | **NO** | Yes (SM.setPhase + guards) |
| building -> security | **NO** | Yes (SM.setPhase + signoff + quality gate) |
| security -> deployment | **NO** | Yes (SM.setPhase + SAST/whitebox/audit/verification/backup gates) |
| deployment -> complete | **NO** | Yes (SM.setPhase) |

**Status**: Prompt-driven. Gates work, but no MCP tool exposes `setPhase` directly.

---

## 8. Prioritized Actions

### Before Release (README Fixes)

1. ~~**Deploy target wording**: Non-Docker targets get recs + checklist, no generated config files — update README~~ — **DONE** (README table already corrected, says "Recommendations" + "Checklist items")
2. ~~**Tool counts**: Cloudflare 85->current value, Filesystem 14->13, GitHub 41->check~~ — **DONE** (README shows 13 for Filesystem, Cloudflare/GitHub without exact count in conditional table)
3. ~~**MCP tool count 20->21, test count 737->741**~~ — **DONE** (2026-03-14)

### After Release (Nice-to-Have)

3. Rotate Sentry token
4. ~~Build QuickBill as real app for browser tests~~ — **DONE** (2026-03-14)
5. Expose `a2p_advance_phase` tool (closes architecture gap)
6. Add tool count assertions to mcp-dry-run.test.ts
