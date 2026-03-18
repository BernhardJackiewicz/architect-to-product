# A2P Validation

Landing page for the A2P validation suite — active claim verification across the full pipeline.

---

## What Validation Covers

A2P includes active claim verification across 5 phases:

| Phase | Scope | Method |
|-------|-------|--------|
| **Phase A** | Workflow, state management, gate enforcement | 96 QuickBill scenarios |
| **Phase B** | State transitions, edge cases, error handling | Unit + integration tests |
| **Phase C** | Real UI tests via Playwright | 8 browser tests against a running Next.js app |
| **Phase D** | Deploy target reality check | Code inspection + generated output verification |
| **Phase E** | Companion tool count verification | Live API calls + npm readme inspection |

---

## Current Test Count

**1228 tests passing** (as of version 1.0.5)

---

## Validation Reports

| File | Description |
|------|-------------|
| [PHASE_A_RESULTS.md](PHASE_A_RESULTS.md) | Workflow and gate enforcement validation results |
| [PHASE_B_RESULTS.md](PHASE_B_RESULTS.md) | State management and edge case results |
| [PHASE_C_RESULTS.md](PHASE_C_RESULTS.md) | Playwright browser test results |
| [PHASE_DE_RESULTS.md](PHASE_DE_RESULTS.md) | Deploy target and companion verification results |
| [README_GAPS.md](README_GAPS.md) | Claim verification — corrections, gaps, and status tracking |
| [MAIN_REPO_SECURITY_AUDIT.md](MAIN_REPO_SECURITY_AUDIT.md) | Security audit of the A2P repository itself |

---

## Claim Verification Statuses

| Status | Meaning |
|--------|---------|
| **Verified** | Claim matches code behavior, confirmed by test or inspection |
| **Inaccurate** | Claim does not match code — correction documented |
| **Unverifiable** | Cannot be verified with available tools (e.g., npm readme empty) |
| **Prompt-only** | Behavior enforced via prompt, not code gate — by design |

See [README_GAPS.md](README_GAPS.md) for the full claim verification matrix with corrections and rationale.

---

## Running the Tests

```bash
npm test            # Run all 1228 tests
npm run typecheck   # Type checking
npm run build       # Build
```
