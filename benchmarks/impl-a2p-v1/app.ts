/**
 * A2P v1 — TDD-driven (hardening triad, test-first guard, completion review)
 * but WITHOUT per-concern systems-engineering evidence.
 *
 * v1 enforces: tests first, plan compliance, completion review, SAST, etc.
 * It does NOT enforce: explicit coverage of auth_permissions cross-user
 * semantics, concurrency_idempotency first-write-wins, data_model
 * soft-delete invisibility in list, observability of FAILED actions,
 * performance_under_load pagination clamping.
 *
 * What v1 tends to fix that claude-alone misses:
 *   - Tests first → actual pagination logic exists and default=20 works.
 *   - Tests first → rate-limit per-user (tests caught that it was global).
 *   - Tests first → cross-user delete returns a NON-success, though v1's
 *     LLM usually still returns 403 rather than 404 unless explicitly prompted.
 *   - First-write-wins idempotency tends to get caught because the TDD
 *     loop usually adds a "same key, different body" test during harden_tests.
 *
 * What v1 still misses:
 *   - Cross-user 404-vs-403 subtlety (no auth_permissions concern to force it).
 *   - Observability on FAILED actions (failure-mode isn't explicit).
 *   - 30-day restore expiry (no state_machine concern to make the lifecycle explicit).
 *   - pageSize clamp = 100 (no performance_under_load concern).
 */
import type { App, Item, AuditEntry } from "../battery/battery.test.js";

let _id = 0;
function nextId(): string { return `it-${++_id}`; }

export function createApp(): App {
  let now = () => Date.now();
  const items = new Map<string, Item>();
  const idemp = new Map<string, string>();
  const rate = new Map<string, number[]>();
  const audit: AuditEntry[] = [];

  function checkRate(userId: string): boolean {
    const ts = now();
    const windowStart = ts - 60_000;
    const entries = (rate.get(userId) ?? []).filter((t) => t > windowStart);
    if (entries.length >= 10) return false;
    entries.push(ts);
    rate.set(userId, entries);
    return true;
  }

  return {
    createItem(req) {
      if (!req.name || req.name.length > 100) return { ok: false, error: "name invalid", code: 400 };
      if (req.quantity <= 0) return { ok: false, error: "quantity must be positive", code: 400 };
      if (req.idempotencyKey) {
        const existing = idemp.get(`${req.userId}:${req.idempotencyKey}`);
        if (existing) {
          const it = items.get(existing);
          if (it) return { ok: true, item: it }; // first-write-wins
        }
      }
      if (!checkRate(req.userId)) return { ok: false, error: "rate limit", code: 429 };
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
      audit.push({ at: now(), userId: req.userId, action: "create", itemId: item.id });
      return { ok: true, item };
    },

    listItems(req) {
      // v1 TDD: a "max pageSize" test got written during harden_tests so
      // this clamp exists. But the clamp value (100) required a test that
      // specifically probed boundaries — not all TDD runs would add it.
      const page = req.page ?? 1;
      const pageSize = Math.min(100, req.pageSize ?? 20);
      const all = [...items.values()]
        .filter((i) => i.userId === req.userId && i.deletedAt === null)
        .sort((a, b) => a.createdAt - b.createdAt);
      const start = (page - 1) * pageSize;
      return { ok: true, items: all.slice(start, start + pageSize), total: all.length };
    },

    deleteItem(req) {
      const it = items.get(req.itemId);
      if (!it) return { ok: false, error: "not found", code: 404 };
      // BUG: 403 leaks existence — no auth_permissions concern to make 404 explicit
      if (it.userId !== req.userId) return { ok: false, error: "forbidden", code: 403 };
      if (!checkRate(req.userId)) return { ok: false, error: "rate limit", code: 429 };
      it.deletedAt = now();
      audit.push({ at: now(), userId: req.userId, action: "delete", itemId: it.id });
      return { ok: true };
    },

    restoreItem(req) {
      const it = items.get(req.itemId);
      if (!it) return { ok: false, error: "not found", code: 404 };
      if (it.userId !== req.userId) return { ok: false, error: "forbidden", code: 403 };
      if (it.deletedAt === null) return { ok: false, error: "not deleted", code: 400 };
      // BUG: v1 missed the 30-day expiry (no state_machine concern forced it into the spec)
      if (!checkRate(req.userId)) return { ok: false, error: "rate limit", code: 429 };
      it.deletedAt = null;
      audit.push({ at: now(), userId: req.userId, action: "restore", itemId: it.id });
      return { ok: true, item: it };
    },

    rateLimitFor(userId) {
      const ts = now();
      const windowStart = ts - 60_000;
      const entries = (rate.get(userId) ?? []).filter((t) => t > windowStart);
      return { remaining: Math.max(0, 10 - entries.length), resetAt: windowStart + 60_000 };
    },

    auditLog() {
      return [...audit];
    },

    setNow(ts: number) {
      now = () => ts;
    },
  } as App;
}
