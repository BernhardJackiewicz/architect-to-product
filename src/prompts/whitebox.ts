import { ENGINEERING_LOOP } from "./shared.js";

export const WHITEBOX_PROMPT = `Du führst ein Whitebox Security Audit durch — Exploitability-Analyse bestehender Findings + aktive Verifikation der Runtime-Gates.
${ENGINEERING_LOOP}
## Ablauf

### Phase 1: Whitebox Audit (Code-Analyse)
1. Rufe \`a2p_run_whitebox_audit mode=full\` auf
2. Analysiere die Ergebnisse:
   - **confirmed_exploitable=true**: Finding hat erreichbaren Pfad, beweisbare Mutation, und keine Guards → MUSS gefixt werden
   - **blocking=true**: Deployment wird blockiert bis gefixt
   - **speculative**: Nicht sicher exploitbar, aber verdächtig → Review empfohlen
3. Fixe alle blocking Findings sofort

### Phase 1b: Adversarial Security Review (immer durchführen)

Zusätzlich zu den automatischen Probes: Lies den Source-Code und denke wie ein Angreifer.
Das ist ein defensives Code-Review — kein Exploit-Building.

**Vorgehen:**
1. Lies a2p_get_state → identifiziere security-relevante Dateien (Auth, API-Routes, DB-Zugriff, Config)
2. Lies jede dieser Dateien
3. Analysiere auf:

**Analyse-Fokus:**
1. **Business Logic Flaws**: Kann ein User Preise manipulieren, Zahlungen überspringen,
   Privilegien durch normale API-Nutzung eskalieren?
2. **Auth Bypasses**: Endpoints ohne Auth erreichbar? Regular User kann Admin-Funktionen
   nutzen? Timing-Windows wo Auth nicht greift?
3. **Race Conditions**: Concurrent Requests → Double-Spending, Duplikate, inkonsistenter
   State? Read-Modify-Write ohne Locking?
4. **Privilege Escalation**: User A kann User B's Daten durch ID-Änderung abrufen?
   Ownership-Checks auf jeder Mutation?
5. **Vulnerability Chaining**: Low-Severity Issue ermöglicht High-Severity Exploit?
6. **Trust Boundary Violations**: Client-Daten serverseitig vertraut? Webhook-Payloads verifiziert?
7. **State Manipulation**: App-State durch unerwartete API-Call-Sequenzen korrumpierbar?
8. **Denial of Service**: Unbounded Input (grosse Uploads, unbegrenzte Pagination)?

**Für jeden Fund:**
- Beschreibe die Schwachstelle und das Angriffsszenario
- Bewerte Exploitierbarkeit (trivial / erfordert Skill / theoretisch)
- Bewerte Impact (Datenverlust / Privilege Escalation / Finanziell / Verfügbarkeit)
- Melde via a2p_record_finding mit tool="adversarial-review", Datei + Zeile

**Regeln:**
- Fokus auf die TOP 5 wirkungsvollsten Schwachstellen
- Nur Findings MIT konkreter Code-Referenz (Datei + Zeile)
- Bereits durch SAST/Probes gefundene Issues NICHT erneut melden
- KEINE Exploit-Payloads, KEINE schrittweisen Angriffsanleitungen
- Wenn die Codebase zu klein/trivial ist: sag das und mache weiter

**Abschluss (PFLICHT):**
Nach Abschluss des adversarial Reviews: Rufe \`a2p_complete_adversarial_review\` auf mit:
- \`findingsRecorded\`: Anzahl der via a2p_record_finding gemeldeten Findings
- \`note\`: Kurze Zusammenfassung (z.B. "reviewed auth + payment routes, 2 findings recorded")
**Ohne diesen Aufruf blockiert das Deployment-Gate.** Das ist ein code-enforced Gate, kein optionaler Schritt.

### Phase 2: Active Verification (Gate-Tests)
1. Rufe \`a2p_run_active_verification round=1\` auf
2. Analysiere die Ergebnisse:
   - Workflow-Gate-Failures: Status-Übergänge ohne Evidenz → Guards fehlen oder sind kaputt
   - State-Recovery-Failures: Daten gehen bei Round-Trip verloren → Serialisierung prüfen
   - Deployment-Gate-Failures: Deployment wird nicht blockiert wenn es sollte → Gate-Logik reparieren
3. Fixe Gate-Failures sofort

### Phase 3: Delta-basierte Korrekturrunde
Nach Fixes:
1. \`a2p_run_whitebox_audit mode=incremental files=[geänderte Dateien]\`
2. \`a2p_run_active_verification round=N categories=[betroffene Kategorien]\`
3. Nur betroffene Bereiche erneut prüfen, nicht alles
4. Maximal 3 Runden, danach → Human Review

## Verantwortlichkeits-Trennung

### Trennung: Deterministic Probes vs. Adversarial Review
- **Probes** (tool-enforced): Regex-basierte Pattern-Erkennung. Deterministisch, reproduzierbar.
  Ergebnisse fliessen als Candidates in die Guard/Reachability/Mutation-Analyse.
- **Adversarial Review** (prompt-guided): LLM liest Code und denkt wie ein Angreifer.
  Nicht deterministisch. Findings werden via a2p_record_finding gemeldet, NICHT als Whitebox-Candidates.

### Whitebox prüft (Code-Analyse):
- Ob SAST-Findings tatsächlich exploitbar sind
- Auth/Authz Guards vorhanden und serverseitig
- Trust Boundaries nicht umgangen
- Dangerous Sinks (eval, exec, SQL) geschützt
- Prompt-only Enforcement erkannt
- **Wenn SAST 0 Findings liefert:** eigenständige Security-Probes auf Slice-Dateien:
  hardcoded secrets, fehlende auth middleware, input validation lücken, rate limiting,
  unsichere defaults/seed credentials, SQL injection, command injection, SSRF,
  path traversal, insecure crypto, mass assignment, open redirects, info disclosure.
  Diese Probes ersetzen nicht SAST — sie fangen die Lücken auf die pattern-basierte Scanner übersehen.
- **Adversariales Code-Review (immer, code-enforced):** LLM-getriebene Analyse auf Business-Logic-Flaws,
  Race Conditions, Auth-Bypasses, Privilege Escalation, Vulnerability Chaining.
  Findings werden via a2p_record_finding mit tool="adversarial-review" gemeldet.
  Abschluss via \`a2p_complete_adversarial_review\` — **Deployment blockiert ohne diesen Schritt.**

### Active Verification prüft (Runtime-Tests):
- Workflow-Gates: Status-Übergänge brauchen Evidenz
- State-Recovery: Daten überleben Neustart
- Deployment-Gates: Blocking Findings blockieren tatsächlich

### NICHT erneut laufen lassen:
- \`a2p_run_sast\` — Pattern-Matching ist bereits gelaufen
- \`a2p_run_audit\` — Hygiene-Checks sind bereits gelaufen

## Blocking-Regeln
- **blocking=true** wenn: confirmed_exploitable UND (Auth/Secrets/Tenant/Deployment-Kategorie ODER prompt-only enforcement)
- **speculative Findings blocken NICHT**
- Deployment-Gate blockiert automatisch bei blocking_count > 0
`;
