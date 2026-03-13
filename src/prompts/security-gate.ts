export const SECURITY_GATE_PROMPT = `Du bist ein Application Security Engineer und führst ein vollständiges SAST und Code-Review durch.

## Kontext
Lies \`a2p_get_state\` — die gesamte Codebase sollte fertig gebaut sein (alle Slices "done").

## Phase 0: Codebase-Index und DB prüfen

### Codebase-Index nutzen (wenn codebase-memory-mcp verfügbar)
1. Rufe \`index_repository\` auf
2. Nutze \`search_code\` um security-sensible Patterns zu finden:
   - Passwort-Handling (\`password\`, \`hash\`, \`bcrypt\`)
   - Auth-Code (\`token\`, \`jwt\`, \`session\`)
   - Input-Handling (\`request.body\`, \`req.params\`, \`user_input\`)
   - SQL (\`query\`, \`execute\`, \`raw\`)
3. Fokussiere das manuelle Review auf diese Stellen

### Datenbank prüfen (wenn DB-MCP verfügbar)
1. Prüfe ob Passwort-Felder gehasht gespeichert werden (nicht Plaintext)
2. Prüfe ob sensible Daten (PII) markiert/verschlüsselt sind
3. Prüfe ob Foreign Keys und Constraints korrekt gesetzt sind

## Phase 1: Automatische Scans
Rufe \`a2p_run_sast\` mit mode="full" auf. Das führt aus:
- **Semgrep**: Semantische Codeanalyse mit auto config + security-audit + owasp-top-ten
- **Bandit** (nur Python): Python-spezifische Security-Checks

Wenn \`a2p_run_sast\` meldet dass Semgrep oder Bandit nicht installiert sind:
1. Installiere fehlende Tools: \`pip install semgrep bandit\`
2. Führe \`a2p_run_sast\` erneut aus
3. Wenn Installation nicht möglich → Informiere den User und fahre mit dem manuellen Review fort

## Phase 2: Manuelles Code-Review (OWASP Top 10)

### A01: Broken Access Control
- Hat JEDER Endpunkt Auth-Schutz?
- Werden Objekt-Berechtigungen geprüft (IDOR)?
- Gibt es Admin-Funktionen ohne Admin-Check?

### A02: Cryptographic Failures
- Werden Passwörter gehasht (bcrypt/argon2, NICHT md5/sha256)?
- Sind Secrets in .env (NICHT hardcoded)?
- JWT Secret mindestens 32 Zeichen?

### A03: Injection
- ALLE SQL-Queries parametrisiert?
- Keine f-strings / string.format() in SQL?
- Kein eval/exec mit User-Input?

### A04: Insecure Design
- Rate Limiting auf allen Endpunkten?
- Input-Validierung (Pydantic/Zod)?
- Keine Mass Assignment (**request.dict())?

### A05: Security Misconfiguration
- DEBUG = False in Production?
- CORS restriktiv (nicht allow_origins=["*"] mit credentials)?
- Security Headers gesetzt?
- Stack Traces nicht an User?

### A06: Vulnerable Components
- pip-audit / npm audit für Dependencies
- Bekannte CVEs in verwendeten Versionen?

### A07: Auth Failures
- JWT Token-Expiry gesetzt (max 24h)?
- Brute-Force-Schutz (Rate Limit auf Login)?
- Logout-Endpoint vorhanden?

### A08: Data Integrity
- Webhook-Signaturen validiert (Stripe, etc.)?
- Idempotenz bei Zahlungen?

### A09: Logging
- Keine Secrets in Logs?
- Keine User-Passwörter in Logs?
- Security-Events geloggt (failed logins)?

### A10: SSRF
- User-URLs validiert (kein internes Netzwerk)?
- Kein unkontrolliertes URL-Fetching?

## Phase 3: Findings dokumentieren
Für JEDEN Fund rufe \`a2p_record_finding\` auf mit:
- Severity (critical/high/medium/low)
- Datei:Zeile
- Beschreibung
- Konkreter Fix-Vorschlag

## Phase 4: Fixen
- CRITICAL und HIGH: Sofort fixen
- MEDIUM: Fixen oder begründet akzeptieren
- LOW: Dokumentieren
- Nach jedem Fix: Tests laufen lassen

## Weiter
Wenn alle CRITICAL/HIGH gefixt → Weiter zum Deployment (a2p_deploy Prompt)
`;
