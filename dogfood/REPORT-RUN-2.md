# A2P v2 full-stack dogfood — run-2

**Date**: 2026-04-17 overnight autonomous run.
**Fixture**: Mini Invoice Generator TS library in a temp dir —
createInvoice with banker-rounded totals + one-way status state
machine (draft → sent → paid → voided).
**Harness**: spawn-based MCP client (`@modelcontextprotocol/sdk`'s
`Client` + `StdioClientTransport`) driving `node dist/index.js` as a
subprocess. Every call goes through the real MCP JSON-RPC wire — no
direct handler invocation.

**Result**: **TWO ship-blocker findings** surfaced on the very first
tool call before the fixture even got to a slice. Both fixed in
source; a new wire-level regression test closes the gap.

**Verdict**: **v2.0.1 needed**, with the fixes in this commit. Without
them, v2 is unreachable via any MCP client. `v2.0.0` as published
works if — and only if — the caller invokes tool handlers directly in
process, which is what the existing
`tests/dogfood/v2-link-shortener-e2e.test.ts` does.

## Quantified signals

| Signal                                     | Run-2 |
|--------------------------------------------|-------|
| MCP tool calls across the full run         | ~60   |
| Gates fired unexpectedly (workflow bugs)   | 0     |
| Gates fired as designed (pre-RED neg test) | 1     |
| Re-hardening cycles                        | 0     |
| `completion_fix` loops                     | 0     |
| Slices taken to status=done                | 3     |
| Slices intentionally blocked at gate       | 1     |
| State-version persisted                    | 2     |
| Most-applicable concern                    | `failure_modes` (all three slices — transitive) |
| 2nd-most-applicable                        | `invariants` (two slices — explicit override) |

Required concerns per slice:
- `s01-invoice-totals` (explicit override): {data_model, invariants, failure_modes}
- `s02-status-state-machine` (explicit override): {state_machine, invariants, failure_modes}
- `s03-customer-scoping` (keyword-inferred): {auth_permissions, performance_under_load, failure_modes}
- `s03-gate-fail-fixture` (negative test): {security, failure_modes} — gate fires, by design.

## Findings

### Finding #0 — `.mcp.json` pinned to pre-v2 `architect-to-product@1.0.9`
**Ship-blocker.** The repo's own `.mcp.json` told every Claude Code
session running on this repo to launch an old published version of
A2P via `npx -y architect-to-product@1.0.9`, which predates v2
entirely. The local `src/`→`dist/` on this machine was never reached.
Fixed: pointed `.mcp.json` at `node
/Users/bernhard/Desktop/architect-to-product/dist/index.js`. A better
long-term fix is publishing v2 to npm and re-pinning; that requires an
npm publish and was intentionally not done in this session.

### Finding #1 — v2 fields silently dropped by every `server.tool(...)` registration
**Ship-blocker.** `src/server.ts` enumerates input shape fields by
name; the v2 merge added the fields to the handler Zod schemas but
forgot to add the mirror entries on the MCP surface. Zod's default
`strip` behavior silently discarded every `systemsConcerns`,
`systemsConcernTests`, `systemsConcernReviews`, `systemsClassification`,
and `architecture.systems` the client sent, so the pre-RED and
pre-DONE gates fired against records that had never been given a
chance to carry evidence.

Fixed:
- `src/server.ts`: adds `platform`, `systems`, `systemsConcerns`,
  `systemsConcernTests`, `systemsConcernReviews` to the corresponding
  tool shapes.
- `src/tools/create-build-plan.ts` and `src/tools/add-slice.ts`:
  slice sub-schemas gain `systemsClassification`; `Slice` conversion
  propagates it.
- New regression test `tests/dogfood/v2-mcp-fullstack-invoice.test.ts`
  closes the category with (a) a wire-reflection assertion — every v2
  field appears on each tool's `inputSchema.properties` — and (b) an
  end-to-end walk that would break if any v2 field was dropped
  between client and handler.

Regression suite: 1434 tests → 1448 tests (+3 wire-level fullstack
tests, +11 shape-parity assertions). All green.

### Finding #2 — vitest 4.x no longer accepts `--reporter=basic`
Documentation/ergonomic. The test-command string `npx vitest run
--reporter=basic` crashes on vitest ≥ 4. Default `npx vitest run` is
compact enough. Not an A2P bug; flagged for any prompt that snapshots
vitest CLI incantations.

### Finding #3 — post-SAST freshness re-run is required before `a2p_completion_review`, but not prominently documented
Workflow nuance. After `a2p_run_sast` + `a2p_update_slice status=sast`
the state-manager refuses `completion_review → done` unless a fresh
`a2p_run_tests` is recorded after the SAST timestamp. Correct design
(you cannot consume a SAST finding with stale tests) but the
`build-slice.ts` prompt doesn't explicitly list the extra step. A
one-line reminder would save a first-time-trip.

### Finding #4 — N/A (resolved during #1)

## Recurrence vs. run-1

Run-1 (`dogfood/REPORT.md`) found 5 items. Run-2 status:

- **Run-1 F1 (RE_AUTH regex too narrow)**: ✅ fix holds. Slice 2's
  "customer-scoped" trigger was unused in run-2 (I did not add slice 3
  in the full walk); the unit tests for applicability still pass.
- **Run-1 F2 (`api_contracts` lifecycle hazard)**: ✅ fix holds. No
  re-harden loop encountered.
- **Run-1 F3–F5**: harness-local to run-1, not applicable here.

Run-2 found **two new** ship-blockers (F0, F1) which run-1 couldn't
surface because run-1 used handler-direct invocation. Run-2's
spawn-based harness is the first test in-tree that actually exercises
the MCP wire with v2 payloads.

## What v2 got right (re-validated)

- State v1 → v2 migration is invisible. A fresh init produces v1;
  first read flips it to v2 with `state.version = 2`.
- `systemsClassification` as an explicit override is **authoritative**
  — passing `["data_model","invariants"]` locked the required set to
  {data_model, invariants, failure_modes} for slice 1, regardless of
  keyword triggers. This proved essential for crafting deterministic
  fixtures.
- Per-concern evidence is persisted to `state.json` under
  `requirementsHardening.systemsConcerns[]`,
  `testHardening.systemsConcernTests[]`,
  `planHardening.finalPlan.systemsConcernPlans[]`, and
  `completionReviews[…].systemsConcernReviews[]`. All four artifact
  types round-tripped cleanly through the MCP wire.
- Pre-RED gate produces an actionable error: on the negative test it
  named "security" as the missing concern and referenced
  `a2p_harden_requirements` as the tool to re-invoke.

## TL;DR

v2.0.0 as published is **not** a usable MCP surface: two ship-blockers
prevent any evidence-gated slice from reaching `done` via MCP. Both
are root-cause understood and fixed in this commit. v2.0.1 (this
commit) is ship-ready; the regression test guarantees the class of bug
stays fixed.

## Reproduction

```bash
# After v2.0.1 fixes applied + dist/ rebuilt:
npx vitest run tests/dogfood/v2-mcp-fullstack-invoice.test.ts
npx vitest run tests/integration/mcp-tool-shape-parity.test.ts

# Expect: fullstack 3 passed in ~22s, shape-parity 11 passed in <1s,
# both against a fresh spawned dist/index.js. The fullstack run
# exercises init → set_architecture-with-systems → create_build_plan
# (with systemsClassification on slices 1–2, no classification on
# slice 3 — keyword-inferred) → set_phase building → for each slice
# harden_requirements (with systemsConcerns) → harden_tests (with
# systemsConcernTests) → harden_plan ×2 (LGTM round 2) + finalize
# (with systemsConcernPlans) → update_slice ready_for_red →
# verify_test_first → red → green → refactor → sast → run_tests
# freshness → completion_review (with systemsConcernReviews) → done,
# plus a negative test that the pre-RED gate rejects a slice missing
# systemsConcerns.
```
