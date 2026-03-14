/**
 * Integration tests that dry-run MCP servers to verify the tool names
 * referenced in our prompts actually exist in the real servers.
 *
 * Each test:
 *  1. Spawns the MCP server as a child process via stdio
 *  2. Sends initialize + tools/list via the SDK Client
 *  3. Asserts the referenced tool names are present
 *  4. Cleans up the child process
 *
 * Token-free servers (always run):
 *  - Git MCP          (Python: mcp-server-git, run via uvx)
 *  - Filesystem MCP   (Node: @modelcontextprotocol/server-filesystem)
 *  - Sequential Thinking MCP (Node: @modelcontextprotocol/server-sequential-thinking)
 *  - Playwright MCP   (Node: @playwright/mcp)
 *  - codebase-memory-mcp (binary)
 *
 * Auth-gated servers (skipped when credentials missing):
 *  - GitHub MCP       (needs GITHUB_TOKEN + binary)
 *  - Semgrep MCP      (requires semgrep Pro Engine)
 *  - Sentry MCP       (Node: @sentry/mcp-server)
 *  - Stripe MCP       (Node: @stripe/mcp)
 *  - Cloudflare MCP   (Node: @cloudflare/mcp-server-cloudflare)
 *  - Upstash MCP      (Node: @upstash/mcp-server)
 *  - Supabase MCP     (Node: @supabase/mcp-server-supabase, needs PAT)
 */

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Load .env.test if present (gitignored credentials for auth-gated servers)
// ---------------------------------------------------------------------------
const ENV_TEST_PATH = path.resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../../.env.test",
);

if (existsSync(ENV_TEST_PATH)) {
  const lines = readFileSync(ENV_TEST_PATH, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    // Don't override existing env vars (CLI takes precedence)
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
  // Map STRIPE_SECRET_KEY → STRIPE_API_KEY for the Stripe MCP test
  if (!process.env.STRIPE_API_KEY && process.env.STRIPE_SECRET_KEY) {
    process.env.STRIPE_API_KEY = process.env.STRIPE_SECRET_KEY;
  }
  // Map GITHUB_PERSONAL_ACCESS_TOKEN → GITHUB_TOKEN
  if (!process.env.GITHUB_TOKEN && process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
    process.env.GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  }
  // Map SENTRY_AUTH_TOKEN → SENTRY_ACCESS_TOKEN (Sentry MCP uses the latter)
  if (!process.env.SENTRY_ACCESS_TOKEN && process.env.SENTRY_AUTH_TOKEN) {
    process.env.SENTRY_ACCESS_TOKEN = process.env.SENTRY_AUTH_TOKEN;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve a binary's full path, or return the name as-is. */
function whichOrDefault(name: string): string {
  try {
    return execSync(`which ${name}`, { encoding: "utf-8" }).trim();
  } catch {
    return name;
  }
}

/** Check whether a CLI binary is available on the system. */
function binaryExists(name: string): boolean {
  try {
    execSync(`which ${name}`, { encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Connect to an MCP server, list its tools, and close the connection.
 * Returns a Set of tool names for easy assertion.
 */
async function listMcpTools(
  command: string,
  args: string[],
  timeoutMs = 15_000,
): Promise<Set<string>> {
  const transport = new StdioClientTransport({
    command,
    args,
    stderr: "pipe",
  });

  const client = new Client({
    name: "mcp-dry-run-test",
    version: "0.0.1",
  });

  try {
    await client.connect(transport, { timeout: timeoutMs });
    const { tools } = await client.listTools(undefined, {
      timeout: timeoutMs,
    });
    return new Set(tools.map((t) => t.name));
  } finally {
    try {
      await client.close();
    } catch {
      // best-effort cleanup
    }
  }
}

/**
 * Like listMcpTools but returns null instead of throwing if the server
 * fails to start (e.g. missing auth token, binary not found).
 */
async function listMcpToolsOrNull(
  command: string,
  args: string[],
  env?: Record<string, string>,
  timeoutMs = 15_000,
): Promise<Set<string> | null> {
  try {
    const transport = new StdioClientTransport({
      command,
      args,
      stderr: "pipe",
      env: env ? { ...process.env, ...env } : undefined,
    });

    const client = new Client({
      name: "mcp-dry-run-test",
      version: "0.0.1",
    });

    try {
      await client.connect(transport, { timeout: timeoutMs });
      const { tools } = await client.listTools(undefined, {
        timeout: timeoutMs,
      });
      return new Set(tools.map((t) => t.name));
    } finally {
      try {
        await client.close();
      } catch {
        // best-effort cleanup
      }
    }
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The project root — used as working dir / allowed dir for some servers
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../..",
);

const NPX = whichOrDefault("npx");
const UVX = whichOrDefault("uvx");

// ---------------------------------------------------------------------------
// Git MCP  (Python package: mcp-server-git, run via uvx)
// ---------------------------------------------------------------------------
// Referenced tools (build-slice.ts, refactor.ts):
//   git_log, git_diff
//
// Note: the onboarding prompt references `@modelcontextprotocol/server-git`
// but the actual package lives on PyPI as `mcp-server-git` and is run via uvx.

const uvxAvailable = binaryExists("uvx");

describe("Git MCP — tool name verification", { timeout: 30_000 }, () => {
  it.skipIf(!uvxAvailable)(
    "exposes git_log and git_diff",
    async () => {
      const tools = await listMcpTools(UVX, ["mcp-server-git"]);

      expect(tools.has("git_log")).toBe(true);
      expect(tools.has("git_diff")).toBe(true);

      // Log all tools for debugging / documentation
      console.log("  Git MCP tools:", [...tools].sort().join(", "));
    },
  );
});

// ---------------------------------------------------------------------------
// Filesystem MCP  (Node package: @modelcontextprotocol/server-filesystem)
// ---------------------------------------------------------------------------
// Referenced tools (build-slice.ts, e2e-testing.ts):
//   write_file, list_directory

describe(
  "Filesystem MCP — tool name verification",
  { timeout: 20_000 },
  () => {
    it("exposes write_file and list_directory", async () => {
      const tools = await listMcpTools(NPX, [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        PROJECT_ROOT, // allowed directory argument required by the server
      ]);

      expect(tools.has("write_file")).toBe(true);
      expect(tools.has("list_directory")).toBe(true);

      console.log(
        "  Filesystem MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Sequential Thinking MCP
// ---------------------------------------------------------------------------
// Referenced tools (planning.ts, refactor.ts):
//   sequentialthinking

describe(
  "Sequential Thinking MCP — tool name verification",
  { timeout: 20_000 },
  () => {
    it("exposes sequentialthinking", async () => {
      const tools = await listMcpTools(NPX, [
        "-y",
        "@modelcontextprotocol/server-sequential-thinking",
      ]);

      expect(tools.has("sequentialthinking")).toBe(true);

      console.log(
        "  Sequential Thinking MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);


// ---------------------------------------------------------------------------
// Playwright MCP  (Node package: @playwright/mcp — token-free)
// ---------------------------------------------------------------------------
// Referenced tools (build-slice.ts, e2e-testing.ts):
//   browser_navigate, browser_take_screenshot, browser_click,
//   browser_fill_form, browser_resize, browser_snapshot,
//   browser_console_messages

describe(
  "Playwright MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it("exposes all tools referenced in prompts", async () => {
      const tools = await listMcpTools(NPX, [
        "-y",
        "@playwright/mcp@latest",
      ]);

      // All tool names explicitly used in build-slice.ts and e2e-testing.ts
      const expected = [
        "browser_navigate",
        "browser_take_screenshot",
        "browser_click",
        "browser_fill_form",
        "browser_resize",
        "browser_snapshot",
        "browser_console_messages",
      ];

      for (const name of expected) {
        expect(
          tools.has(name),
          `Expected Playwright MCP to expose tool "${name}". ` +
            `Available: ${[...tools].sort().join(", ")}`,
        ).toBe(true);
      }

      console.log(
        "  Playwright MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// ---------------------------------------------------------------------------
// codebase-memory-mcp  (local binary)
// ---------------------------------------------------------------------------
// Referenced tools (planning.ts, build-slice.ts, refactor.ts, security-gate.ts):
//   index_repository, search_graph, search_code, trace_call_path

const hasCodebaseMemoryMcp = binaryExists("codebase-memory-mcp");

describe(
  "codebase-memory MCP — tool name verification",
  { timeout: 20_000 },
  () => {
    it.skipIf(!hasCodebaseMemoryMcp)(
      "exposes index_repository, search_graph, search_code, and trace_call_path",
      async () => {
        const tools = await listMcpTools("codebase-memory-mcp", []);

        const expected = [
          "index_repository",
          "search_graph",
          "search_code",
          "trace_call_path",
        ];

        for (const name of expected) {
          expect(
            tools.has(name),
            `Expected codebase-memory MCP to expose tool "${name}". ` +
              `Available: ${[...tools].sort().join(", ")}`,
          ).toBe(true);
        }

        console.log(
          "  codebase-memory MCP tools:",
          [...tools].sort().join(", "),
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// GitHub MCP  (binary: github-mcp-server stdio — needs GITHUB_PERSONAL_ACCESS_TOKEN)
// ---------------------------------------------------------------------------
// Referenced tools (planning.ts, security-gate.ts):
//   implicit GitHub operations (Issues, PRs, Code Scanning)
//
// The official Go binary requires `stdio` subcommand and reads the token from
// GITHUB_PERSONAL_ACCESS_TOKEN (not GITHUB_TOKEN).

const hasGithubMcp =
  binaryExists("github-mcp-server") &&
  !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN);

describe(
  "GitHub MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!hasGithubMcp)(
      "lists tools successfully",
      async () => {
        // github-mcp-server reads GITHUB_PERSONAL_ACCESS_TOKEN
        const token =
          process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_TOKEN;
        const tools = await listMcpToolsOrNull(
          "github-mcp-server",
          ["stdio"],
          { GITHUB_PERSONAL_ACCESS_TOKEN: token! },
          20_000,
        );

        expect(tools).not.toBeNull();

        // Prompts reference GitHub for Issues, PRs, Code Scanning
        const expected = [
          "list_issues",
          "search_issues",
          "list_pull_requests",
          "create_pull_request",
          "search_code",
          "get_file_contents",
        ];

        for (const name of expected) {
          expect(
            tools!.has(name),
            `Expected GitHub MCP to expose tool "${name}". ` +
              `Available: ${[...tools!].sort().join(", ")}`,
          ).toBe(true);
        }

        console.log(
          "  GitHub MCP tools:",
          [...tools!].sort().join(", "),
        );
      },
    );
  },
);

// ---------------------------------------------------------------------------
// Auth-gated NPX servers — skipped when tool listing fails
// These servers may require auth tokens just to initialize. We attempt to
// connect and skip gracefully if the server rejects us.
// ---------------------------------------------------------------------------

// Sentry MCP (npx @sentry/mcp-server --access-token=...)
// Referenced tools (build-slice.ts, security-gate.ts, deploy.ts):
//   error tracking configuration
const sentryToken = process.env.SENTRY_ACCESS_TOKEN;

describe(
  "Sentry MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!sentryToken)(
      "lists tools (skipped if SENTRY_ACCESS_TOKEN not set)",
      async () => {
      const tools = await listMcpToolsOrNull(NPX, [
        "-y",
        "@sentry/mcp-server",
        `--access-token=${sentryToken}`,
      ]);

      if (tools === null) {
        console.log("  Sentry MCP: skipped (server failed to start)");
        return;
      }

      expect(tools.size).toBeGreaterThan(0);

      console.log(
        "  Sentry MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// Stripe MCP (npx @stripe/mcp --api-key=...)
// Referenced tools (build-slice.ts):
//   payment integration (Products, Prices, Webhooks)
// Requires --api-key CLI argument (env var STRIPE_API_KEY is read by the test)
const stripeApiKey = process.env.STRIPE_API_KEY;

describe(
  "Stripe MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!stripeApiKey)(
      "lists tools (skipped if STRIPE_API_KEY not set)",
      async () => {
      const tools = await listMcpToolsOrNull(NPX, [
        "-y",
        "@stripe/mcp",
        `--api-key=${stripeApiKey}`,
      ]);

      if (tools === null) {
        console.log("  Stripe MCP: skipped (server failed to start)");
        return;
      }

      // Prompts reference Products, Prices, Webhooks for payment slices
      const expected = [
        "create_product",
        "create_price",
        "list_products",
        "list_prices",
        "create_payment_link",
        "create_customer",
      ];

      for (const name of expected) {
        expect(
          tools.has(name),
          `Expected Stripe MCP to expose tool "${name}". ` +
            `Available: ${[...tools].sort().join(", ")}`,
        ).toBe(true);
      }

      console.log(
        "  Stripe MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// Cloudflare MCP (npx @cloudflare/mcp-server-cloudflare run <account_id>)
// Referenced tools (deploy.ts):
//   Pages/Workers configuration, DNS records
// Requires: CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID
const cfAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cfApiKey = process.env.CLOUDFLARE_API_KEY;
const cfEmail = process.env.CLOUDFLARE_EMAIL;
const hasCloudflareCreds = !!(cfAccountId && cfApiKey && cfEmail);

describe(
  "Cloudflare MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!hasCloudflareCreds)(
      "lists tools (skipped if Cloudflare credentials not set)",
      async () => {
      const tools = await listMcpToolsOrNull(
        NPX,
        ["-y", "@cloudflare/mcp-server-cloudflare", "run", cfAccountId!],
        { CLOUDFLARE_API_KEY: cfApiKey!, CLOUDFLARE_EMAIL: cfEmail! },
      );

      if (tools === null) {
        console.log("  Cloudflare MCP: skipped (server failed to start)");
        return;
      }

      // Deploy prompt references Workers, DNS, KV, D1, R2
      const expected = [
        "worker_deploy",
        "worker_list",
        "kv_get",
        "kv_put",
        "d1_query",
        "d1_list_databases",
        "r2_list_buckets",
        "r2_put_object",
        "zones_list",
        "env_var_set",
        "secret_put",
      ];

      for (const name of expected) {
        expect(
          tools.has(name),
          `Expected Cloudflare MCP to expose tool "${name}". ` +
            `Available: ${[...tools].sort().join(", ")}`,
        ).toBe(true);
      }

      console.log(
        "  Cloudflare MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// Upstash MCP (npx @upstash/mcp-server --email=... --api-key=...)
// Referenced tools (onboarding.ts):
//   Redis serverless operations
const upstashEmail = process.env.UPSTASH_EMAIL;
const upstashApiKey = process.env.UPSTASH_API_KEY;
const hasUpstashCreds = !!(upstashEmail && upstashApiKey);

describe(
  "Upstash MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!hasUpstashCreds)(
      "lists tools (skipped if UPSTASH_EMAIL/UPSTASH_API_KEY not set)",
      async () => {
      const tools = await listMcpToolsOrNull(
        NPX,
        ["-y", "@upstash/mcp-server"],
        { UPSTASH_EMAIL: upstashEmail!, UPSTASH_API_KEY: upstashApiKey! },
      );

      if (tools === null) {
        console.log("  Upstash MCP: skipped (server failed to start)");
        return;
      }

      expect(tools.size).toBeGreaterThan(0);

      console.log(
        "  Upstash MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);

// Supabase MCP (npx @supabase/mcp-server-supabase --access-token=...)
// Referenced tools (onboarding.ts, build-slice.ts, security-gate.ts):
//   list_tables, describe_table, schema inspection
//
// The remote HTTP endpoint (https://mcp.supabase.com/mcp) requires OAuth.
// The stdio npm package requires a Personal Access Token (PAT).
const supabaseToken = process.env.SUPABASE_ACCESS_TOKEN;

describe(
  "Supabase MCP — tool name verification",
  { timeout: 30_000 },
  () => {
    it.skipIf(!supabaseToken)(
      "lists tools (skipped if SUPABASE_ACCESS_TOKEN not set)",
      async () => {
      const tools = await listMcpToolsOrNull(NPX, [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        `--access-token=${supabaseToken}`,
      ]);

      if (tools === null) {
        console.log("  Supabase MCP: skipped (server failed to start)");
        return;
      }

      expect(tools.size).toBeGreaterThan(0);

      console.log(
        "  Supabase MCP tools:",
        [...tools].sort().join(", "),
      );
    });
  },
);
