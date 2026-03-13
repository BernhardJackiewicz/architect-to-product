# architect-to-product — MCP Server for AI-Driven TDD, Security Scanning, and Deployment

Turn any software architecture into a tested, secure, production-ready codebase — powered by Claude Code.

[![npm version](https://img.shields.io/npm/v/architect-to-product)](https://www.npmjs.com/package/architect-to-product)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 179 passing](https://img.shields.io/badge/tests-179%20passing-brightgreen)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)]()

---

AI coding tools generate code fast. But that code ships without tests, with security holes, and with no deployment story. You spend more time fixing what the AI wrote than you saved.

- 45% of AI-generated code contains security vulnerabilities ([GitClear 2024](https://www.gitclear.com/coding_on_copilot_data_shows_ais_downward_pressure_on_code_quality))
- AI agents waste tokens re-reading the same files — up to 20x more than necessary
- "It works on my machine" turns into a 3am production incident

**architect-to-product** adds what AI coding lacks: a structured pipeline from architecture to production. TDD ensures every feature works. SAST catches security issues before deploy. Stack-specific deployment configs mean you ship on day one, not day thirty.

## Without vs. With architect-to-product

| Without a2p | With a2p |
|---|---|
| Vibe code a feature | Architecture-driven vertical slices |
| Manually write some tests (maybe) | TDD per slice: RED → GREEN → REFACTOR |
| Miss security vulnerabilities | Automated SAST + OWASP Top 10 review |
| Copy-paste a Dockerfile from StackOverflow | Generated Dockerfile + docker-compose + Caddyfile + backup scripts |
| Hope for the best | Ship to production with confidence |

## Key Benefits

- **Develop faster** — Vertical slices with TDD, no yak shaving
- **Fewer bugs** — Every feature has tests before implementation (RED → GREEN → REFACTOR)
- **Ship secure** — Semgrep + Bandit + OWASP Top 10 review built into the workflow
- **Deploy on day one** — Stack-specific Dockerfile, docker-compose, Caddyfile, backup scripts
- **Save tokens** — Pair with codebase-memory-mcp for up to 20x fewer exploration tokens
- **Any stack** — Python, TypeScript, Go, Rust, Java, Ruby, PHP, C#, PostgreSQL, MySQL, MongoDB, Redis

## How it works

```
Architecture → Plan → Build (TDD) → Security Gate → Deploy
```

For multi-phase projects (e.g. Phase 0: Spikes, Phase 1: MVP, Phase 2: Scale), this loop repeats per phase automatically.

```
Phase 0: Plan → Build → Security → Deploy → complete_phase
Phase 1: Plan → Build → Security → Deploy → complete_phase
...
```

1. **Onboarding**: Capture or co-develop the architecture. Detect database and frontend tech. Set up companion MCP servers. If the architecture defines phases, they get extracted automatically.
2. **Planning**: Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria. Three slice types: `feature` (default), `integration` (library/API adapters with TDD), `infrastructure` (CI, auth, monitoring).
3. **Build Loop**: TDD per slice: RED (write failing tests) → GREEN (minimal implementation) → REFACTOR (clean up) → SAST (lightweight security scan). Frontend slices with `hasUI: true` get visual verification via Playwright between GREEN and REFACTOR.
4. **Security Gate**: Full SAST scan (Semgrep + Bandit), OWASP Top 10 manual review, dependency audit. Fix all critical/high findings.
5. **Deployment**: Generate Dockerfile, docker-compose, Caddyfile, backup scripts, hardening guides. Stack-specific launch checklist.

## Quick Start

```bash
# Install
npm install -g architect-to-product

# Register in Claude Code
claude mcp add architect-to-product -- npx architect-to-product
```

Then use the `a2p_onboarding` prompt to start your first project.

## Client Configuration

### Claude Code (CLI)

```bash
claude mcp add architect-to-product -- npx architect-to-product
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

### VS Code

Add to `.vscode/mcp.json`:

```json
{
  "servers": {
    "architect-to-product": {
      "command": "npx",
      "args": ["architect-to-product"]
    }
  }
}
```

## MCP Tools (15)

| Tool | Phase | Description |
|------|-------|-------------|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, extract phases |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture → ordered vertical slices (supports `append` for multi-phase) |
| `a2p_add_slice` | 1,2 | Insert a single slice mid-project (e.g. integration discovered during build) |
| `a2p_complete_phase` | 4 | Complete current product phase, advance to next |
| `a2p_get_state` | * | Read current project state (includes phase info) |
| `a2p_update_slice` | 2 | Update slice status (red/green/refactor/sast/done) |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go) |
| `a2p_run_quality` | 2.5 | Record dead code, redundancy, coupling issues |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Run Semgrep/Bandit, record findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_generate_deployment` | 4 | Get stack-specific deployment guidance |
| `a2p_get_checklist` | 4 | Pre/post-deployment verification checklist |

## Supported Stacks

| Category | Technologies |
|----------|-------------|
| **Languages** | Python, TypeScript/Node.js, Go, Rust, Java/Kotlin, Ruby, PHP, C#/.NET |
| **Databases** | SQLite, PostgreSQL, MySQL/MariaDB, MongoDB, Redis |
| **Hosting** | Hetzner, DigitalOcean, AWS, Fly.io, Railway, Vercel, any VPS |

## Works great with

| Companion | What it adds |
|-----------|-------------|
| [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | Code graph intelligence — up to 20x fewer exploration tokens |
| [Playwright MCP](https://github.com/anthropics/mcp-playwright) | E2E visual testing for frontend projects |
| Database MCP servers | Direct DB access — [Supabase](https://github.com/supabase-community/supabase-mcp), [Postgres](https://github.com/ergut/mcp-bigquery), [SQLite](https://github.com/anthropics/mcp-sqlite), [MySQL](https://github.com/benborla/mcp-server-mysql), [MongoDB](https://github.com/kiliczsh/mcp-mongo-server) |

## How is this different?

- **vs. Copilot / Cursor** — They generate snippets. a2p generates entire tested projects from architecture to deployment.
- **vs. create-\*-app scaffolders** — Static templates vs. dynamic architecture-driven generation with TDD and security gates.
- **vs. manual deployment setup** — Weeks of DevOps vs. generated configs on day one.

## Disclaimer

This is not a guarantee of bug-free code. It's an engineering-grade safety net that catches what vibe coding misses.

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install
npm run typecheck   # Type checking
npm test            # 179 tests
npm run build       # Build
npm run dev         # Dev mode
```

## License

MIT
