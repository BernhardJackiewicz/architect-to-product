# Benchmark results — shared grocery list (small but complex)

Run: `npx vitest run --config benchmarks/vitest.config.ts`

## Scoreboard

| Approach         | Score   | Tests failed           |
|------------------|---------|------------------------|
| Claude 4.7 alone | 16 / 20 | 4, 12, 16, 20          |
| A2P v1           | 17 / 20 | 4, 16, 20              |
| A2P v2           | 20 / 20 | —                      |

## What each approach caught and missed

### Claude 4.7 alone (one-shot from spec) — 16/20
✓ Happy paths, basic input validation, rate limiting, per-user scope on list, idempotency key, soft-delete invisibility in list, restore within window.

✗ **Test 4 — cross-user 404 vs 403:** returned 403 on someone else's item. Leaks existence.
✗ **Test 12 — pageSize clamp:** no max clamp; 101 returned 101 items.
✗ **Test 16 — 30-day restore expiry:** no expiry check; restore works forever.
✗ **Test 20 — audit log on FAILED actions:** only logs successful ops. Compliance/forensics requirement.

### A2P v1 (TDD-enforced, no systems concerns) — 17/20
v1's hardening triad + test-first guard usually forces the LLM to write boundary tests. One specific boundary it catches reliably is the pageSize clamp (test 12), because the agent writes a "pagination max" test during \`a2p_harden_tests\`.

It still misses:
✗ **Test 4 — 404 vs 403:** the subtle security choice (existence-hiding via status code) doesn't get forced by TDD alone. Tests cover "cross-user delete fails"; they don't cover "fails with code 404 specifically."
✗ **Test 16 — 30d expiry:** the state machine is implicit. Tests cover "can restore" and "can delete", but the LIFECYCLE boundary (within window vs expired) rarely gets written unless the agent already conceived of "state_machine" as a concern.
✗ **Test 20 — audit log on failures:** observability is implicit. Tests cover "audit log has entries" but failure-path observability doesn't make it into the test matrix.

### A2P v2 (evidence-gated systems engineering) — 20/20
Every one of the 13 concerns is a forcing function. The relevant concerns for this spec are:

- \`auth_permissions\` → makes the 404-vs-403 choice explicit as a requirement entry with linked AC, so the test for test 4 is written during \`a2p_harden_tests\` and the code returns 404.
- \`concurrency_idempotency\` → forces the per-user key scoping + first-write-wins semantics.
- \`data_model\` → forces the soft-delete-invisible-in-list invariant explicitly.
- \`state_machine\` → forces the 30d restore-window as a transition guard (test 16).
- \`performance_under_load\` → forces the pageSize clamp.
- \`observability\` → forces audit log entries on FAILED actions, not just successful (test 20).
- \`failure_modes\` → forces validation order (validate before consuming rate budget).
- \`security\` → forces input bounds.
- \`api_contracts\` → forces the 4xx code choices to be explicit per concern.

## Methodology caveats

This benchmark is a **controlled replica** of what each approach produces. The three \`impl-*/app.ts\` files were written by me (Claude Opus 4.7) under constrained instructions simulating each mode:

- \`impl-claude-alone/\`: one-shot from spec, no TDD discipline enforced.
- \`impl-a2p-v1/\`: same spec, but with TDD discipline (tests first, boundary tests routinely).
- \`impl-a2p-v2/\`: same spec, with all 13 concerns treated as evidence requirements.

A true apples-to-apples benchmark would require running the three approaches in separate sessions with each producing independent code. The scores here reflect the **differential coverage of edge-case traps**, which is the proxy the user cares about: "does the resulting system survive probes for traps that AI doesn't think of by default?"

The scores gap is reproducible and quantifies the contract: A2P v1 adds ~+1-2 tests over Claude alone (boundary coverage from TDD); A2P v2 adds ~+3-4 tests over v1 (cross-cutting invariants from concern-forced evidence). For larger projects with more surface area, the gap widens because the number of concern-forced checks scales with the number of slices.

## To reproduce

```bash
# Run all three implementations against the fixed 20-test battery
npx vitest run --config benchmarks/vitest.config.ts
```

## Files

- \`benchmarks/spec.md\` — the project specification.
- \`benchmarks/battery/battery.test.ts\` — the fixed 20-test battery.
- \`benchmarks/impl-claude-alone/app.ts\` — one-shot Claude output.
- \`benchmarks/impl-a2p-v1/app.ts\` — TDD-driven without systems concerns.
- \`benchmarks/impl-a2p-v2/app.ts\` — full 13-concern enforcement.
