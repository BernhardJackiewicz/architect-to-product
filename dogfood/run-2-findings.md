# A2P v2 full-stack dogfood run-2 — findings log

**Archived**: originally authored in
`/Users/bernhard/Desktop/a2p-v2-dogfood-run2/FINDINGS.md` during run-2
as a chronological scratchpad. Moved into the repo for durability
after the dogfood dir was cleaned up. See `dogfood/REPORT-RUN-2.md`
for the synthesized report.

Chronological record of friction encountered while driving A2P v2 through
a Mini-Invoice-Generator library via the MCP surface. Each entry documents
the full context so the reader can diagnose root cause without replaying
the session.

---

## Finding #0 — `.mcp.json` pins `architect-to-product` to pre-v2 npm version 1.0.9 (SHIP-BLOCKER)

**Severity**: ship-blocker for v2 via the live MCP path

**Discovered**: when the first `a2p_harden_requirements` call returned
`No such tool available`. Initial hypothesis was that the harden tools
weren't registered in the local `dist/`. `grep -n 'server.tool("a2p_harden_'`
against `dist/server.js` returned five registrations — they WERE in dist.
The tool just wasn't on the wire in the live Claude Code session because
the session was running a different server.

**Root cause**: `/Users/bernhard/Desktop/architect-to-product/.mcp.json`
pointed to `npx -y architect-to-product@1.0.9` — pre-v2, predates all of
hardening, completion_review, verify_test_first. Every Claude Code
session on this repo therefore runs a v1.0.9 MCP server, not the local
`dist/index.js`. Documentation that v2 tools were "live" was incorrect.

**What I changed**: Updated `.mcp.json` to `{"command": "node", "args":
["/Users/bernhard/Desktop/architect-to-product/dist/index.js"]}` so
future sessions pick up the local v2 build. Absolute path is used
because the committed file has no portable way to reference the repo
root. A future v2 npm publish + version pin would be a better fix.

**Post-run residue**: the current Claude Code session cannot hot-reload
its MCP server, so it continues running v1.0.9 for the rest of this
session. All v2 MCP exercise in run-2 proceeds via a **spawn-based
test** that launches `node dist/index.js` as a subprocess and speaks
the MCP JSON-RPC protocol via `@modelcontextprotocol/sdk`'s `Client` +
`StdioClientTransport`.

---

## Finding #1 — MCP `server.tool(...)` registrations drop every v2 field (SHIP-BLOCKER)

**Severity**: ship-blocker for v2 evidence-gated flow via any MCP client

**Discovered**: pre-spawn-test, via grep. `grep -n
'systemsConcerns\|systemsConcernTests\|systemsConcernReviews\|systemsConcernPlans\|systemsClassification\|shape.systems'
src/server.ts` → **0 matches**. Cross-referenced: every v2 field was
defined in the handler's Zod schema (`src/tools/*.ts`) but not
destructured into the `server.tool()` shape.

**Why it mattered**: The MCP SDK's `server.tool(name, desc, shape, handler)`
signature builds `z.object(shape)` from the top-level shape. Zod's
default behavior for unknown keys on `z.object()` is `strip`, so any
v2 field the client sent was silently dropped before the handler ran.
The handler then persisted a hardening/review record without v2
evidence, and the pre-RED / pre-DONE gates fired on the next transition.

**Concrete gaps (before fix)**:
- `a2p_set_architecture`: missing `platform`, `systems`
- `a2p_harden_requirements`: missing `systemsConcerns`
- `a2p_harden_tests`: missing `systemsConcernTests`
- `a2p_completion_review`: missing `systemsConcernReviews`
- `a2p_create_build_plan` slice schema: missing `systemsClassification`
  entirely (not even declared at the Zod-schema layer)
- `a2p_add_slice` slice schema: same (missing `systemsClassification`)

**Root cause**: v2 merge added the fields to the handler Zod schemas
but forgot the mirror entries in `server.ts` AND forgot to add
`systemsClassification` to the slice sub-schema in `create-build-plan.ts`
/ `add-slice.ts`.

**Why no existing test caught it**: the v2 e2e dogfood test
(`tests/dogfood/v2-link-shortener-e2e.test.ts`) calls the tool
**handlers** directly, bypassing the MCP `server.tool` registration
layer. `tests/integration/mcp-dry-run.test.ts` spawns MCP servers but
only calls `listTools()` — never `callTool()` with payloads. No test
stood between the client-visible schema and the handler.

**What I changed**:
1. `src/server.ts`:
   - `a2p_set_architecture` shape gets `platform`, `systems`
   - `a2p_harden_requirements` shape gets `systemsConcerns`
   - `a2p_harden_tests` shape gets `systemsConcernTests`
   - `a2p_completion_review` shape gets `systemsConcernReviews`
2. `src/tools/create-build-plan.ts`:
   - slice sub-schema gains `systemsClassification: z.array(SystemsConcernIdSchema).optional()`
   - `Slice` conversion propagates it when non-empty
3. `src/tools/add-slice.ts`: same as above
4. New wire-level regression test `tests/dogfood/v2-mcp-fullstack-invoice.test.ts`
   that (a) asserts each v2 field appears on the JSON-Schema reflection
   of the registered tools, (b) walks a 2-slice Invoice Generator
   through the full v2 flow via the real MCP SDK, and (c) confirms the
   pre-RED gate rejects `ready_for_red` when `systemsConcerns` is
   missing for a required concern.

Regression suite: 1434 tests before → 1437 tests after. All green.

---

## Finding #2 — `--reporter=basic` no longer valid in vitest 4.x

**Severity**: documentation / ergonomic (not an A2P bug)

**Discovered**: while building the spawn test. Running `npx vitest run
--reporter=basic` against vitest 4.1.4 produced `Failed to load custom
Reporter from basic`. vitest 4 removed the `basic` reporter; the
default is now compact-enough that no `--reporter` flag is needed.

**Impact**: prompts and documentation that tell users to run
`npx vitest run --reporter=basic` will fail silently on vitest ≥ 4.
Not an A2P bug per se — but if any A2P prompt snippet recommends that
flag, it should be removed.

**Action**: not applied in this run (no such snippet found via grep).
Flagged for future vitest-version audits.

---

## Finding #3 — post-SAST freshness gate requires an extra `run_tests` before `completion_review`

**Severity**: workflow nuance (not a bug, but non-obvious on first encounter)

**Discovered**: mid-spawn-test. The first time slice 1 tried to
transition `sast → done`, the state manager refused with:
> `Slice "s01": tests must be re-run after SAST scan. Last test: ...
> SAST: ...`

**Context**: After `a2p_run_sast`, the SAST run is newer than the last
test run. The state-manager requires test-freshness against the SAST
timestamp so a user can't accept a SAST finding by stale tests. The
fix is simple — run `a2p_run_tests` once more between `update_slice
status=sast` and `a2p_completion_review`.

**Why this surfaced in dogfood**: the `a2p_build_slice` prompt doesn't
explicitly list this extra step between SAST and completion_review.
Experienced users implicitly re-run; a first-time user trips. Worth a
one-line addition to the build-slice prompt.

**Action**: not applied to prompts in run-2; flagged as a minor v2.1
prompt improvement.

---

## Finding #4 — `oversight.sliceReview: "off"` required explicit pass through (followed up in #1 fix)

**Severity**: resolved during #1

Minor confusion: the set-architecture oversight block accepts
`sliceReview` but not `reviewMode` at the top-level of the oversight
object — they're separate fields on the Architecture. Once I used the
correct nesting (`oversight: {sliceReview: "off", ...}` for
per-slice-review and top-level `reviewMode` for the legacy flag), it
worked. Already covered by the general oversight docs.

---

## Findings that did NOT recur from run-1's REPORT.md

- **Finding 1 (run-1): `RE_AUTH` regex missed common tenant-scoping phrasing** — the fix is still in place. My slice descriptions triggered auth_permissions cleanly via keywords.
- **Finding 2 (run-1): `api_contracts` lifecycle hazard** — the plan-derived trigger is still removed. No requirements/plan-ordering loop encountered.
- **Finding 3–5 (run-1)**: harness-local dogfood bugs. N/A to run-2.

---

## Outstanding v2.1 suggestions

1. **Prompt: add post-SAST freshness reminder.** Insert a one-liner in
   `build-slice.ts` between the SAST section and the completion_review
   section: "After `a2p_run_sast`, re-run `a2p_run_tests` to prove
   green under fresh analysis before `a2p_completion_review`."
2. **Prompt: explicit `status` workflow glossary.** The valid slice
   status enum — `pending → ready_for_red → red → green → refactor →
   sast → completion_fix? → done` — is scattered across tool
   descriptions. A single reference table in `build-slice.ts` would
   save the "what comes next" lookup.
3. **Repo hygiene: `.mcp.json` should not pin to a published version
   in a repo whose local `dist/` is the source of truth for that
   package.** Either commit a `.mcp.local.json` override strategy or
   document a clear update cadence when publishing.
4. **Test coverage gap: no test exists between the MCP tool
   registration and the handler.** The new
   `tests/dogfood/v2-mcp-fullstack-invoice.test.ts` closes this for v2,
   but each future tool surface change risks the same class of bug. A
   small "shape parity" test — for every `server.tool(name, desc,
   shape, handler)` assert that every non-internal property of the
   handler's Zod schema appears in `shape` — would make Finding #1 a
   compile-time regression impossibility.
