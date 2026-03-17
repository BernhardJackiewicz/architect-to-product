#!/usr/bin/env node
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Read version from package.json at runtime
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const packageName: string = pkg.name;
const packageVersion: string = pkg.version;

const command = process.argv[2];

if (command === "init") {
  const mcpJsonPath = join(process.cwd(), ".mcp.json");

  if (existsSync(mcpJsonPath)) {
    const existing = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
    if (existing.mcpServers?.["architect-to-product"]) {
      console.log(`✓ .mcp.json already configured with architect-to-product.`);
      console.log(`  Restart Claude Code, then type /a2p to start.`);
      process.exit(0);
    }
    // Add to existing .mcp.json
    existing.mcpServers = existing.mcpServers ?? {};
    existing.mcpServers["architect-to-product"] = {
      command: "npx",
      args: ["-y", `${packageName}@${packageVersion}`],
    };
    writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
    console.log(`✓ Added architect-to-product to existing .mcp.json`);
  } else {
    const config = {
      mcpServers: {
        "architect-to-product": {
          command: "npx",
          args: ["-y", `${packageName}@${packageVersion}`],
        },
      },
    };
    writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    console.log(`✓ Created .mcp.json with architect-to-product@${packageVersion}`);
  }
  console.log(`\nNext steps:`);
  console.log(`  1. Restart Claude Code`);
  console.log(`  2. Type /a2p to start`);
} else {
  console.log(`architect-to-product v${packageVersion}`);
  console.log(``);
  console.log(`Usage:`);
  console.log(`  npx a2p init   Set up .mcp.json in current directory`);
  console.log(``);
  console.log(`After init, restart Claude Code and type /a2p to start.`);
}
