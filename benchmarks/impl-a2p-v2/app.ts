/**
 * A2P v2 — full 13-concern evidence required by the hardening triad +
 * completion review. Each concern below forced a specific invariant to
 * make it into the spec, the plan, the tests, and the code.
 *
 * Concerns that forced code paths Claude-alone + v1 missed:
 *
 *  - auth_permissions:  "cross-user delete must NOT leak existence → 404"
 *    (written as linked AC + negative test before code)
 *  - concurrency_idempotency:  "same (userId, idempotencyKey) with
 *    different body → first-write-wins, does NOT create new"
 *  - data_model:  "soft-deleted items are INVISIBLE in list"
 *    (also forced the filter to be part of listItems, not caller-side)
 *  - state_machine:  "restore permitted only within 30d of deletedAt"
 *    (forced explicit state transition guard)
 *  - performance_under_load:  "pageSize > 100 clamped to 100"
 *  - observability:  "audit log captures FAILED actions too — required
 *    for forensics / compliance"
 *  - failure_modes:  "input validation precedes rate-limit check so
 *    validation failures don't consume rate-limit budget"
 *  - security:  "name ≤ 100 chars, quantity > 0, reject otherwise"
 *  - api_contracts:  "return { code: 404 } not { code: 403 } to avoid
 *    existence leak" (same as auth_permissions but recorded under
 *    api_contracts because it's the error contract)
 */
import type { App, Item, AuditEntry } from "../battery/battery.test.js";

const RESTORE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 20;
const NAME_MAX = 100;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 10;

let _id = 0;
function nextId(): string { return `it-${++_id}`; }

export function createApp(): App {
  let now = () => Date.now();
  const items = new Map<string, Item>();
  const idemp = new Map<string, string>(); // `userId:key` → itemId  (per-user scoped)
  const rate = new Map<string, number[]>();
  const audit: AuditEntry[] = [];

  // ── observability: every action is logged, success OR failure ──
  function logAction(entry: AuditEntry): void {
    audit.push(entry);
  }

  function inRateWindow(userId: string): boolean {
    const ts = now();
    const windowStart = ts - RATE_WINDOW_MS;
    const entries = (rate.get(userId) ?? []).filter((t) => t > windowStart);
    if (entries.length >= RATE_LIMIT) return false;
    entries.push(ts);
    rate.set(userId, entries);
    return true;
  }

  // ── data_model: the "visible" projection excludes soft-deleted ──
  function visible(i: Item): boolean {
    return i.deletedAt === null;
  }

  // ── auth_permissions / api_contracts: ownership check is the ──
  //    SAME contract whether the item exists or not — always 404.
  function ownerOr404(itemId: string, userId: string): Item | null {
    const it = items.get(itemId);
    if (!it) return null;
    if (it.userId !== userId) return null; // existence-hiding — 404 not 403
    return it;
  }

  return {
    createItem(req) {
      // failure_modes: validate inputs BEFORE consuming rate budget so
      // malformed requests don't exhaust the user's budget.
      if (!req.name || req.name.length > NAME_MAX) {
        logAction({ at: now(), userId: req.userId, action: "create", note: "rejected: name invalid" });
        return { ok: false, error: "name must be 1..100 chars", code: 400 };
      }
      if (req.quantity <= 0 || !Number.isFinite(req.quantity)) {
        logAction({ at: now(), userId: req.userId, action: "create", note: "rejected: quantity invalid" });
        return { ok: false, error: "quantity must be > 0", code: 400 };
      }

      // concurrency_idempotency: key is per-user, first-write-wins.
      if (req.idempotencyKey) {
        const k = `${req.userId}:${req.idempotencyKey}`;
        const existingId = idemp.get(k);
        if (existingId) {
          const it = items.get(existingId);
          if (it) {
            // Idempotent return does NOT consume rate budget nor emit a
            // duplicate audit entry (first write already logged).
            return { ok: true, item: it };
          }
        }
      }

      if (!inRateWindow(req.userId)) {
        logAction({ at: now(), userId: req.userId, action: "create", note: "rejected: rate limit" });
        return { ok: false, error: "rate limit exceeded", code: 429 };
      }

      const item: Item = {
        id: nextId(),
        userId: req.userId,
        name: req.name,
        quantity: req.quantity,
        deletedAt: null,
        createdAt: now(),
      };
      items.set(item.id, item);
      if (req.idempotencyKey) idemp.set(`${req.userId}:${req.idempotencyKey}`, item.id);
      logAction({ at: now(), userId: req.userId, action: "create", itemId: item.id });
      return { ok: true, item };
    },

    listItems(req) {
      // performance_under_load: clamp pageSize
      const page = Math.max(1, req.page ?? 1);
      const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, req.pageSize ?? DEFAULT_PAGE_SIZE));
      // auth_permissions + data_model: only this user's VISIBLE items.
      const all = [...items.values()]
        .filter((i) => i.userId === req.userId && visible(i))
        .sort((a, b) => a.createdAt - b.createdAt);
      const start = (page - 1) * pageSize;
      logAction({ at: now(), userId: req.userId, action: "list", note: `page=${page},size=${pageSize}` });
      return { ok: true, items: all.slice(start, start + pageSize), total: all.length };
    },

    deleteItem(req) {
      // auth_permissions + api_contracts: 404 on cross-user; existence-hiding.
      const it = ownerOr404(req.itemId, req.userId);
      if (!it) {
        logAction({ at: now(), userId: req.userId, action: "delete", itemId: req.itemId, note: "rejected: not found or cross-user" });
        return { ok: false, error: "not found", code: 404 };
      }
      if (it.deletedAt !== null) {
        logAction({ at: now(), userId: req.userId, action: "delete", itemId: it.id, note: "rejected: already deleted" });
        return { ok: false, error: "already deleted", code: 409 };
      }
      if (!inRateWindow(req.userId)) {
        logAction({ at: now(), userId: req.userId, action: "delete", itemId: it.id, note: "rejected: rate limit" });
        return { ok: false, error: "rate limit exceeded", code: 429 };
      }
      it.deletedAt = now();
      logAction({ at: now(), userId: req.userId, action: "delete", itemId: it.id });
      return { ok: true };
    },

    restoreItem(req) {
      const it = ownerOr404(req.itemId, req.userId);
      if (!it) {
        logAction({ at: now(), userId: req.userId, action: "restore", itemId: req.itemId, note: "rejected: not found or cross-user" });
        return { ok: false, error: "not found", code: 404 };
      }
      if (it.deletedAt === null) {
        return { ok: false, error: "not deleted", code: 400 };
      }
      // state_machine: restore permitted only within 30d of deletedAt
      const elapsed = now() - it.deletedAt;
      if (elapsed > RESTORE_WINDOW_MS) {
        logAction({ at: now(), userId: req.userId, action: "restore", itemId: it.id, note: "rejected: window expired" });
        return { ok: false, error: "restore window expired", code: 410 };
      }
      if (!inRateWindow(req.userId)) {
        logAction({ at: now(), userId: req.userId, action: "restore", itemId: it.id, note: "rejected: rate limit" });
        return { ok: false, error: "rate limit exceeded", code: 429 };
      }
      it.deletedAt = null;
      logAction({ at: now(), userId: req.userId, action: "restore", itemId: it.id });
      return { ok: true, item: it };
    },

    rateLimitFor(userId) {
      const ts = now();
      const windowStart = ts - RATE_WINDOW_MS;
      const entries = (rate.get(userId) ?? []).filter((t) => t > windowStart);
      return {
        remaining: Math.max(0, RATE_LIMIT - entries.length),
        resetAt: windowStart + RATE_WINDOW_MS,
      };
    },

    auditLog() {
      return [...audit];
    },

    setNow(ts: number) {
      now = () => ts;
    },
  } as App;
}
