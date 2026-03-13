import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { StateManager } from "../state/state-manager.js";

export const initProjectSchema = z.object({
  projectPath: z.string().describe("Absolute path where the project should be created"),
  projectName: z.string().describe("Name of the project"),
});

export type InitProjectInput = z.infer<typeof initProjectSchema>;

const CLAUDE_MD = `# {{PROJECT_NAME}}

## Overview
{{PROJECT_NAME}} — built with architect-to-product workflow.

## Commands
- Setup: (to be configured)
- Test: (to be configured)
- Lint: (to be configured)
- Build: (to be configured)

## Architecture
See .a2p/state.json for architecture details and build progress.

## Key Patterns
- TDD: Tests first, then implementation
- Slices: One vertical feature per slice
- Security: SAST after each slice, full scan before deployment

## Workflow (architect-to-product)
This project uses the architect-to-product MCP server for structured development.
All tools start with the \`a2p_\` prefix. Key commands:
- \`a2p_get_state\` — see current progress, phase, and slice status
- \`a2p_create_build_plan\` — break architecture into vertical slices
- \`a2p_update_slice\` — advance a slice through RED → GREEN → REFACTOR → SAST → DONE
- \`a2p_run_tests\` — execute tests and record results
- \`a2p_run_sast\` — run security scan on changed files

Use the \`a2p_build_slice\` prompt to build the next slice with TDD.
Use the \`a2p_planning\` prompt to create or extend the build plan.

All tests must pass before a slice is marked done.
Code quality checked via codebase-memory-mcp.
Security reviewed via SAST tools.
`;

const TEST_WRITER_AGENT = `---
name: test-writer
description: Writes failing tests for TDD RED phase. Does NOT write implementation code.
tools: Read, Grep, Glob, Bash, Write
---

You are a test engineer. Your ONLY job is to write failing tests.

## Rules
- Write tests based on the acceptance criteria provided
- Tests MUST fail when run (there is no implementation yet)
- Do NOT write any implementation code
- Do NOT modify existing source files (only test files)
- Use the project's test framework
- Cover happy path, edge cases, and error cases
- Name tests descriptively: test_should_do_X_when_Y
`;

const SECURITY_REVIEWER_AGENT = `---
name: security-reviewer
description: Reviews code for security vulnerabilities (OWASP Top 10, injection, auth issues)
tools: Read, Grep, Glob, Bash
---

You are an application security engineer. Review code for vulnerabilities.

## Checks
- SQL/NoSQL Injection (parameterized queries?)
- XSS (output encoding?)
- Auth/AuthZ (every endpoint protected?)
- Secrets (hardcoded credentials?)
- Input validation (all user input validated?)
- Deserialization (no pickle/eval with user input?)
- CORS (restrictive policy?)
- Dependencies (known CVEs?)

## Output
For each finding:
- Severity: CRITICAL/HIGH/MEDIUM/LOW
- File:Line
- Description
- Concrete fix with code
`;

const SETTINGS_JSON = {
  hooks: {
    PostToolUse: [
      {
        matcher: "Write|Edit",
        hooks: [
          {
            type: "command" as const,
            command:
              "echo 'File modified — remember to run tests before marking slice as done'",
          },
        ],
      },
    ],
  },
};

const GITIGNORE = `node_modules/
dist/
.env
.env.*
!.env.example
__pycache__/
*.pyc
.venv/
venv/
.a2p/state.json.bak
.DS_Store
`;

export function handleInitProject(input: InitProjectInput): string {
  const { projectPath, projectName } = input;

  // Check if already initialized
  const sm = new StateManager(projectPath);
  if (sm.exists()) {
    return JSON.stringify({
      error: "Project already initialized",
      hint: "Use a2p_get_state to see current state.",
    });
  }

  // Create directory structure
  const dirs = [
    projectPath,
    join(projectPath, ".claude"),
    join(projectPath, ".claude", "agents"),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Write CLAUDE.md
  writeFileSync(
    join(projectPath, "CLAUDE.md"),
    CLAUDE_MD.replace(/\{\{PROJECT_NAME\}\}/g, projectName),
    "utf-8"
  );

  // Write agents
  writeFileSync(join(projectPath, ".claude", "agents", "test-writer.md"), TEST_WRITER_AGENT, "utf-8");
  writeFileSync(
    join(projectPath, ".claude", "agents", "security-reviewer.md"),
    SECURITY_REVIEWER_AGENT,
    "utf-8"
  );

  // Write settings
  writeFileSync(
    join(projectPath, ".claude", "settings.json"),
    JSON.stringify(SETTINGS_JSON, null, 2),
    "utf-8"
  );

  // Write .gitignore
  writeFileSync(join(projectPath, ".gitignore"), GITIGNORE, "utf-8");

  // Initialize state
  const state = sm.init(projectName, projectPath);

  return JSON.stringify({
    success: true,
    projectName,
    projectPath,
    filesCreated: [
      "CLAUDE.md",
      ".claude/settings.json",
      ".claude/agents/test-writer.md",
      ".claude/agents/security-reviewer.md",
      ".gitignore",
      ".a2p/state.json",
    ],
    nextStep:
      "Now set your architecture with a2p_set_architecture, or use the a2p prompt to brainstorm one.",
  });
}
