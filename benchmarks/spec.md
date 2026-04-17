# Benchmark spec — Shared Grocery List (small but complex)

Target: ~200 LOC TypeScript implementation exercised by a fixed 20-test battery.

Small surface, hidden complexity. Each implementation must export a single factory:

```ts
export function createApp(): App;
interface App {
  createItem(req: { userId: string; idempotencyKey?: string; name: string; quantity: number }): { ok: true; item: Item } | { ok: false; error: string; code: number };
  listItems(req: { userId: string; page?: number; pageSize?: number }): { ok: true; items: Item[]; total: number };
  deleteItem(req: { userId: string; itemId: string }): { ok: true } | { ok: false; error: string; code: number };
  restoreItem(req: { userId: string; itemId: string }): { ok: true; item: Item } | { ok: false; error: string; code: number };
  rateLimitFor(userId: string): { remaining: number; resetAt: number };
  auditLog(): AuditEntry[];
}
interface Item { id: string; userId: string; name: string; quantity: number; deletedAt: number | null; createdAt: number }
interface AuditEntry { at: number; userId: string; action: "create" | "delete" | "restore" | "list"; itemId?: string; note?: string }
```

Requirements:
1. `createItem`: 100 char max name, positive quantity, idempotent on same `(userId, idempotencyKey)` (returns existing item).
2. `listItems`: returns only items for this user, excluding soft-deleted. Pagination pageSize default 20, max 100.
3. `deleteItem`: soft-delete (`deletedAt = now`). Only the owner can delete. Attempting to delete someone else's item returns 404 (not 403 — don't leak existence).
4. `restoreItem`: restores if within 30 days of `deletedAt`. After 30 days, restore fails.
5. Rate limit: 10 writes / 60s per user (create, delete, restore all count).
6. Audit log: every action recorded with userId, action, itemId, timestamp.

Hidden traps the test battery probes:
- Cross-user: user A deletes user B's item → 404, not silent success.
- Duplicate idempotency key with different body: first-write-wins, second returns the first's result.
- List must not return other users' items.
- Soft-deleted items must NOT appear in list.
- Restoring after 30d expiry fails with a typed error.
- Rate limit resets at window boundary, not rolling.
- Audit log captures failed ops too (not just successful ones) — required for compliance.
- Name of 101 chars rejected.
- Quantity of 0 or negative rejected.
- pageSize of 101 clamped to 100.

## Scoring

Each implementation runs the 20-test battery. One test = one point.
- Test passes: 1
- Test fails: 0

Expected scores:
- Claude-alone: covers happy paths; misses cross-cutting traps. Expect 8-13/20.
- A2P v1 (TDD-enforced, no systems-concerns): covers explicit happy+error paths; usually misses cross-cutting invariants the LLM didn't spontaneously think of. Expect 13-17/20.
- A2P v2 (all 13 concerns forced into evidence): every concern is a forcing function. Expect 18-20/20.

The delta between v1 and v2 comes from forcing the LLM to write AC + tests + plan + review evidence for concerns it would otherwise omit (auth_permissions cross-user, concurrency_idempotency duplicate keys, observability audit log on failures, data_model soft-delete visibility, performance_under_load pagination clamp, etc.).
