# A2P v2 dogfood validation — report

**Run**: 2026-04-17 overnight autonomous execution.
**Harness**: `tests/dogfood/v2-link-shortener-e2e.test.ts` — drives the real
MCP tool handlers (same functions the MCP server invokes) against a
tmp-dir link-shortener project with two realistic slices.

**Result**: **8/8 dogfood assertions pass** after fixes to 2 real A2P v2 bugs
and 2 ergonomic issues surfaced during the run.

## Findings (in order of discovery)

### Finding 1 — `auth_permissions` applicability regex missed common tenant-scoping phrasing
**Severity**: usability bug
**Surfaced at**: slice 1 setup — applicability rules didn't fire for a slice
with "per-user" / "per-user idempotencyKey" / "userId" in its description.
**Root cause**: The `RE_AUTH` keyword regex covered `auth|login|session|token|
permission|role|rbac|tenant|authorization|authenticated` but missed the
common hyphenated forms `per-user`, `multi-user`, `multi-tenant`,
`user-scoped`, `owner`, `owned by`, and the camelCase `userId`.
**Fix**: extended `src/utils/systems-applicability.ts` `RE_AUTH` with those
terms. No overfire in existing test suite (verified against 38 applicability
tests + 9 gate tests + integration test).

### Finding 2 — `api_contracts` lifecycle hazard: rule depended on plan-time state
**Severity**: design bug
**Surfaced at**: slice 1 pre-RED gate — always fired with "api_contracts is
REQUIRED but missing from requirementsHardening" even though slice was
hardened in the right order.
**Root cause**: An applicability trigger `planTouchesExports(slice)` derived
`api_contracts` from `slice.planHardening.finalPlan.interfacesToChange`.
But requirements are hardened BEFORE the plan exists. As soon as the plan
was finalized, the required-concerns set grew — and the pre-RED gate
(run AFTER plan finalize) found requirements missing the new concern.
Users would be trapped: re-harden requirements → test hardening
invalidates → re-harden tests → plan invalidates → re-harden plan →
re-introduces the concern → loop.
**Fix**: removed the plan-derived trigger. `api_contracts` now fires only
when (a) `slice.type === "integration"`, or (b) explicit
`slice.systemsClassification` includes it. Feature slices that
knowingly change API surface must opt in via `systemsClassification`
during planning. Documented the rationale inline in
`src/utils/systems-applicability.ts`. Updated the applicability test to
assert the new stable behavior.
**Preserves design intent**: the concern still fires when slice metadata
actually signals API work. It just doesn't grow the set after
requirements are locked.

### Finding 3 — Missing directory creation before baseline capture
**Severity**: dogfood-harness bug (not A2P)
**Surfaced at**: slice 1 test-first-write step.
**Fix**: harness-local — create `tests/` + `src/` dirs inside the tmp
project up front so `writeFileSync` doesn't ENOENT on first use.

### Finding 4 — Plan compliance reports drift when impl's exported-symbol name ≠ plan.interfacesToChange
**Severity**: expected behavior, but the error is non-obvious on first encounter
**Surfaced at**: slice 2 completion review rejected with
`planCompliance="drift"` because the fixture impl exported `x` but the
plan said `["${sliceId} handler"]`.
**Fix**: harness-local — use the actual exported symbol name in both
`finalPlan.interfacesToChange` and the impl. This is the contract the
plan-compliance scanner enforces, and it's working as designed. Left a
note in the harness explaining the coupling.
**Suggestion for v2.1**: the plan-compliance error message could include
a hint like "did the impl export a symbol not listed in
interfacesToChange? plan said [X], impl exported [Y]."

### Finding 5 — Plan-compliance `expectedFiles` requires repo-relative paths, not absolute
**Severity**: ergonomic friction
**Surfaced at**: slice 1 plan-compliance would have reported `unplannedFiles`
if we had passed absolute paths to `finalPlan.expectedFiles`.
**Fix**: harness-local — call `.replace(dir + "/", "")` to feed relative
paths.
**Suggestion for v2.1**: the plan tool could auto-normalize paths (strip
the project root prefix) so users don't have to remember.

## Workflow observations (ergonomic, not bugs)

1. **Cross-slice test-first guard requires committing between slices.**
   When slice 1 finishes and leaves `src/shorten.ts` in the worktree,
   slice 2's baseline (captured at `ready_for_red`) treats that file as
   pre-existing. If slice 2's impl also touches `src/` (common — it will),
   the guard fires "production files changed before failing test run."
   The fix is `git add -A && git commit` between slices so slice 2's
   baseline is HEAD-fresh.
   **For MCP users**: this is an implicit requirement that should be
   documented in the build-slice prompt. I'll add it in a follow-up.

2. **Integration slices require "real/integration/fixture" in
   `additionalConcerns` for harden_tests to accept them.**
   Fine intent, but the error message "additionalConcerns must mention
   at least one real-service / integration / end-to-end / playwright /
   fixture / contract item" is verbose and disappeared near the bottom
   of a long error. A user facing it for the first time could be
   confused.

3. **The plan-hardening LGTM escape hatch works as advertised.**
   I finalized both slices with an LGTM round 2 + finalize on slice 2.
   No complaints from the enforcement code.

4. **Per-concern applicability feels aggressive until you use it.** On
   slice 1 I expected the applicability rules to magically catch
   `security` and `auth_permissions` just from reading the description.
   Without explicit `systemsClassification`, some rules missed. Adding
   the classification felt like a chore the first time, but ended up
   being the cleanest way to lock in scope — which is exactly the
   design intent.

## Outstanding v2.1 suggestions

1. **Plan-compliance error UX**: include the actual unexpected export
   name and the planned names in the drift report.
2. **Path normalization**: strip project-root prefix from
   `finalPlan.expectedFiles` automatically.
3. **Between-slice commit reminder**: add a line to the build-slice
   prompt: "If slice N+1 will touch files under the same subtree as
   slice N, commit slice N's changes first so the baseline is fresh."
4. **Overfire audit**: run the applicability rules against a corpus of
   realistic slice descriptions (≥50) and tune keyword precision. The
   two rule changes made in this dogfood (Finding 1 expansions, Finding
   2 contraction) should be the first two entries in a broader tune-up.
5. **Integration slice test-hardening error**: condense the
   `additionalConcerns must mention...` error into a single short line.

## What v2 got right (validated under dogfood)

- v1 → v2 state migration is invisible to the user — new state.json
  parses as v2, old ones auto-migrate.
- Per-concern evidence in all 4 artifact types (requirements, tests,
  plan, review) is preserved through the hash-cascade invalidation and
  the archival of superseded hardening cycles.
- The pre-RED and pre-DONE gates produce precise error messages naming
  the missing concern + the artifact + the tool to re-invoke. This is
  exactly the UX the plan called for.
- Explicit `systemsClassification` acts as the "I know better than the
  heuristics" escape hatch, which proved essential for this realistic
  fixture.
- Bootstrap slices correctly skip v2 gates (not exercised in this
  dogfood run since both slices were non-bootstrap, but confirmed in
  the gate tests).

## Reproduction

```bash
npx vitest run tests/dogfood/v2-link-shortener-e2e.test.ts
```

Expected: **8 tests passing** in ~1 second against a fresh tmp project.
The run exercises the complete v2 flow: init → architecture (with
systems block) → plan → harden × 3 → ready_for_red → verify_test_first
→ red → green → refactor → sast → completion_review → done, for two
slices, with explicit `systemsClassification` overrides and
per-concern evidence at all four artifact levels.
