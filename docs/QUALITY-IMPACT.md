# Quality Impact — What the Native Flow Actually Buys You

A plain-English, non-technical assessment of how A2P's native slice hardening flow changes the quality of AI-generated codebases. This document is deliberately honest: it calls out what improves, what improves a little, and what does not improve at all.

It assumes the native flow (requirement / test / plan hardening → ready_for_red → test-first guard → red → green → refactor → sast → completion review loop → done) is in place and working as specified in [WORKFLOW.md](WORKFLOW.md). It also assumes the AI agent operating A2P uses the tools honestly rather than deliberately subverting them by editing state files directly.

---

## The short version

**Is this "real TDD" in the textbook sense?** No.

**Is it better than what most teams call TDD in practice?** Yes.

The precise label for what A2P enforces is **"test-first development with receipts"** — the AI agent is forced to write failing tests before any production code touches disk, and the tool chain keeps a cryptographically-timestamped audit trail of every step. It is not classical TDD (the minute-by-minute cycle of one failing test → three lines of code → green → refactor) because A2P's granularity is a slice, not a micro-step. What it is, instead, is **test-first that cannot be cheated without deliberate sabotage and that leaves evidence.**

---

## Overall expected improvement

If A2P-generated codebases were previously **around 60–70% "truly production-ready"** (rough estimate — this number is not measured, it is the author's honest prior), the author expects the native flow to move that to **around 85–92%** under the stated assumptions.

That is a gain of roughly **20–25 percentage points**, distributed across four concrete mechanisms:

- **~40% of the gain** comes from automatic TODO / stub detection and the refusal to mark a slice "done" when drift is present
- **~30% of the gain** comes from structurally enforced AC-to-test mapping (every acceptance criterion must have a concrete test before the slice can leave the hardening phase)
- **~20% of the gain** comes from the test-first diff guard (the AI can no longer write tests retroactively to match a finished implementation)
- **~10% of the gain** comes from the plan hardening rounds forcing architectural questions to be asked out loud, even if the answers are sometimes shallow

These percentages are qualitative estimates, not measured outcomes. The honest framing is: "the native flow removes most of the ways a slice could look done while being silently broken."

---

## Three buckets of error classes

To understand the improvement concretely, it helps to group failure modes into three buckets based on how much they change.

### 🟢 Bucket 1 — Near-elimination (~90–100% reduction)

These are failure modes that the native flow catches structurally. An honest AI agent using the tools cannot produce them. A dishonest agent can only bypass them by editing state files directly (which leaves evidence).

| Failure mode | Before the native flow | After the native flow |
|---|---|---|
| Slice marked "done" with one or more acceptance criteria that have zero test coverage | Common | Structurally impossible — `a2p_harden_tests` rejects the input if any AC in `finalAcceptanceCriteria` is not mapped to at least one test in `acToTestMap` |
| Development starts without a plan, then weeks later the architecture doesn't fit | Common | Structurally impossible — a slice cannot reach `ready_for_red` without a finalized plan containing `touchedAreas`, `expectedFiles`, `interfacesToChange`, `invariantsToPreserve`, `risks`, and a narrative |
| Finished slice still contains `TODO: fix later`, `throw new Error("not implemented")`, `NotImplementedError`, or a Python `def foo(): pass` stub | Common | Automatically detected by `scanForStubSignals` on the diff since baseline; completion review is rejected unless every signal is explicitly justified |
| Finished slice touches 15 files when the plan said 5, and nobody notices | Common | Automatically detected — `completion-review.ts` computes `unplannedFiles = changedFiles \ finalPlan.expectedFiles` and forces `NOT_COMPLETE` if the list is non-empty |
| Tests were written *after* the implementation to match it green (test-first violation) | Occasional but untraceable | Detected by the test-first guard: diff classification before RED requires only test files touched since baseline, plus a failing test run with a timestamp that must match an entry in `slice.testResults` and be strictly newer than the baseline capture |
| Slice marked "done" but the last SAST run was before the final code changes | Already caught before | Still caught, now with timestamp cross-checks |
| Slice marked "done" but tests were never re-run after SAST | Already caught before | Still caught |

### 🟡 Bucket 2 — Substantial reduction (~40–60%)

These failure modes are made less likely by the methodology, but the methodology enforces *structure*, not *depth*. An agent going through the motions can still produce a shallow version.

| Failure mode | Why it's reduced but not eliminated |
|---|---|
| "Tests exist but only cover the happy path" | Round 2 of the AC hardening methodology forces the agent to explicitly walk through input validation, null values, boundary conditions, malformed input, idempotency, auth failures, race conditions, persistence/rollback, API contracts, etc. But the agent can list each category shallowly and move on — A2P enforces *that* the list is considered, not *how deeply* |
| "Integration slice tests only against mocks, not real services" | `a2p_harden_tests` hard-rejects integration/UI slices whose `additionalConcerns` don't mention at least one real-service / integration / end-to-end / playwright / fixture / contract keyword. But the tool cannot verify that the tests *actually* run against a real service — only that the agent claims so |
| "Edge cases were forgotten" | The methodology's Round 2 category checklist helps, but good edge-case identification remains a model-quality property, not a tool-enforced property |
| "The plan was critiqued but the critique was pro forma" | Rounds 2 and 3 are structurally enforced (the agent must write a `critique` field). The intellectual honesty of the critique cannot be enforced by code |
| "Test coverage is wide but shallow — every AC has a test, but the tests assert trivial things" | The completion review requires `testCoverageQuality: "deep" \| "shallow" \| "insufficient"` and forces `NOT_COMPLETE` on anything below "deep". But that's self-report — the agent can claim "deep" without the tests actually being deep |

### 🔴 Bucket 3 — Unchanged (0% — remains model-quality responsibility)

These are failure modes that no code-level gate can catch. They depend entirely on the quality of the AI model and the human reviewer.

| Failure mode | Why it is unenforceable |
|---|---|
| Tests pass, but the business logic is semantically wrong | A2P verifies that tests run and that they were written before the implementation. It does not verify that the tests check the *right thing*. A test asserting `expect(result).toBeTruthy()` passes just as easily as one asserting `expect(result).toEqual(expectedDeepObject)`, but the former is useless |
| Architecture is over-engineered for the use case | No tool can objectively decide "too complex". Plan hardening asks the question; the answer quality remains the agent's responsibility |
| Code works but is unmaintainable | SAST and quality audits catch certain patterns, but maintainability is a long-term, human-readable property that does not reduce to a checklist |
| The requirement itself was wrong | A2P hardens the requirement you gave it. If the specification is wrong, A2P will produce a precise, well-tested, well-documented implementation of the wrong thing. Garbage in, hardened garbage out |

---

## What you reliably get after every slice

Under the native flow, every slice that reaches `done` comes with:

- An audit trail stating, for each acceptance criterion, whether it was met / partial / missing and what evidence supports the claim
- Cryptographic evidence (baseline commit or file-hash snapshot) that failing tests existed *before* the implementation was written
- An automatic report of any `TODO` / `FIXME` / `NotImplementedError` / `throw new Error("todo")` / Python pass-only / console.warn stub patterns found in the diff since baseline, and for each, either a justification or a `NOT_COMPLETE` verdict
- An automatic report of any file touched that was not in the `finalPlan.expectedFiles`, and any exported TypeScript / JavaScript symbol not in `finalPlan.interfacesToChange`
- A completion review that is strictly newer than the latest test run and the latest SAST run
- Refusal to advance if any of the above is red

---

## What you do NOT get, even after the native flow

The following remain your (or the reviewer's) responsibility:

- Judgment on whether the tests check the right things
- Judgment on whether the implementation is semantically correct
- Judgment on whether the code will be maintainable in six months
- Judgment on whether the requirement was a good requirement in the first place
- Judgment on whether the architecture fits the long-term direction of the project

A2P makes the mechanical gates strong. It does not make the thinking gates strong. Thinking is still the expensive part.

---

## The builder analogy (for non-technical readers)

Imagine A2P-generated code as a house built by a fast contractor.

**Before the native flow** the contractor was held to:
- The foundations passed a pull test (tests pass)
- The electrical work passed an inspector's check (SAST / security scans)

…but nothing prevented them from skipping rooms, hiding leftover debris inside walls, writing "TODO: finish later" on a stud with a marker, or delivering a kitchen without the promised dishwasher.

**After the native flow** the same contractor is held to all of the above *plus*:

- Every room in the plan must be listed with its exact materials before any wall goes up
- Every promised appliance must be mapped to an explicit test that will demonstrate it works
- Before each wall is closed, a photo of the empty cavity must prove there is no hidden debris
- After every room the contractor must hand the inspector a checklist marking each requirement "met", "partial", or "missing", with evidence
- The inspector runs an automated scan looking for "TODO" markings on studs anywhere in the finished house
- The inspector automatically compares the as-built drawing to the plan and refuses to sign off if the contractor added or omitted rooms
- Even after sign-off, the paper trail shows what was checked, when, and by what method

**What the new regime still cannot catch:**

- The contractor could still install a dishwasher that runs but never actually washes — the "test" is that it powers on, not that it cleans dishes
- The contractor could still lay out the rooms in a way that nobody actually enjoys living in
- The contractor could still build exactly what you asked for when what you asked for was wrong

---

## Is this "real TDD"?

A purist's checklist of classical Test-Driven Development includes:

1. Write exactly one failing test — ⚠️ partial (A2P requires *at least* one failing test but does not limit the number)
2. Write the minimum code to make it pass — ❌ not enforced (nothing stops an agent from over-implementing in the GREEN phase)
3. Refactor while keeping tests green — ✅ the REFACTOR phase is explicit and tests are re-run
4. Repeat in tight micro-cycles of minutes — ❌ not enforced (A2P's cycle is a slice, which may be hours of work)
5. Test-first ordering — ✅ enforced by the diff guard + failing-test timestamp

So A2P enforces **items 3 and 5 fully**, **item 1 partially**, and **items 2 and 4 not at all**.

In exchange, A2P enforces something classical TDD does *not*:

- **Every requirement is mapped to a test before any code is written** (classical TDD leaves this to the developer's discipline)
- **Every finished increment is reviewed against the plan for drift and against an automated stub scan** (classical TDD has no equivalent)
- **The audit trail is machine-verifiable** (classical TDD relies on commit-message discipline and peer review)

The honest label is: **stronger than most teams' actual TDD practice, weaker than the purist's TDD definition, and much more auditable than either.** For AI-driven development specifically, "auditable" is the dimension that matters most — because the AI does not feel shame when it cuts a corner, and humans cannot review every line in real time.

---

## One-sentence summary

For the failure modes that cause AI-generated codebases to look done but be silently broken, A2P's native flow catches roughly 70–80% of them structurally; for semantic correctness and architectural wisdom, nothing changes — those remain the expensive part that you and the model still have to get right.
