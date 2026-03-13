# architect-to-product

MCP server that turns software architectures into tested, secure, deployable products. It implements the workflow from "How Anthropic Engineers Use Agents" -- TDD, vertical slices, subagents, hooks -- as a structured toolkit for Claude Code.

Claude remains the orchestrator. This server provides the tools, prompts, and resources Claude needs to execute the full lifecycle: architecture in, production-ready code out.

## How it works

The server guides projects through 5 phases:

1. **Onboarding** -- Capture or co-develop the architecture. Detect database and frontend tech. Set up companion MCP servers.
2. **Planning** -- Break the architecture into ordered vertical slices, each a deployable feature unit with acceptance criteria.
3. **Build Loop** -- TDD per slice: RED (write failing tests) -> GREEN (minimal implementation) -> REFACTOR (clean up) -> SAST (lightweight security scan). Repeat.
4. **Security Gate** -- Full SAST scan (Semgrep + Bandit), OWASP Top 10 manual review, dependency audit. Fix all critical/high findings.
5. **Deployment** -- Generate Dockerfile, docker-compose, Caddyfile, backup scripts, hardening guides. Stack-specific launch checklist.

Between phases 3 and 4, optional quality analysis (dead code, redundancy, coupling via codebase-memory-mcp) and E2E testing (Playwright MCP) can run.

## Key design decisions

- **Stack-agnostic**: No hardcoded templates. Everything is generated dynamically based on the architecture. Works with any language/framework.
- **State as JSON**: Each project stores state in `.a2p/state.json` -- inspectable, diffable, git-committable.
- **Companion ecosystem**: Integrates codebase-memory-mcp (code graph queries), database-specific MCP servers (Supabase, Postgres, SQLite), and Playwright MCP (E2E testing).
- **Strict state machine**: Phase transitions and TDD slice states are enforced (you can't skip RED or mark done without green tests).

## Installation

```bash
# Install globally
npm install -g architect-to-product

# Register in Claude Code
claude mcp add architect-to-product -- npx architect-to-product
```

### Optional: Companion servers

```bash
# codebase-memory-mcp (code graph intelligence)
curl -L https://github.com/DeusData/codebase-memory-mcp/releases/latest/download/codebase-memory-mcp-darwin-arm64 \
  -o /usr/local/bin/codebase-memory-mcp
chmod +x /usr/local/bin/codebase-memory-mcp
claude mcp add codebase-memory -- codebase-memory-mcp

# Playwright MCP (E2E testing) -- if your project has a frontend
npm install -g @anthropic/mcp-playwright
```

## MCP primitives

### Tools (14)

| Tool | Phase | Description |
|------|-------|-------------|
| `a2p_init_project` | 0 | Scaffold project with CLAUDE.md, hooks, agents, state |
| `a2p_set_architecture` | 0 | Parse architecture, detect DB/frontend, store in state |
| `a2p_setup_companions` | 0 | Register companion MCP servers |
| `a2p_create_build_plan` | 1 | Architecture -> ordered vertical slices |
| `a2p_get_state` | * | Read current project state |
| `a2p_update_slice` | 2 | Update slice status (red/green/refactor/sast/done) |
| `a2p_run_tests` | 2 | Execute test command, parse results (pytest/vitest/jest/go) |
| `a2p_run_quality` | 2.5 | Record dead code, redundancy, coupling issues |
| `a2p_run_e2e` | 2.6 | Record Playwright E2E test results |
| `a2p_run_sast` | 2,3 | Run Semgrep/Bandit, record findings |
| `a2p_record_finding` | 3 | Manually record a security finding |
| `a2p_generate_deployment` | 4 | Get stack-specific deployment guidance |
| `a2p_get_checklist` | 4 | Pre/post-deployment verification checklist |
| `a2p_get_quality_report` | 2.5 | Quality metrics: dead code, duplicates, coupling |

### Prompts (7)

| Prompt | When to use |
|--------|-------------|
| `a2p_onboarding` | Project start, architecture capture |
| `a2p_planning` | Architecture -> slice plan |
| `a2p_build_slice` | TDD loop per slice |
| `a2p_refactor` | Code quality via codebase-memory graph analysis |
| `a2p_e2e_testing` | Playwright visual testing |
| `a2p_security_gate` | Full SAST + OWASP review |
| `a2p_deploy` | Production configs + hardening |

### Resources (4)

| Resource | URI | Description |
|----------|-----|-------------|
| Build plan | `a2p://plan` | Slice list with status |
| Progress | `a2p://progress` | Slices done, test rate, findings |
| SAST report | `a2p://sast-report` | All security findings |
| Quality report | `a2p://quality` | Dead code, duplicates, coupling metrics |

## Usage

Start a new project by invoking the onboarding prompt in Claude Code:

```
Use the a2p_onboarding prompt to start a new project.
```

Or go step by step:

```
# 1. Initialize
Call a2p_init_project with projectPath="/path/to/my-app" and projectName="my-app"

# 2. Set architecture
Call a2p_set_architecture with the tech stack details

# 3. Plan
Call a2p_create_build_plan with your slices

# 4. Build (per slice)
Use the a2p_build_slice prompt -- it guides RED -> GREEN -> REFACTOR -> SAST

# 5. Security gate
Use the a2p_security_gate prompt

# 6. Deploy
Use the a2p_deploy prompt
```

## Development

```bash
git clone https://github.com/BernhardJackiewicz/architect-to-product.git
cd architect-to-product
npm install

# Typecheck
npm run typecheck

# Run tests (58 tests)
npm test

# Build
npm run build

# Run in dev mode
npm run dev
```

## Project structure

```
src/
  index.ts              # Entry point (stdio transport)
  server.ts             # Tool/prompt/resource registration
  state/
    types.ts            # TypeScript interfaces
    validators.ts       # Zod schemas
    state-manager.ts    # State persistence + transitions
  tools/                # 14 tool handlers
  prompts/              # 7 prompt definitions
  resources/            # 4 resource handlers (in server.ts)
  utils/
    process-runner.ts   # Child process with timeout
    constants.ts        # Server name/version
tests/
  state-manager.test.ts # 34 unit tests
  e2e-workflow.test.ts  # 24 integration tests
```

## License

MIT
