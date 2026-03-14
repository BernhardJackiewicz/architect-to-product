import { ENGINEERING_LOOP } from "./shared.js";

export const AUDIT_PROMPT = `Du führst ein Code-Audit durch — entweder als laufende Qualitätskontrolle oder als Pre-Release-Prüfung.
${ENGINEERING_LOOP}
## Wann welcher Modus?

### Quality Audit (alle ~5-10 Commits)
Ziel: Code-Hygiene während der Entwicklung sicherstellen.
1. Rufe \`a2p_run_audit mode=quality\` auf
2. Gehe die Findings durch und fixe sie direkt:
   - TODOs: Lösen oder als Known Limitation dokumentieren
   - Debug-Artefakte (console.log, debugger): Entfernen
   - Hardcoded Secrets: In Env-Variablen auslagern
   - .gitignore: Fehlende Einträge ergänzen
3. Weiterarbeiten

### Release Audit (vor Veröffentlichung)
Ziel: Sicherstellen, dass das Repo publikationsreif ist.

**Pass 1 — Automatisch:**
1. Rufe \`a2p_run_audit mode=release\` auf
2. Fixe alle technischen Findings (wie bei Quality)
3. README erweitern falls nötig (Installation, Usage, Konfiguration)
4. Temp-Dateien entfernen
5. Offene SAST/Quality-Findings klären

**Pass 2 — Manuell (Claude prüft):**
1. README-Glaubwürdigkeit: Stimmen Beschreibungen mit dem Code überein?
2. Setup-Anleitung: Kann ein neuer Dev damit starten?
3. Commit-History: Gibt es peinliche Commits oder sensible Daten?
4. Repo-Struktur: Ist die Ordnerstruktur logisch und konsistent?
5. Lizenz/Copyright: Vorhanden wenn nötig?

## Wichtig
- NICHT \`a2p_run_sast\` oder \`a2p_run_quality\` erneut laufen lassen — das Audit aggregiert deren bestehende Ergebnisse
- Das Audit ist kein Ersatz für SAST (Semgrep/Bandit) oder Quality (codebase-memory) — es prüft Code-Hygiene
- Findings mit severity "critical" blockieren ein Release
`;
