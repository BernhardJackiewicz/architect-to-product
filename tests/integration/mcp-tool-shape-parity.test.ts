/**
 * Shape-parity regression guard.
 *
 * The MCP SDK's `server.tool(name, desc, shape, handler)` signature
 * builds `z.object(shape)` from the top-level shape. Zod's default
 * behavior for unknown keys on `z.object()` is `strip`, so any field
 * the client sends that isn't listed in `shape` is silently dropped
 * before the handler runs. Run-2 of the v2 dogfood (see
 * `dogfood/REPORT-RUN-2.md`) hit exactly this: the v2 merge added new
 * fields to each handler's Zod schema but forgot to mirror them into
 * the `server.tool(...)` shape, so every v2 field was silently lost
 * on the wire.
 *
 * This test spawns the compiled `dist/index.js` as an MCP subprocess,
 * enumerates the registered tools, and — for every tool we care about
 * — asserts that every top-level field of the handler's Zod schema
 * appears as a property on the registered `inputSchema`. Any drift
 * fails the test with a precise diff so the author sees exactly which
 * field is missing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Handler Zod schemas — import the .shape of each.
import { setArchitectureSchema } from "../../src/tools/set-architecture.js";
import { createBuildPlanSchema } from "../../src/tools/create-build-plan.js";
import { addSliceSchema } from "../../src/tools/add-slice.js";
import { updateSliceSchema } from "../../src/tools/update-slice.js";
import { hardenRequirementsSchema } from "../../src/tools/harden-requirements.js";
import { hardenTestsSchema } from "../../src/tools/harden-tests.js";
import { hardenPlanSchema } from "../../src/tools/harden-plan.js";
import { verifyTestFirstSchema } from "../../src/tools/verify-test-first.js";
import { completionReviewSchema } from "../../src/tools/completion-review.js";
import { runTestsSchema } from "../../src/tools/run-tests.js";
import { runSastSchema } from "../../src/tools/run-sast.js";

const PROJECT_ROOT = resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../..",
);
const DIST_ENTRY = join(PROJECT_ROOT, "dist", "index.js");

/**
 * Top-level Zod schema keys. Unwraps `.shape` directly — this test
 * intentionally doesn't traverse nested schemas because the MCP
 * server registration is a flat top-level map.
 */
function zodTopLevelKeys(schema: { shape: Record<string, unknown> }): string[] {
  return Object.keys(schema.shape).sort();
}

/**
 * Top-level keys published on the wire for a given tool. Reads the
 * tool's declared `inputSchema.properties`.
 */
function wireTopLevelKeys(tool: { inputSchema: unknown }): string[] {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> };
  return Object.keys(schema.properties ?? {}).sort();
}

let client: Client;
let transport: StdioClientTransport;
let wireTools: Map<string, { inputSchema: unknown }>;

beforeAll(async () => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `dist entry not found at ${DIST_ENTRY}. Run 'npm run build' first.`,
    );
  }
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [DIST_ENTRY],
    stderr: "pipe",
  });
  client = new Client({
    name: "mcp-tool-shape-parity-test",
    version: "0.0.1",
  });
  await client.connect(transport, { timeout: 20_000 });
  const { tools } = await client.listTools(undefined, { timeout: 10_000 });
  wireTools = new Map(tools.map((t) => [t.name, t]));
}, 30_000);

afterAll(async () => {
  try {
    await client?.close();
  } catch {
    /* best-effort */
  }
});

/**
 * Drives one parity assertion: every top-level Zod key must appear on
 * the wire. We intentionally do NOT assert the converse — the wire
 * may expose strictly fewer keys than the schema only if the schema
 * field is marked "internal" via the allowlist below. Today the
 * allowlist is empty because run-2 showed that the "silently dropped"
 * failure mode is far more dangerous than having one extra knob on
 * the MCP surface.
 */
function assertParity(
  toolName: string,
  schema: { shape: Record<string, unknown> },
  allowSchemaOnly: Set<string> = new Set(),
): void {
  const tool = wireTools.get(toolName);
  expect(tool, `tool "${toolName}" is not registered on the MCP wire`).toBeDefined();

  const expected = zodTopLevelKeys(schema);
  const actual = wireTopLevelKeys(tool!);

  const missing = expected.filter(
    (k) => !actual.includes(k) && !allowSchemaOnly.has(k),
  );
  expect(
    missing,
    `Tool "${toolName}" — handler Zod schema declares [${missing.join(", ")}] but MCP inputSchema.properties does not expose them. ` +
      `Mirror the fields into the server.tool(...) shape in src/server.ts, or add them to allowSchemaOnly with a written rationale.`,
  ).toEqual([]);
}

describe("MCP tool shape parity — handler Zod schemas vs. registered inputSchema", () => {
  it("a2p_set_architecture", () => {
    assertParity("a2p_set_architecture", setArchitectureSchema);
  });

  it("a2p_create_build_plan", () => {
    assertParity("a2p_create_build_plan", createBuildPlanSchema);
  });

  it("a2p_add_slice", () => {
    assertParity("a2p_add_slice", addSliceSchema);
  });

  it("a2p_update_slice", () => {
    assertParity("a2p_update_slice", updateSliceSchema);
  });

  it("a2p_harden_requirements", () => {
    assertParity("a2p_harden_requirements", hardenRequirementsSchema);
  });

  it("a2p_harden_tests", () => {
    assertParity("a2p_harden_tests", hardenTestsSchema);
  });

  it("a2p_harden_plan", () => {
    assertParity("a2p_harden_plan", hardenPlanSchema);
  });

  it("a2p_verify_test_first", () => {
    assertParity("a2p_verify_test_first", verifyTestFirstSchema);
  });

  it("a2p_completion_review", () => {
    assertParity("a2p_completion_review", completionReviewSchema);
  });

  it("a2p_run_tests", () => {
    assertParity("a2p_run_tests", runTestsSchema);
  });

  it("a2p_run_sast", () => {
    assertParity("a2p_run_sast", runSastSchema);
  });
});
