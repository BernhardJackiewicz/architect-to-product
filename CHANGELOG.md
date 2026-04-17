# Changelog

## v2.0.0 — A2P v2: Evidence-gated AI systems engineering

### Added
- **13 canonical systems-engineering concerns** (`SystemsConcernId` in `src/state/types.ts`):
  `data_model`, `invariants`, `state_machine`, `api_contracts`,
  `auth_permissions`, `failure_modes`, `observability`,
  `performance_under_load`, `migrations`, `concurrency_idempotency`,
  `distributed_state`, `cache_invalidation`, `security`.
- **Applicability utility** (`src/utils/systems-applicability.ts`):
  pure deterministic function `computeRequiredConcerns(slice, architecture)`.
  Three layers: explicit `slice.systemsClassification` override, structural
  signals (slice.type / hasUI / AC text keywords), architecture signals
  (techStack / architecture.systems.*). `failure_modes` piggybacks on any
  other triggering concern or on opt-in via `architecture.systems`.
- **Structured architecture block** (`Architecture.systems?: ArchitectureSystems`):
  domainEntities, invariants, stateMachines, apiContracts, permissionsModel,
  failureModel, migrationPolicy, observabilityModel, performanceBudgets,
  cacheStrategy, distributedStateModel, securityAssumptions.
- **Per-concern evidence fields** on existing hardening artifacts:
  - `SliceHardeningRequirements.systemsConcerns?: ConcernRequirementEntry[]`
    (applicability, requirement prose, `linkedAcIds` — anti-gaming guard forces
    required concerns to anchor to at least one AC).
  - `SliceHardeningTests.systemsConcernTests?: ConcernTestEntry[]`.
  - `SliceFinalPlan.systemsConcernPlans?: ConcernPlanEntry[]`.
  - `SliceCompletionReview.systemsConcernReviews?: ConcernReviewEntry[]`.
  - `Slice.systemsClassification?: SystemsConcernId[]` (explicit override).
- **Two new code-enforced gates** in `src/state/state-manager.ts`:
  - `requireSystemsConcernsHardening` — blocks `pending → ready_for_red`
    when any REQUIRED concern lacks evidence in any of the three hardening
    artifacts. Precise errors name the missing concern + the artifact.
  - `requireSystemsConcernsReviewed` — blocks `sast → done` when the latest
    COMPLETE review lacks a verdict for any REQUIRED concern, or a concern
    is verdicted unsatisfied / not_applicable-when-required.
- **Tool surface extended additively** (no new tools):
  `a2p_set_architecture`, `a2p_harden_requirements`, `a2p_harden_tests`,
  `a2p_harden_plan` (finalize), `a2p_completion_review` all accept the
  corresponding optional v2 fields.
- **Prompt updates** — `src/prompts/planning.ts` section 5 introduces the
  thirteen concerns + applicability rules; `src/prompts/build-slice.ts` adds
  a "Systems-Engineering Concerns" section between Security-Surface and
  Structured Logging with explicit cross-references to avoid duplication.
- **New tests (~80)**:
  - `tests/tools/state-migration-v1-to-v2.test.ts` (6) — v1 state round-trips
    through v2 schema; `version` bumps to 2; new fields default undefined.
  - `tests/tools/systems-applicability.test.ts` (38) — one positive + one
    negative case per applicability rule; override suppression;
    multi-concern triggers; architecture-level opt-in.
  - `tests/tools/systems-concerns-gate.test.ts` (9) — pre-RED + pre-DONE
    gate enforcement; bootstrap slices skip gate.
  - `tests/prompts/systems-engineering-prompt.test.ts` (8) — first
    prompt-content test in repo; asserts canonical concern IDs present in
    both prompts and cross-references intact.
  - `tests/integration/systems-stateful-slice-e2e.test.ts` (5) — realistic
    multi-tenant webhook slice end-to-end; omitting any concern at any stage
    triggers a precise error; all-satisfied path walks to DONE.

### Changed
- **STATE_VERSION 1 → 2** (state-manager.ts). New `migrateV1ToV2Systems` in
  validators.ts added to `z.preprocess` chain. Migration is semantic no-op:
  all new fields default to `undefined` on legacy states, so v1 state.json
  files round-trip cleanly. Applicability rules treat states with no
  `architecture.systems` and no keyword-triggered concerns as no-gate
  (returns empty required set), preserving v1 behavior.
- `tests/helpers/setup.ts` seed helpers now auto-populate v2 systems-concern
  fields so existing tests that use `seedSliceHardening` / `seedCompleteReview`
  continue to pass.

### Preserved (v1 guarantees)
- Slice status flow: `pending → ready_for_red → red → green → refactor → sast → done`
  with `completion_fix` loop. Bootstrap slices retain legacy short flow.
- All phase gates: build signoff, quality audit, full SAST, whitebox audit,
  adversarial review, active verification, release audit, backup gate,
  secret-management tier, SSL verification.
- Hash-cascade invalidation (`acHash` / `testsHardenedAt` / `requirementsAcHash`)
  continues to invalidate downstream v2 fields transitively because they
  live inside the existing artifacts.
- Drift-recovery (completion_fix) archival continues to preserve systems-concern
  plan entries via `previousPlanHardenings[]`.

### Backward compatibility
- Old v1 `state.json` files load cleanly under v2 schema. After first read,
  `state.version` is persisted as `2`.
- Tool inputs that omit v2 fields remain valid. If a REQUIRED concern
  applies, the state-manager gate fires at transition time with a precise
  error naming the missing concern and the tool to re-invoke.
- `tests/tools/backup-integration.test.ts` and other legacy-shape fixtures
  continue to work unchanged.

### Migration guide (for operators)
- No file edits required. Re-running `a2p_get_state` after upgrade shows
  `state.version: 2`.
- Slices already past `ready_for_red` at upgrade time are not re-gated;
  only future transitions enforce v2 evidence.
- To opt a project fully into v2 systems-engineering, call
  `a2p_set_architecture` with a `systems` block describing domain entities,
  invariants, state machines, API contracts, permissions, failure modes,
  migration policy, observability, performance budgets, cache strategy,
  distributed-state model, and security assumptions. This turns on the
  cache_invalidation + distributed_state applicability rules.

---

## v1.2.0 — Previous release

- hono 4.12.12 → 4.12.14 (CVE GHSA-458j-xx4x-4375).
- `completion_fix` drift-recovery bug fix.
- Security-Surface Checklist added to build-slice.ts.
- Phase 3a: L2 LGTM-escape-hatch in plan hardening.
- Native slice hardening triad.
