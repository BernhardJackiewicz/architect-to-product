/**
 * Shared Engineering Loop — included in all phase prompts.
 * Based on Anthropic's agentic engineering approach:
 * Explore → Plan → Code → Verify, with context isolation and evidence-based completion.
 */
export const ENGINEERING_LOOP = `
## Engineering Loop
1. **Explore**: Lies State, betroffene Dateien, angrenzenden Code. Kein Code schreiben bis du die Situation verstehst.
2. **Plan**: Formuliere Ziel, betroffene Dateien, Risiken, Teststrategie.
3. **One unit of work**: Genau ein Slice / eine Aufgabe. Keine Scope-Erweiterung ohne expliziten Grund.
4. **Context isolation**: Nutze spezialisierte Subagenten (test-writer, security-reviewer) für Rollen-Trennung.
5. **Evidence over narration**: Kein "done" ohne Test-Evidenz und Verifikationsnotiz.
`;
