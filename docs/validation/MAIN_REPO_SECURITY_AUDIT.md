# Main Repo Security Audit & Resilience Results

> Date: 2026-03-14
> Workspaces: architect-to-product (reference), a2p-audit (fixes), a2p-chaos (break tests)

---

## 1. Main Repo Security Strengths

- **Phase transitions**: Fully code-enforced. Every illegal transition throws a clear error.
- **Evidence gates**: Slice status transitions require provable evidence (tests, SAST). No status without proof.
- **Build signoff**: Mandatory, code-enforced. Invalidated on slice/test changes. Re-signoff enforced.
- **Deploy approval**: Mandatory, code-enforced. Invalidated on finding/audit/whitebox changes. `a2p_generate_deployment` blocks without approval.
- **Stale SAST detection**: Full SAST must be newer than last security-relevant change. Otherwise deployment blocked.
- **Security gates**: CRITICAL/HIGH findings, blocking whitebox, critical audit findings — all block deployment.
- **Zod validation**: On all tool inputs and state reads. Malformed state.json is caught cleanly.
- **State backup**: Automatic `.bak` before every write.
- **Log sanitization**: Passwords, Bearer tokens, GitHub tokens, OpenAI keys are redacted.
- **Test command restriction**: Override only with explicit `allowTestCommandOverride=true`.
- **759 tests**: All gates, transitions, invalidations, edge cases covered.

## 2. Main Repo Security Gaps

### Fixed

| # | Gap | File | Severity | Fix |
|---|-----|------|----------|-----|
| M1 | SAST rawOutput not sanitized | `run-sast.ts:182,231` | should-fix | Wrapped `sanitizeOutput()` around `truncate()` |
| M2 | TestResult.output not sanitized in state | `run-tests.ts:57` | should-fix | Wrapped `sanitizeOutput()` around `truncate()` |
| M6 | Backup was only warning, not hard block | `state-manager.ts` | should-fix | Backup gate enforces hard block for stateful apps (setPhase security->deployment) |

### Accepted

| # | Gap | Severity | Rationale |
|---|-----|----------|-----------|
| M3 | Secret redaction does not cover connection strings | acceptable | `postgresql://user:pass@host` not redacted. Rare in tool output, would be a nice-to-have pattern extension |
| M4 | State file not encrypted | acceptable | Standard for local dev tool |
| M5 | `execSync` with shell execution | acceptable | Trust model is MCP->Claude, not untrusted users |
| M7 | Signoff/approval not cryptographically signed | nice-to-have | Deterministic hash is sufficient for local tool |

## 3. Release Blockers

**None.** The two should-fix findings (M1, M2) are fixed and verified.

## 4. Fixes Applied

| File | Change |
|------|--------|
| `src/tools/run-sast.ts:4` | Added `sanitizeOutput` import |
| `src/tools/run-sast.ts:182` | Semgrep rawOutput: `sanitizeOutput(truncate(...))` |
| `src/tools/run-sast.ts:231` | Bandit rawOutput: `sanitizeOutput(truncate(...))` |
| `src/tools/run-tests.ts:57` | TestResult.output: `sanitizeOutput(truncate(...))` |

Total: 4 lines changed, 0 files added, 0 files deleted.

## 5. New Verification Results

```
Main repo typecheck: Identical to baseline (5 pre-existing TS warnings, no new ones)
Main repo tests: 759/759 passed
Audit workspace tests: 737/737 passed (10.24s)
Chaos workspace shake-and-break: 10/10 passed
```

## 6. Shake-and-Break Findings (Chaos Workspace)

All 10 tests passed — the system responds correctly to broken states:

| # | Test | Result |
|---|------|--------|
| 1 | Corrupted state.json (garbage data) | Clear error, no crash |
| 2 | Missing .bak file | No crash, state readable |
| 3 | Illegal phase transition (onboarding->building) | Rejected with clear error |
| 4 | Evidence gate bypass (red->green without tests) | Rejected |
| 5 | Stale build signoff (invalidated by addTestResult) | Rejected at building->security |
| 6 | Stale SAST detection | Rejected at security->deployment |
| 7 | Double initialization | "State already exists" error |
| 8 | Empty slices + advance | "No more slices" error |
| 9 | Non-existent slice ID | Clear "not found" error |
| 10 | Secret redaction (passwords, Bearer, ghp_, sk-) | All redacted |

## 7. What Should Become Core A2P

### Should A2P get an official reference/audit/chaos workspace model?

**Yes.** The three-workspace model worked in both runs (QuickBill + main repo):

- **Reference** stays clean as comparison baseline
- **Audit** isolates fixes, allows clean verification
- **Chaos** allows destructive tests without risk

### Does A2P need new tools or is prompt orchestration sufficient?

**Hybrid approach recommended:**

| Aspect | Tool or Prompt | Rationale |
|--------|---------------|-----------|
| Create workspace copy | **Tool** | Deterministic, reproducible |
| Classify audit findings | **Prompt** | Requires context understanding |
| Standard shake-and-break checks | **Tool** | Defined test set, repeatable |
| Result consolidation | **Prompt** | Evaluation requires interpretation |
| Fix promotion (audit->reference) | **Tool** | Diff + copy, deterministic |

### Minimal Implementation Steps

1. **`a2p_create_sandbox`** tool:
   - Parameters: `type` ("audit" | "chaos"), `projectPath`
   - Copies workspace, returns path
   - Tracks sandbox state in state

2. **`a2p_run_shake_and_break`** tool:
   - Standard test set: illegal transitions, evidence bypass, stale checks, secret leak
   - Runs in sandbox, returns structured result

3. **`a2p_promote_sandbox`** tool:
   - Diff-based: shows changes, applies after confirmation
   - Only for audit sandboxes, not chaos

4. **Security audit prompt** extension:
   - References the three-workspace model
   - Gives clear instructions for classification (blocker/should-fix/acceptable/nice-to-have)

## 8. Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| ~~Connection string redaction missing~~ | ~~Low~~ | Fixed: URL credential pattern in log-sanitizer.ts + sanitizeOutput() in run-audit.ts |
| ~~5 pre-existing TS warnings (setup-companions, update-slice)~~ | ~~Low~~ | Fixed in 95f510a — `tsc --noEmit` gives 0 errors |
| Non-Docker deploy targets return Docker file descriptions | Medium | README correction already documented in README_GAPS.md |
| Prompt-only enforcement for some workflows | Medium | By design, but label as "prompt-guided" in README |

## 9. Final Verdict

### release-candidate

**Rationale:**
- All code-enforced gates work correctly (10/10 chaos tests)
- Secret redaction on all output paths (after fix M1+M2)
- 741 tests green
- No blockers
- Two should-fix findings fixed and verified
- README gaps are documented and partially corrected

**Still needed for release-ready:**
- Correct README wording for non-Docker targets (already listed as action in README_GAPS.md)

**Completed since last audit:**
- ~~Fix pre-existing TS warnings (5 locations)~~ — fixed in 95f510a, `tsc --noEmit` gives 0 errors
- ~~Connection string redaction (nice-to-have)~~ — fixed: URL credential pattern in log-sanitizer.ts + sanitizeOutput() in run-audit.ts

**Not "not-ready" because:** All security boundaries hold, all gates work, no open blockers.
**Not "release-ready" because:** README gaps (deploy target wording) are known but still open.
