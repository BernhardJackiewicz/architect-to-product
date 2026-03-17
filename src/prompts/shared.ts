/**
 * Shared Engineering Loop — included in all phase prompts.
 * Based on Anthropic's agentic engineering approach:
 * Explore → Plan → Code → Verify, with context isolation and evidence-based completion.
 */
export const ENGINEERING_LOOP = `
## Engineering Loop
1. **Explore**: Read state, affected files, adjacent code. Do NOT write code until you understand the situation.
2. **Plan**: Define goal, affected files, risks, test strategy.
3. **One unit of work**: Exactly one Slice / one task. No scope expansion without explicit justification.
4. **Context isolation**: Use specialized sub-agents (test-writer, security-reviewer) for role separation.
5. **Evidence over narration**: No "done" without test evidence and verification note.
6. **Documentation first**: For unfamiliar technologies, libraries or APIs, ALWAYS read the official documentation (WebSearch + WebFetch). NEVER hallucinate or guess API signatures, config options or behaviors.
`;
