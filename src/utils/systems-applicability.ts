/**
 * A2P v2 systems-engineering applicability rules.
 *
 * Given a slice + architecture, `computeRequiredConcerns` returns the set of
 * systems-engineering concerns that MUST carry structured evidence in the
 * hardening triad + completion review before the state-manager allows
 * `ready_for_red` and `done` transitions.
 *
 * The implementation is a pure, deterministic function — no I/O, no LLM calls
 * — so every rule is unit-testable and the set is stable across re-runs.
 *
 * Three layers, first-match wins per concern:
 *   1. Explicit override via `slice.systemsClassification` (user-authoritative).
 *   2. Structural signals from slice metadata (`type`, `hasUI`, AC text).
 *   3. Architecture signals (`techStack`, `architecture.systems.*`).
 *
 * `failure_modes` is required whenever ANY other systems concern fires or
 * whenever the project has opted into v2 via `architecture.systems`. Pure
 * cosmetic/copy slices with no other systems signals and no arch-level
 * systems block yield an empty required set — no gate fires.
 */

import type {
  Architecture,
  Slice,
  SystemsConcernId,
} from "../state/types.js";

// ---------------- keyword regexes ----------------
// Word-boundary, case-insensitive. Keep these narrow to limit false positives.

const RE_MIGRATIONS =
  /\b(migration|migrations|schema|alter table|drop column|rename column|add column|new table|data backfill)\b/i;

const RE_INTEGRATION_WEBHOOK_LIKE =
  /\b(webhook|callback|background|worker|queue|cron|retry|scheduled|stripe|payment|payments)\b/i;

const RE_API_SERVER_LIKE =
  /\b(api|endpoint|route|handler|controller|service|worker)\b/i;

const RE_AUTH =
  /\b(auth|login|session|token|permission|permissions|role|roles|rbac|tenant|tenants|authorization|authenticated)\b/i;

const RE_AS_A_ROLE = /\bas (an? )?[a-z-]+\b/i;

const RE_STATE_MACHINE =
  /\b(status|state machine|transition|transitions|workflow|lifecycle|phase|phases)\b/i;

const RE_PERF_LOAD =
  /\b(batch|bulk|scan|search|list|paginate|pagination|loop|n\+1)\b/i;

const RE_SECURITY =
  /\b(upload|file|password|crypto|token|secret|secrets|input|user-provided|public endpoint|webhook|xss|csrf|injection)\b/i;

const RE_MODEL_FILE = /(entity|repo|repository|model|domain|schema|db|database)/i;

const RE_TRANSITIONS_CONST = /TRANSITIONS|TRANSITION_TABLE/;

// ---------------- helpers ----------------

function sliceText(slice: Slice): string {
  return [
    slice.name,
    slice.description,
    ...(slice.acceptanceCriteria ?? []),
    ...(slice.testStrategy ? [slice.testStrategy] : []),
  ].join(" \u00a7 "); // non-word separator so word-boundary regexes don't cross fields
}

function touchesFiles(slice: Slice, regex: RegExp): boolean {
  const files = slice.files ?? [];
  if (files.some((f) => regex.test(f))) return true;
  // Plan-hardening finalPlan carries expected files pre-code; include it.
  const expected = slice.planHardening?.finalPlan?.expectedFiles ?? [];
  return expected.some((f) => regex.test(f));
}

function planTouchesExports(slice: Slice): boolean {
  const interfaces = slice.planHardening?.finalPlan?.interfacesToChange ?? [];
  return interfaces.length > 0;
}

// ---------------- public API ----------------

/**
 * Compute the set of systems-engineering concerns REQUIRED for this slice.
 *
 * Three layers, first-match wins per concern:
 *   1. Explicit user override via `slice.systemsClassification`. When present,
 *      it is AUTHORITATIVE for the positive set — only those concerns (plus
 *      `failure_modes` which is always-on) are required.
 *   2. Structural signals from slice metadata (type/hasUI/AC text).
 *   3. Architecture signals.
 *
 * @param slice         The slice being evaluated.
 * @param architecture  The project architecture (may be null during onboarding).
 * @returns             Set of concern IDs that require structured evidence.
 */
export function computeRequiredConcerns(
  slice: Slice,
  architecture: Architecture | null,
): Set<SystemsConcernId> {
  // Layer 1: explicit user override.
  // Non-empty override is authoritative; `failure_modes` is attached
  // because the slice has been classified as systems-relevant.
  if (slice.systemsClassification && slice.systemsClassification.length > 0) {
    const explicit = new Set<SystemsConcernId>(slice.systemsClassification);
    explicit.add("failure_modes");
    return explicit;
  }

  const required = new Set<SystemsConcernId>();
  const text = sliceText(slice);
  const db = architecture?.techStack?.database ?? null;
  const platform = architecture?.techStack?.platform ?? null;
  const isIntegration = slice.type === "integration";
  const isInfrastructure = slice.type === "infrastructure";

  // Layer 2: structural / keyword signals.

  // migrations
  if (RE_MIGRATIONS.test(text)) {
    required.add("migrations");
  }

  // concurrency_idempotency — integration slice AND webhook-like keywords
  if (isIntegration && RE_INTEGRATION_WEBHOOK_LIKE.test(text)) {
    required.add("concurrency_idempotency");
  }

  // observability — server platform AND api/worker-like keywords
  const isServerPlatform = platform === "web" || platform === "backend-only";
  if (isServerPlatform && RE_API_SERVER_LIKE.test(text)) {
    required.add("observability");
  }
  // integration slices always get observability too (external boundary)
  if (isIntegration) {
    required.add("observability");
  }

  // auth_permissions
  if (RE_AUTH.test(text) || RE_AS_A_ROLE.test(text)) {
    required.add("auth_permissions");
  }

  // api_contracts
  if (isIntegration) {
    required.add("api_contracts");
  }
  if (planTouchesExports(slice)) {
    required.add("api_contracts");
  }

  // data_model — architecture has a DB AND slice touches model-ish files
  if (db !== null && touchesFiles(slice, RE_MODEL_FILE)) {
    required.add("data_model");
  }

  // state_machine — keywords OR plan touches *TRANSITIONS constants
  if (RE_STATE_MACHINE.test(text) || touchesFiles(slice, RE_TRANSITIONS_CONST)) {
    required.add("state_machine");
  }

  // invariants — transitive: required when state_machine OR data_model fires
  if (required.has("state_machine") || required.has("data_model")) {
    required.add("invariants");
  }

  // performance_under_load — keywords OR infrastructure type
  if (RE_PERF_LOAD.test(text) || isInfrastructure) {
    required.add("performance_under_load");
  }

  // security — keywords
  if (RE_SECURITY.test(text)) {
    required.add("security");
  }

  // Layer 3: architecture-driven rules.
  const systems = architecture?.systems;
  if (systems) {
    // cache_invalidation — architecture declares a cache AND slice touches
    // cached surface (conservative: touches model files OR has "cache" keyword)
    if (
      systems.cacheStrategy?.layer &&
      systems.cacheStrategy.layer !== "none" &&
      (touchesFiles(slice, RE_MODEL_FILE) || /\bcache\b/i.test(text))
    ) {
      required.add("cache_invalidation");
    }

    // distributed_state — whenever topology is not single-process
    if (
      systems.distributedStateModel?.topology &&
      systems.distributedStateModel.topology !== "single-process"
    ) {
      required.add("distributed_state");
    }
  }

  // failure_modes is required when ANY other systems concern fires, OR when
  // the project has opted into v2 via architecture.systems. Pure cosmetic
  // slices (no other triggers, no arch-level systems block) stay empty.
  if (required.size > 0 || systems) {
    required.add("failure_modes");
  }

  return required;
}
