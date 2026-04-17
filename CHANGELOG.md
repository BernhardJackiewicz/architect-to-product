# Changelog

## v2.0.2 — codebase-memory-mcp enforced as required companion

### Fixed
- **Explore-subagent-bypass (run-2 real-world finding)**: Claude Code's
  built-in Explore subagent fell back to `bash grep` / `find` for
  cross-file identifier lookups even when `codebase-memory-mcp` was
  registered in `.mcp.json`. The Explore subagent does not see A2P's
  prompts; only the project-level `CLAUDE.md` reaches it. v2.0.2 adds
  an "Exploration preference" section to the auto-generated `CLAUDE.md`
  instructing every agent (main + subagents) to use
  `mcp__codebase-memory__search_graph` / `search_code` /
  `trace_call_path` before falling back to grep.

### Added
- **Required-companion gate** (`requireCodebaseMemoryRegistered` in
  `src/state/state-manager.ts`): `planning → building` is blocked
  unless codebase-memory is registered as an installed companion, OR
  the architecture opts out via `bypassCodebaseMemory: true` +
  `bypassCodebaseMemoryRationale` ≥ 20 chars. Pattern matches the
  existing v2 `requireSystemsConcernsHardening` gate.
- **Soft freshness warning** (`codebaseMemoryIndexWarning`): slice
  transition `pending → ready_for_red` emits a non-blocking warning
  when the codebase-memory index is missing OR older than 7 days.
  Deliberately soft — hard-block is deferred to v2.1 after real-world
  feedback. Indexing a 4 GB repo takes minutes; we warn but don't
  brick the flow.
- **New tool** `a2p_verify_codebase_memory_index`: caller self-reports
  the index readiness (pattern matches `a2p_verify_ssl`). Writes to
  `state.codebaseMemoryReadiness = { registered, indexed,
  lastIndexedAt }`.
- **Setup-companions enforcement**: `a2p_setup_companions` returns an
  error (not a warning) when a required companion's binary is
  unavailable. Escape: pass `allowMissingRequired: true` with a
  non-empty `bypassRationale`; the bypass is logged to
  `state.config.companionBypasses[]` for audit. Default-required
  companions: `codebase_memory` only in v2.0.2; `git` / `filesystem`
  remain optional to avoid breaking existing projects on upgrade.
- **Prompt rewrites** (planning, build-slice, onboarding, refactor,
  security-gate): conditional "if codebase-memory available"
  references replaced with mandatory language. Explicit instruction
  "Do NOT spawn the Explore subagent for identifier / call-site
  lookups" added to every prompt that could reach for Explore.
- **Regression tests (25 new)**:
  - `tests/integration/codebase-memory-enforcement.test.ts` (10) —
    gate behavior: blocked without codebase-memory, allowed with
    it, allowed with explicit bypass, rejected with short bypass
    rationale, setup-companions error/bypass paths, verify-tool
    persistence, soft warning on/off.
  - `tests/prompts/codebase-memory-v2-0-2.test.ts` (14) — every
    relevant prompt must use the `mcp__codebase-memory__` call
    convention, must NOT contain the legacy conditional
    `companionReadiness.codebaseMemory`, must forbid spawning the
    Explore subagent for code reconnaissance.
  - `tests/tools/init-project.test.ts` (+1) — generated `CLAUDE.md`
    contains the "Exploration preference" section with all three
    anchor tool names.

### Changed
- `CLAUDE.md` template (`src/tools/init-project.ts`) gains a new top-
  level "Exploration preference — codebase-memory-mcp first" section.
- Test helper `initWithArch` / `initWithStateManager` in
  `tests/helpers/setup.ts` auto-seed codebase-memory registration so
  existing tests don't trip the new gate. Tests that specifically
  exercise the enforcement gate build state manually.
- `.mcp.json` stays pinned to `architect-to-product@2.0.1`;
  contributors who want Claude Code to load their local `dist/` copy
  the existing `.mcp.local.json.example` pattern. Re-pin to
  `architect-to-product@2.0.2` after publishing.

### Migration for existing A2P-initialized projects
1. Re-run `a2p_setup_companions` with a `codebase_memory` entry.
2. Run `mcp__codebase-memory__index_repository` once (takes minutes
   on large repos).
3. Call `a2p_verify_codebase_memory_index` with
   `indexed: true, lastIndexedAt: <ISO>`.
4. Proceed with `a2p_set_phase phase:"building"` as usual. The gate
   will now pass.
5. If you genuinely cannot run codebase-memory (e.g. tiny spike
   project, CI without the binary): set
   `architecture.bypassCodebaseMemory: true` with a rationale ≥ 20
   chars — the transition allows through with an audit log entry.

Full suite: 1448 → 1473 tests (+25). All green.

---

## v2.0.1 — MCP surface fix for v2 evidence-gated flow

### Fixed
- **Ship-blocker**: `src/server.ts` now exposes every v2 field through
  the `server.tool(...)` shape. In v2.0.0 the v2 fields were defined in
  the handler Zod schemas but the MCP tool registrations enumerated
  only v1 fields, so the MCP SDK's default `strip` on `z.object()`
  silently discarded every `systemsConcerns`, `systemsConcernTests`,
  `systemsConcernReviews`, `systemsClassification`, and
  `architecture.systems` the client sent — making evidence-gated v2
  flow unreachable via any MCP client.
- `src/server.ts`: `a2p_set_architecture` shape now includes
  `platform`, `systems`. `a2p_harden_requirements` includes
  `systemsConcerns`. `a2p_harden_tests` includes `systemsConcernTests`.
  `a2p_completion_review` includes `systemsConcernReviews`.
- `src/tools/create-build-plan.ts` + `src/tools/add-slice.ts`: slice
  sub-schemas gain `systemsClassification:
  z.array(SystemsConcernIdSchema).optional()`, and the `Slice`
  conversion now propagates it when non-empty.
- The committed `.mcp.json` continues to pin
  `architect-to-product@1.0.9` so contributors and external users get a
  stable server. Once v2.0.1 is published to npm, re-pin to the new
  version. In the meantime, developers who want Claude Code to load
  the local `dist/` can copy the new `.mcp.local.json.example` to an
  out-of-repo override (see README → Development).

### Added
- `tests/dogfood/v2-mcp-fullstack-invoice.test.ts` — wire-level
  regression test that spawns `dist/index.js` as a subprocess and
  drives the full v2 flow via the real MCP SDK. Asserts (a) each v2
  field appears on the registered tool's `inputSchema.properties`,
  (b) **three** slices walk all the way through to `done` with
  evidence persisted at every artifact level — slices 1 and 2 use
  explicit `systemsClassification`, slice 3 relies on the keyword-
  triggered applicability path (`RE_AUTH`, `RE_PERF_LOAD`) and
  exercises that `auth_permissions` + `performance_under_load` +
  `failure_modes` are inferred and enforced on the MCP wire, and
  (c) pre-RED gate rejects `ready_for_red` when `systemsConcerns` is
  missing for a required concern.
- `tests/integration/mcp-tool-shape-parity.test.ts` — meta-regression
  that spawns `dist/index.js`, lists tools, and for every v2 tool
  asserts every top-level field of the handler's Zod schema appears
  on the registered `inputSchema.properties`. Empirically proven to
  catch the original silent-drop failure mode (temporarily remove
  `systemsConcerns` from the `a2p_harden_requirements` shape in
  `server.ts` → test fails with precise diff).
- `.mcp.local.json.example` — template for contributors who want
  Claude Code to load their local `dist/` instead of the committed
  npm-pinned server. See README → Development.

### Discovered during run-2 dogfood
- See `dogfood/REPORT-RUN-2.md` for the full run with quantified
  signals, recurrence vs. run-1, and ship verdict.

### Preserved
- All v2.0.0 behavior (state migration, applicability rules,
  per-concern evidence, gates) is bit-for-bit identical. This is a
  surface-only fix.

---

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
