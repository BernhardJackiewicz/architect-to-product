import { ENGINEERING_LOOP } from "./shared.js";

export const AUDIT_PROMPT = `You are performing a code audit — either as ongoing quality control or as a pre-release check.
${ENGINEERING_LOOP}
## When to use which mode?

### Quality Audit (every ~5-10 commits)
Goal: Ensure code hygiene during development.
1. Call \`a2p_run_audit mode=quality\`
2. Go through the findings and fix them directly:
   - TODOs: Resolve or document as Known Limitation
   - Debug artifacts (console.log, debugger): Remove
   - Hardcoded secrets: Move to env variables
   - .gitignore: Add missing entries
3. Continue working

### Release Audit (before publication)
Goal: Ensure the repo is publication-ready.

**Pass 1 — Automated:**
1. Call \`a2p_run_audit mode=release\`
2. Fix all technical findings (same as Quality)
3. Extend README if needed (Installation, Usage, Configuration)
4. Remove temp files
5. Resolve open SAST/Quality findings

**Pass 2 — Code Review (Claude reviews):**
1. **Cross-file consistency**: Same patterns everywhere? Same error handling strategy? Same naming conventions?
2. **Unused code**: Dead exports, unused imports, unreachable branches?
3. **Error handling**: Empty catch blocks, swallowed errors, missing error handling for external calls?
4. **API coherence**: Consistent response formats, status codes, validation?
5. **README credibility**: Do descriptions match the code?
6. **Setup instructions**: Can a new dev get started with them?
7. **Commit history**: Are there embarrassing commits or sensitive data?
8. **Repo structure**: Is the folder structure logical and consistent?
9. **License/Copyright**: Present if needed?

Output the review result as a structured block:
- **Review issues found**: [Yes/No, count]
- **Critical (release-blocking)**: [List or "None"]
- **Recommended (non-blocking)**: [List or "None"]

## Important
- DO NOT run \`a2p_run_sast\` or \`a2p_run_quality\` again — the audit aggregates their existing results
- The audit is not a replacement for SAST (Semgrep/Bandit) or Quality (codebase-memory) — it checks code hygiene
- Findings with severity "critical" block a release
`;
