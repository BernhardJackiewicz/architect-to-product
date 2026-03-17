#!/usr/bin/env node
const { writeFileSync, existsSync, readFileSync } = require("fs");
const { join } = require("path");

const command = process.argv[2];

if (command === "init") {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");
  const serverEntry = {
    command: "npx",
    args: ["-y", "architect-to-product"],
  };

  if (existsSync(mcpJsonPath)) {
    const existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    if (existing.mcpServers && existing.mcpServers["architect-to-product"]) {
      console.log("✓ .mcp.json already configured with architect-to-product.");
      console.log("  Restart Claude Code, then type /a2p to start.");
      process.exit(0);
    }
    existing.mcpServers = existing.mcpServers || {};
    existing.mcpServers["architect-to-product"] = serverEntry;
    writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    console.log("✓ Added architect-to-product to existing .mcp.json");
  } else {
    const config = {
      mcpServers: {
        "architect-to-product": serverEntry,
      },
    };
    writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log("✓ Created .mcp.json with architect-to-product");
  }
  console.log("\nNext steps:");
  console.log("  1. Restart Claude Code");
  console.log("  2. Type /a2p to start");
} else {
  console.log("a2p — CLI for architect-to-product");
  console.log("");
  console.log("Usage:");
  console.log("  npx a2p init   Set up .mcp.json in current directory");
  console.log("");
  console.log("After init, restart Claude Code and type /a2p to start.");
  console.log("https://www.npmjs.com/package/architect-to-product");
}
