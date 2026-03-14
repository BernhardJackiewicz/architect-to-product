# README Gaps — Aktualisiert nach Phase A-E

> Stand: 2026-03-14 (nach Credential-Tests + Gap-Closure)
> Basis: 96 QuickBill-Tests + 737 bestehende Tests + 7 Credential-API-Tests + 6 Code-Inspections

---

## 1. Geschlossene Luecken (seit erstem Run)

Diese Gaps wurden in Phase A/B verifiziert und sind jetzt abgedeckt:

| Gap | Ergebnis | Methode |
|---|---|---|
| Prompt-Count (9 claimed) | **VERIFIED** — exakt 9 | server.ts Code-Inspektion |
| uiDesign Parameter | **VERIFIED** — Schema + Storage | set-architecture.ts Code-Inspektion |
| MySQL --defaults-file | **VERIFIED** — kein Passwort-Leak | generate-deployment.ts Zeile 211 |
| MongoDB --uri --gzip | **VERIFIED** — korrekt | generate-deployment.ts Zeile 213 |
| Fly.io Guidance | **VERIFIED** — 2 Recs + 3 Checklist | Code-Inspektion |
| Render Guidance | **VERIFIED** — 3 Recs + 3 Checklist | Code-Inspektion |
| GitHub API | **VERIFIED** — HTTP 200 | Live API Call |
| Stripe API | **VERIFIED** — HTTP 200, test mode | Live API Call |
| Cloudflare API | **VERIFIED** — HTTP 200 | Live API Call |
| Vercel API | **VERIFIED** — HTTP 200 | Live API Call |
| Upstash API | **VERIFIED** — HTTP 200 | Live API Call |
| Supabase API | **VERIFIED** — HTTP 200 | Live API Call |
| codebase-memory: 11 tools | **VERIFIED** — exakt 11 | Session-Zaehlung |
| sequential-thinking: 1 tool | **VERIFIED** — exakt 1 | npm readme |

---

## 2. README-Korrekturen noetig (INACCURATE)

Claims die im README stehen aber nicht mit dem Code uebereinstimmen.

### 2.1 Deploy-Target File Generation (HOCH)

**Problem**: README suggeriert dass A2P fuer jeden Deploy-Target spezifische Config-Dateien generiert (vercel.json, fly.toml, render.yaml, wrangler.toml). Der Code gibt aber fuer ALLE Targets die gleichen Docker-orientierten `filesToGenerate` zurueck — auch fuer Vercel, Cloudflare, etc.

**Was tatsaechlich passiert**:
- Docker VPS (Hetzner, DO, generic): File-Descriptions fuer Dockerfile, docker-compose, Caddyfile, Backup-Scripts — **korrekt**
- Vercel/Railway/Cloudflare/Fly.io/Render: Bekommen Text-Empfehlungen + Checklist-Items, aber KEINE platform-spezifischen File-Descriptions

**Empfehlung**: Entweder README korrigieren (klarstellen: Recs + Checklist, keine Config-Files) oder Code erweitern (platform-spezifische filesToGenerate).

**Status (2026-03-14)**: README-Tabelle bereits korrigiert — PaaS-Targets sagen "Recommendations" + "Checklist items". Code-Bug (Docker-filesToGenerate fuer alle Targets) besteht weiterhin, ist aber durch README-Wording nicht mehr irreführend.

### 2.2 Cloudflare Tool Count (MITTEL)

**Claim**: 85 tools
**Verifiziert**: 61 tools (npm readme, Zaehlung ueber alle Kategorien)
**Differenz**: 39% ueberhoet

### 2.3 Filesystem Tool Count (NIEDRIG)

**Claim**: 14 tools
**Verifiziert**: 13 tools (npm readme)
**Differenz**: 1 Tool zu viel

### 2.4 GitHub Tool Count (NIEDRIG)

**Claim**: 41 tools
**Verifiziert**: 26 tools (in der alten npm-Version, die deprecated ist)
**Status**: Neue Go-Version (github/github-mcp-server) koennte 41 haben, ist aber nicht via npm verifizierbar

---

## 3. Fehlgeschlagen (FAILED)

| Item | Status | Grund |
|---|---|---|
| Sentry Token | 401 Unauthorized | Token expired oder braucht Region-Endpoint (de.sentry.io statt sentry.io) |
| Atlassian | Nicht testbar | Nur Cloud-ID vorhanden, kein Auth-Token |

---

## 4. Prompt-Only Claims (by design, kein Code-Fix noetig)

Claims die NUR in Prompts stehen. Das ist by design — Claude folgt den Prompts.

| Claim | Prompt | Enforcement |
|---|---|---|
| Documentation-first (WebSearch vor Code) | `/a2p_build_slice` | Kein Code-Gate |
| Domain logic loest WebSearch aus | `/a2p_build_slice` | Kein Code-Gate |
| Quality audits alle ~5-10 Commits | `/a2p_build_slice` | Kein Counter |
| OWASP Top 10 Manual Review | `/a2p_security_gate` | Kein Code-Gate |

**Empfehlung**: Optional im README als "prompt-guided" kennzeichnen. Kein Bug, kein Fix noetig.

---

## 5. Nicht verifizierbar (UNVERIFIABLE)

Tool-Counts die via npm-readme nicht pruefbar sind:

| Package | Claim | Warum nicht pruefbar |
|---|---|---|
| mcp-server-git | 12 tools | Python-Package (PyPI), nicht auf npm |
| @playwright/mcp | 22 tools | npm readme leer |
| @stripe/mcp | 28 tools | "See documentation" — Count haengt von API-Key-Permissions ab |
| @sentry/mcp-server | 22 tools | Kein README auf npm |
| @upstash/mcp-server | 26 tools | npm readme leer |

**Impact**: Niedrig. Nutzer zaehlen keine Tools. Die Zahlen koennten aber veraltet sein.

---

## 6. Offene Test-Gaps (nicht fehlend, aber nicht in diesem Run abgedeckt)

| Gap | Grund | Impact |
|---|---|---|
| ~~Real UI Browser-Test~~ | ~~QuickBill App existiert nicht als Code~~ | **GESCHLOSSEN** — QuickBill gebaut, 8 Playwright-Tests pass (siehe PHASE_C_RESULTS.md) |
| run_tests echte Ausfuehrung | Braucht laufende Test-Suite | Niedrig — SM.addTestResult validiert |
| run_sast echte Ausfuehrung | Braucht Semgrep/Bandit | Niedrig — SM.markSastRun validiert |
| Backup deploy-gate Hard-Block | Bestehender Test (backup-integration.test.ts, gate-enforcement.test.ts) | Niedrig — Code-verifiziert |

---

## 7. Architektur-Gaps (unveraendert)

| Transition | MCP-Tool? | Code-Enforcement? |
|---|---|---|
| onboarding -> planning | Ja (`a2p_create_build_plan`) | Ja |
| planning -> building | **NEIN** | Ja (SM.setPhase + Guards) |
| building -> security | **NEIN** | Ja (SM.setPhase + Signoff + Quality-Gate) |
| security -> deployment | **NEIN** | Ja (SM.setPhase + SAST/Whitebox/Audit/Verification/Backup-Gates) |
| deployment -> complete | **NEIN** | Ja (SM.setPhase) |

**Status**: Prompt-gesteuert. Gates greifen, aber kein MCP-Tool exponiert `setPhase` direkt.

---

## 8. Priorisierte Aktionen

### Vor Release (README-Fixes)

1. ~~**Deploy-Target-Wording**: Non-Docker-Targets bekommen Recs + Checklist, keine generierten Config-Files — README anpassen~~ — **DONE** (README-Tabelle bereits korrigiert, sagt "Recommendations" + "Checklist items")
2. ~~**Tool-Counts**: Cloudflare 85->aktuellen Wert, Filesystem 14->13, GitHub 41->pruefen~~ — **DONE** (README zeigt 13 fuer Filesystem, Cloudflare/GitHub ohne exakte Zahl in Conditional-Tabelle)
3. ~~**MCP Tool Count 20->21, Test Count 737->741**~~ — **DONE** (2026-03-14)

### Nach Release (Nice-to-Have)

3. Sentry-Token rotieren
4. ~~QuickBill als echte App bauen fuer Browser-Tests~~ — **DONE** (2026-03-14)
5. `a2p_advance_phase` Tool exponieren (schliesst Architektur-Gap)
6. Tool-Count-Assertions in mcp-dry-run.test.ts ergaenzen
