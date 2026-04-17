/**
 * Fixed 20-test battery for the shared-grocery-list benchmark.
 *
 * Each implementation exports `createApp()` matching the shape in
 * benchmarks/spec.md. This file is imported by three vitest configs,
 * one per implementation. See scripts/run-benchmark.mjs.
 */
import { describe, it, expect } from "vitest";

export type App = {
  createItem(req: { userId: string; idempotencyKey?: string; name: string; quantity: number }):
    | { ok: true; item: Item }
    | { ok: false; error: string; code: number };
  listItems(req: { userId: string; page?: number; pageSize?: number }): { ok: true; items: Item[]; total: number };
  deleteItem(req: { userId: string; itemId: string }): { ok: true } | { ok: false; error: string; code: number };
  restoreItem(req: { userId: string; itemId: string }):
    | { ok: true; item: Item }
    | { ok: false; error: string; code: number };
  rateLimitFor(userId: string): { remaining: number; resetAt: number };
  auditLog(): AuditEntry[];
};
export type Item = {
  id: string;
  userId: string;
  name: string;
  quantity: number;
  deletedAt: number | null;
  createdAt: number;
};
export type AuditEntry = {
  at: number;
  userId: string;
  action: "create" | "delete" | "restore" | "list";
  itemId?: string;
  note?: string;
};

export function runBattery(label: string, createApp: () => App): void {
  describe(`battery: ${label}`, () => {
    // ── happy paths (3) ─────────────────────────────────────────────
    it("1. create happy path returns ok=true with an item", () => {
      const app = createApp();
      const r = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.item.name).toBe("apples");
        expect(r.item.userId).toBe("u1");
        expect(r.item.quantity).toBe(2);
      }
    });

    it("2. list returns only this user's items", () => {
      const app = createApp();
      app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      app.createItem({ userId: "u2", name: "bread", quantity: 1 });
      const r = app.listItems({ userId: "u1" });
      expect(r.total).toBe(1);
      expect(r.items.every((i) => i.userId === "u1")).toBe(true);
    });

    it("3. delete removes item from list (soft-delete invisible on list)", () => {
      const app = createApp();
      const created = app.createItem({ userId: "u1", name: "eggs", quantity: 12 });
      if (!created.ok) throw new Error("setup");
      const d = app.deleteItem({ userId: "u1", itemId: created.item.id });
      expect(d.ok).toBe(true);
      const r = app.listItems({ userId: "u1" });
      expect(r.items.length).toBe(0);
    });

    // ── cross-user auth (3) — auth_permissions concern ──────────────
    it("4. user B cannot delete user A's item (returns 404 to avoid existence leak)", () => {
      const app = createApp();
      const created = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!created.ok) throw new Error("setup");
      const d = app.deleteItem({ userId: "u2", itemId: created.item.id });
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.code).toBe(404);
    });

    it("5. user B cannot restore user A's item", () => {
      const app = createApp();
      const created = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!created.ok) throw new Error("setup");
      app.deleteItem({ userId: "u1", itemId: created.item.id });
      const r = app.restoreItem({ userId: "u2", itemId: created.item.id });
      expect(r.ok).toBe(false);
    });

    it("6. list for user A does not leak user B's items even via pagination", () => {
      const app = createApp();
      const ext = app as unknown as { setNow?: (ts: number) => void };
      let t = Date.now();
      for (let i = 0; i < 30; i++) {
        if (i % 9 === 0 && typeof ext.setNow === "function") {
          t += 2 * 60_000;
          ext.setNow(t);
        }
        app.createItem({ userId: "u2", name: `other${i}`, quantity: 1, idempotencyKey: `k${i}` });
      }
      app.createItem({ userId: "u1", name: "mine", quantity: 1 });
      const r = app.listItems({ userId: "u1", page: 1, pageSize: 100 });
      expect(r.items.every((i) => i.userId === "u1")).toBe(true);
      expect(r.total).toBe(1);
    });

    // ── idempotency (2) — concurrency_idempotency concern ───────────
    it("7. same idempotency key returns first result (second call does NOT create new)", () => {
      const app = createApp();
      const r1 = app.createItem({ userId: "u1", idempotencyKey: "k1", name: "apples", quantity: 2 });
      const r2 = app.createItem({ userId: "u1", idempotencyKey: "k1", name: "apples", quantity: 2 });
      if (!r1.ok || !r2.ok) throw new Error("setup");
      expect(r1.item.id).toBe(r2.item.id);
      const l = app.listItems({ userId: "u1" });
      expect(l.total).toBe(1);
    });

    it("8. same idempotency key with DIFFERENT body returns first body (first-write-wins)", () => {
      const app = createApp();
      const r1 = app.createItem({ userId: "u1", idempotencyKey: "k2", name: "apples", quantity: 2 });
      const r2 = app.createItem({ userId: "u1", idempotencyKey: "k2", name: "oranges", quantity: 5 });
      if (!r1.ok || !r2.ok) throw new Error("setup");
      expect(r2.item.name).toBe("apples");
      expect(r2.item.quantity).toBe(2);
    });

    // ── input validation (3) ────────────────────────────────────────
    it("9. name longer than 100 chars is rejected", () => {
      const app = createApp();
      const r = app.createItem({ userId: "u1", name: "x".repeat(101), quantity: 1 });
      expect(r.ok).toBe(false);
    });

    it("10. quantity of 0 is rejected", () => {
      const app = createApp();
      const r = app.createItem({ userId: "u1", name: "apples", quantity: 0 });
      expect(r.ok).toBe(false);
    });

    it("11. negative quantity is rejected", () => {
      const app = createApp();
      const r = app.createItem({ userId: "u1", name: "apples", quantity: -1 });
      expect(r.ok).toBe(false);
    });

    // ── pagination (2) — data_model + performance_under_load ────────
    // Each batch create advances the mock clock by 2 minutes to clear the
    // rate-limit window, so all items actually get created.
    function bulkCreate(app: App, userId: string, count: number, base = Date.now()): void {
      const ext = app as unknown as { setNow?: (ts: number) => void };
      let t = base;
      for (let i = 0; i < count; i++) {
        if (i % 9 === 0 && typeof ext.setNow === "function") {
          t += 2 * 60_000;
          ext.setNow(t);
        }
        app.createItem({ userId, name: `i${i}`, quantity: 1, idempotencyKey: `k${i}` });
      }
    }

    it("12. pageSize of 101 is clamped to 100", () => {
      const app = createApp();
      bulkCreate(app, "u1", 150);
      const r = app.listItems({ userId: "u1", page: 1, pageSize: 101 });
      expect(r.items.length).toBeLessThanOrEqual(100);
    });

    it("13. default pageSize is 20", () => {
      const app = createApp();
      bulkCreate(app, "u1", 25);
      const r = app.listItems({ userId: "u1" });
      expect(r.items.length).toBe(20);
    });

    // ── soft-delete lifecycle (3) — state_machine + invariants ──────
    it("14. restore within 30 days succeeds", () => {
      const app = createApp();
      const c = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!c.ok) throw new Error("setup");
      app.deleteItem({ userId: "u1", itemId: c.item.id });
      const r = app.restoreItem({ userId: "u1", itemId: c.item.id });
      expect(r.ok).toBe(true);
      const l = app.listItems({ userId: "u1" });
      expect(l.total).toBe(1);
    });

    it("15. soft-deleted item does not appear in list", () => {
      const app = createApp();
      const c = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!c.ok) throw new Error("setup");
      app.deleteItem({ userId: "u1", itemId: c.item.id });
      const l = app.listItems({ userId: "u1" });
      expect(l.items.every((i) => i.deletedAt === null)).toBe(true);
    });

    it("16. restore after 30d window fails with a typed error", () => {
      const app = createApp();
      const c = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!c.ok) throw new Error("setup");
      app.deleteItem({ userId: "u1", itemId: c.item.id });
      // Mutate the deletedAt to 31 days ago via the audit log (implementations
      // MUST expose a testable clock or we'd need to wait 31 days). We use
      // a backdoor: setTime advances the app's clock if the app supports it.
      // If the implementation doesn't support clock injection, this test fails.
      const ext = app as unknown as { setNow?: (ts: number) => void };
      if (typeof ext.setNow === "function") {
        ext.setNow(Date.now() + 31 * 24 * 60 * 60 * 1000);
      }
      const r = app.restoreItem({ userId: "u1", itemId: c.item.id });
      expect(r.ok).toBe(false);
    });

    // ── rate limiting (2) — security + performance_under_load ───────
    it("17. after 10 writes the 11th is rate-limited", () => {
      const app = createApp();
      for (let i = 0; i < 10; i++) {
        app.createItem({ userId: "u1", name: `i${i}`, quantity: 1, idempotencyKey: `k${i}` });
      }
      const r = app.createItem({ userId: "u1", name: "extra", quantity: 1 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe(429);
    });

    it("18. rate limit is per-user (u2 unaffected by u1's usage)", () => {
      const app = createApp();
      for (let i = 0; i < 10; i++) {
        app.createItem({ userId: "u1", name: `i${i}`, quantity: 1, idempotencyKey: `k${i}` });
      }
      const r = app.createItem({ userId: "u2", name: "mine", quantity: 1 });
      expect(r.ok).toBe(true);
    });

    // ── observability (2) — observability concern ───────────────────
    it("19. audit log records successful actions with userId + itemId", () => {
      const app = createApp();
      const c = app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      if (!c.ok) throw new Error("setup");
      app.deleteItem({ userId: "u1", itemId: c.item.id });
      const log = app.auditLog();
      const actions = log.map((e) => e.action);
      expect(actions).toContain("create");
      expect(actions).toContain("delete");
    });

    it("20. audit log captures FAILED actions too (required for compliance/forensics)", () => {
      const app = createApp();
      app.createItem({ userId: "u1", name: "apples", quantity: 2 });
      app.deleteItem({ userId: "u2", itemId: "nonexistent" }); // cross-user attempt, FAILS
      const log = app.auditLog();
      // A delete attempt must appear even though it failed
      const deleteEntries = log.filter((e) => e.action === "delete");
      expect(deleteEntries.length).toBeGreaterThanOrEqual(1);
    });
  });
}
