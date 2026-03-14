# Main Repo Security Audit & Resilience Results

> Date: 2026-03-14
> Workspaces: architect-to-product (reference), a2p-audit (fixes), a2p-chaos (break tests)

---

## 1. Main Repo Security Strengths

- **Phase transitions**: Vollstaendig code-enforced. Jede illegale Transition wirft klaren Error.
- **Evidence gates**: Slice-Status-Uebergaenge erfordern beweisbare Evidenz (Tests, SAST). Kein Status ohne Nachweis.
- **Build signoff**: Mandatory, code-enforced. Invalidiert bei Slice-/Test-Aenderungen. Re-signoff erzwungen.
- **Deploy approval**: Mandatory, code-enforced. Invalidiert bei Finding-/Audit-/Whitebox-Aenderungen. `a2p_generate_deployment` blockt ohne Approval.
- **Stale SAST detection**: Full SAST muss neuer sein als letzte sicherheitsrelevante Aenderung. Sonst Deployment blockiert.
- **Security gates**: CRITICAL/HIGH Findings, blocking Whitebox, critical Audit Findings — alle blockieren Deployment.
- **Zod validation**: Auf allen Tool-Inputs und State-Reads. Malformed state.json wird sauber abgefangen.
- **State backup**: Automatisches `.bak` vor jedem Write.
- **Log sanitization**: Passwords, Bearer tokens, GitHub tokens, OpenAI keys werden redacted.
- **Test command restriction**: Override nur mit explizitem `allowTestCommandOverride=true`.
- **759 Tests**: Alle Gates, Transitions, Invalidierungen, Edge Cases abgedeckt.

## 2. Main Repo Security Gaps

### Behoben

| # | Gap | Datei | Severity | Fix |
|---|-----|-------|----------|-----|
| M1 | SAST rawOutput nicht sanitized | `run-sast.ts:182,231` | should-fix | `sanitizeOutput()` um `truncate()` gewickelt |
| M2 | TestResult.output nicht sanitized im State | `run-tests.ts:57` | should-fix | `sanitizeOutput()` um `truncate()` gewickelt |
| M6 | Backup war nur Warning, kein Hard-Block | `state-manager.ts` | should-fix | Backup-Gate erzwingt Hard-Block bei stateful apps (setPhase security→deployment) |

### Akzeptiert

| # | Gap | Severity | Begruendung |
|---|-----|----------|-------------|
| M3 | Secret-Redaction deckt keine Connection-Strings ab | acceptable | `postgresql://user:pass@host` nicht redacted. Selten in Tool-Output, waere Nice-to-have Pattern-Erweiterung |
| M4 | State-File nicht verschluesselt | acceptable | Standard fuer lokales Dev-Tool |
| M5 | `execSync` mit Shell-Execution | acceptable | Trust-Modell ist MCP→Claude, nicht untrusted users |
| M7 | Signoff/Approval nicht kryptographisch signiert | nice-to-have | Deterministischer Hash reicht fuer lokales Tool |

## 3. Release Blockers

**Keine.** Die zwei should-fix Findings (M1, M2) sind behoben und verifiziert.

## 4. Fixes Applied

| Datei | Aenderung |
|-------|-----------|
| `src/tools/run-sast.ts:4` | `sanitizeOutput` Import hinzugefuegt |
| `src/tools/run-sast.ts:182` | Semgrep rawOutput: `sanitizeOutput(truncate(...))` |
| `src/tools/run-sast.ts:231` | Bandit rawOutput: `sanitizeOutput(truncate(...))` |
| `src/tools/run-tests.ts:57` | TestResult.output: `sanitizeOutput(truncate(...))` |

Total: 4 Zeilen geaendert, 0 Dateien hinzugefuegt, 0 Dateien geloescht.

## 5. New Verification Results

```
Main Repo Typecheck: Identisch zum Baseline (5 praeexistente TS-Warnungen, keine neuen)
Main Repo Tests: 759/759 passed
Audit Workspace Tests: 737/737 passed (10.24s)
Chaos Workspace Shake-and-Break: 10/10 passed
```

## 6. Shake-and-Break Findings (Chaos-Workspace)

Alle 10 Tests bestanden — das System reagiert korrekt auf kaputte Zustaende:

| # | Test | Ergebnis |
|---|------|----------|
| 1 | Corrupted state.json (Garbage-Daten) | Klarer Error, kein Crash |
| 2 | Fehlende .bak Datei | Kein Crash, State lesbar |
| 3 | Illegale Phase-Transition (onboarding→building) | Abgelehnt mit klarem Error |
| 4 | Evidence-Gate umgehen (red→green ohne Tests) | Abgelehnt |
| 5 | Stale Build Signoff (invalidiert durch addTestResult) | Abgelehnt bei building→security |
| 6 | Stale SAST Detection | Abgelehnt bei security→deployment |
| 7 | Doppelte Initialisierung | "State already exists" Error |
| 8 | Leere Slices + Advance | "No more slices" Error |
| 9 | Nicht-existierende Slice ID | Klarer "not found" Error |
| 10 | Secret-Redaction (Passwords, Bearer, ghp_, sk-) | Alle redacted |

## 7. What Should Become Core A2P

### Soll A2P ein offizielles Referenz/Audit/Chaos-Workspace-Modell bekommen?

**Ja.** Das Dreier-Modell hat in beiden Durchlaeufen (QuickBill + Hauptrepo) funktioniert:

- **Reference** bleibt sauber als Vergleichsbasis
- **Audit** isoliert Fixes, erlaubt saubere Verifikation
- **Chaos** erlaubt destruktive Tests ohne Risiko

### Braucht A2P neue Tools oder reicht Prompt-Orchestrierung?

**Hybrid-Ansatz empfohlen:**

| Aspekt | Tool oder Prompt | Begruendung |
|--------|-----------------|-------------|
| Workspace-Kopie erstellen | **Tool** | Deterministisch, reproduzierbar |
| Audit-Findings klassifizieren | **Prompt** | Erfordert Kontext-Verstaendnis |
| Standard Shake-and-Break Checks | **Tool** | Definiertes Test-Set, wiederholbar |
| Ergebnis-Konsolidierung | **Prompt** | Bewertung erfordert Interpretation |
| Fix-Promotion (Audit→Reference) | **Tool** | Diff + Copy, deterministisch |

### Minimale Implementierungsschritte

1. **`a2p_create_sandbox`** Tool:
   - Parameter: `type` ("audit" | "chaos"), `projectPath`
   - Kopiert Workspace, gibt Pfad zurueck
   - Trackt Sandbox-Zustand in State

2. **`a2p_run_shake_and_break`** Tool:
   - Standard-Test-Set: illegale Transitions, Evidence-Bypass, Stale-Checks, Secret-Leak
   - Laeuft in Sandbox, gibt strukturiertes Ergebnis zurueck

3. **`a2p_promote_sandbox`** Tool:
   - Diff-basiert: zeigt Aenderungen, uebernimmt nach Bestaetigung
   - Nur fuer Audit-Sandboxes, nicht fuer Chaos

4. **Security-Audit-Prompt** erweitern:
   - Referenziert das Dreier-Workspace-Modell
   - Gibt klare Anweisungen fuer Klassifizierung (blocker/should-fix/acceptable/nice-to-have)

## 8. Remaining Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| ~~Connection-String-Redaction fehlt~~ | ~~Niedrig~~ | Gefixt: URL-Credential-Pattern in log-sanitizer.ts + sanitizeOutput() in run-audit.ts |
| ~~5 praeexistente TS-Warnungen (setup-companions, update-slice)~~ | ~~Niedrig~~ | Behoben in 95f510a — `tsc --noEmit` gibt 0 errors |
| Non-Docker Deploy-Targets liefern Docker-File-Descriptions | Mittel | README-Korrektur bereits in README_GAPS.md dokumentiert |
| Prompt-only Enforcement fuer einige Workflows | Mittel | By design, aber in README klar als "prompt-guided" kennzeichnen |

## 9. Final Verdict

### release-candidate

**Begruendung:**
- Alle code-enforced Gates funktionieren korrekt (10/10 Chaos-Tests)
- Secret-Redaction auf allen Output-Pfaden (nach Fix M1+M2)
- 741 Tests gruen
- Keine Blocker
- Zwei should-fix behoben und verifiziert
- README-Gaps sind dokumentiert und teilweise bereits korrigiert

**Was noch fehlt fuer release-ready:**
- README-Wording fuer Non-Docker-Targets korrigieren (bereits in README_GAPS.md als Aktion gelistet)

**Erledigt seit letztem Audit:**
- ~~Praeexistente TS-Warnungen fixen (5 Stellen)~~ — behoben in 95f510a, `tsc --noEmit` gibt 0 errors
- ~~Connection-String-Redaction (nice-to-have)~~ — behoben: URL-Credential-Pattern in log-sanitizer.ts + sanitizeOutput() in run-audit.ts

**Nicht "not-ready" weil:** Alle Sicherheitsgrenzen halten, alle Gates greifen, keine offenen Blocker.
**Nicht "release-ready" weil:** README-Gaps (Deploy-Target-Wording) sind bekannt aber noch offen.
