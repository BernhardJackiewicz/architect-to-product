/**
 * Claude 4.7 alone — one-shot generation from the spec.
 *
 * What "Claude alone" tends to produce: the happy path works, obvious
 * error handling is present (string validation, negative quantity), but:
 *   - cross-user auth: not enforced; returns generic 403 instead of 404;
 *     sometimes leaks existence via ok=false messages.
 *   - idempotency: maybe implemented as "same body returns same id" but
 *     first-write-wins semantics not respected; also sometimes implemented
 *     via in-memory key but without scoping per user.
 *   - pagination clamping: commonly forgotten.
 *   - audit log: present but typically only records SUCCESSFUL ops.
 *   - rate limit: often implemented but resets are rolling not window-based,
 *     and sometimes the limit is global not per-user.
 *   - soft-delete / restore-after-30d: the 30d expiry check is often missing.
 *
 * This file is the implementation as it typically comes out of a one-shot
 * Claude generation with the spec as input. It is intentionally imperfect
 * to reflect empirical behavior, not a caricature.
 */

import type { App, Item, AuditEntry } from "../battery/battery.test.js";

let _id = 0;
function nextId(): string {
  return `it-${++_id}`;
}

export function createApp(): App {
  let now = () => Date.now();
  const items = new Map<string, Item>();
  const idemp = new Map<string, string>(); // key → itemId
  const rate = new Map<string, number[]>(); // userId → write timestamps
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
      if (!checkRate(req.userId)) return { ok: false, error: "rate limit", code: 429 };
      if (req.idempotencyKey) {
        const existingId = idemp.get(req.idempotencyKey);
        if (existingId) {
          const it = items.get(existingId);
          if (it) return { ok: true, item: it };
        }
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
      if (req.idempotencyKey) idemp.set(req.idempotencyKey, item.id);
      audit.push({ at: now(), userId: req.userId, action: "create", itemId: item.id });
      return { ok: true, item };
    },

    listItems(req) {
      // BUG: no pageSize clamp; pageSize defaults to 20 which is correct
      const page = req.page ?? 1;
      const pageSize = req.pageSize ?? 20;
      const all = [...items.values()].filter((i) => i.userId === req.userId && i.deletedAt === null);
      const start = (page - 1) * pageSize;
      return { ok: true, items: all.slice(start, start + pageSize), total: all.length };
    },

    deleteItem(req) {
      const it = items.get(req.itemId);
      if (!it) return { ok: false, error: "not found", code: 404 };
      // BUG: 403 when it's someone else's — leaks existence
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
      // BUG: no 30-day expiry check
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

    // Test backdoor
    setNow(ts: number) {
      now = () => ts;
    },
  } as App;
}
