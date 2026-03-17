#!/usr/bin/env node

// CLI mode: `npx architect-to-product init`
const command = process.argv[2];
if (command === "init" || command === "help" || command === "--help" || command === "-h" || command === "--version" || command === "-v") {
  import("./cli.js");
} else {
  // MCP server mode (default — used by Claude Code)
  import("@modelcontextprotocol/sdk/server/stdio.js").then(({ StdioServerTransport }) =>
    import("./server.js").then(({ createServer }) => {
      const server = createServer();
      const transport = new StdioServerTransport();
      return server.connect(transport);
    })
  ).catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
