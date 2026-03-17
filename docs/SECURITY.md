# A2P Security Model

This document covers A2P's security mechanisms, the full coverage matrix, findings model, and the distinction between code-enforced and prompt-guided security behaviors.

---

## Overview

A2P layers multiple security mechanisms — from deterministic pattern matching to LLM-guided code review to active runtime testing. Each mechanism operates at a different enforcement level, and every finding produces verifiable evidence.

---

## Mechanisms

### Probe — Deterministic Pattern Matching

Regex/AST pattern matching with zero false negatives for covered patterns. 32 deterministic probes detect hardcoded secrets, SQL/command/NoSQL injection, XSS, insecure deserialization, eval with user input, SSRF, path traversal, mass assignment (including spread/Object.assign), open redirects, insecure crypto, cookie security, CORS misconfiguration, CSRF, JWT without expiry, file upload without limits, PII in logs, ORM raw queries, destructive migrations, secrets in Dockerfiles, unpinned base images, missing auth/rate limiting/input validation — each with context-aware suppression to reduce false positives.

### SAST — Static Analysis

Semgrep + Bandit static analysis. Semgrep covers all languages, Bandit adds Python-specific analysis. Dependency scanning via `npm audit` and `pip-audit` with automatic severity mapping.

### Adversarial — LLM-Guided Code Review

Evidence-based adversarial review across 25 domains:

Business logic, auth bypasses, race conditions, IDOR/ownership, XSS, deserialization, cookie/CORS security, deployment config, backup security, tenant isolation, session/JWT security, password reset flows, file upload, webhook security, cache-control, DB connection security, soft delete access, internal endpoint exposure.

High/critical findings require confidence level and file:line evidence. Hypotheses are auto-downgraded to medium. Confidence stats track evidence quality across rounds.

### Shake & Break — Runtime Adversarial Testing

Active runtime testing in an isolated sandbox. Creates a git worktree, generates safe .env with neutralized external services, allocates an ephemeral port, and optionally spins up a Docker DB. Claude starts the app and sends real HTTP requests across 8 categories:

1. Auth/IDOR
2. Race conditions
3. State manipulation
4. Business logic
5. Injection
6. Token/session
7. File upload
8. Webhook security

Findings are evidence-backed with actual request/response proof. Requires adversarial review completion. SQLite fallback available when Docker is unavailable (with confidence downgrade for race conditions and injection tests).

### Active Verification — Runtime Gate Tests

Runtime gate tests that prove workflow invariants hold:
- State transitions require evidence
- Deployment gates block correctly
- State survives round-trips

Deployment is blocked without a passing active verification. Gate violation produces a critical finding.

### Artifact Validation — Deployment File Security

Security checks on generated deployment files:
- Dockerfile: non-root user, multi-stage build, no secrets copy
- docker-compose: `security_opt`, `cap_drop`
- Caddyfile: security headers, CORS, Permissions-Policy
- Backup scripts: credential handling, encryption
- Body parser size limits
- Source map exclusion

---

## Security Coverage Matrix

**Legend:**
- **Probe** — Deterministic regex/AST pattern matching (zero false negatives for covered patterns)
- **Adversarial** — LLM-guided code review with confidence tracking and file:line evidence
- **SAST** — Semgrep + Bandit static analysis
- **Shake & Break** — Runtime adversarial testing with real HTTP requests in an isolated sandbox
- **Artifact Validation** — Security checks on generated deployment files
- **Active Verification** — Runtime gate tests proving workflow invariants hold
- **Checklist** — Pre/post-deployment verification items

| Security Domain | Mechanism | Enforcement | Evidence |
|---|---|---|---|
| **Injection** | | | |
| SQL injection (interpolation, ORM raw queries) | Probe + SAST + Shake & Break | Code-enforced + Runtime-tested | Pattern match + SAST finding + HTTP request/response |
| Command injection | Probe + SAST | Code-enforced | Pattern match + SAST finding |
| NoSQL injection (query operators) | Probe | Code-enforced | Pattern match with context |
| XSS (DOM manipulation, output encoding) | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + file:line evidence |
| Path traversal | Probe + Shake & Break | Code-enforced + Runtime-tested | Pattern match + HTTP proof |
| SSRF (user-controlled URLs) | Probe | Code-enforced | Pattern match with context |
| Insecure deserialization | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + confidence level |
| Code execution (eval/Function) | Probe + SAST | Code-enforced | Pattern match + SAST finding |
| **Auth & Access Control** | | | |
| Missing auth middleware | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + file:line evidence |
| IDOR / missing ownership checks | Adversarial + Shake & Break | Prompt-guided + Runtime-tested | Confidence level + HTTP proof |
| Privilege escalation | Adversarial + Shake & Break | Prompt-guided + Runtime-tested | file:line evidence + HTTP proof |
| Auth bypasses | Adversarial + Shake & Break | Prompt-guided + Runtime-tested | Confidence level + HTTP proof |
| Mass assignment (spread/Object.assign) | Probe | Code-enforced | Pattern match with context suppression |
| Missing rate limiting | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + file:line evidence |
| **Secrets & Credentials** | | | |
| Hardcoded passwords | Probe + SAST | Code-enforced | Pattern match + SAST finding |
| Hardcoded API keys/secrets | Probe + SAST | Code-enforced | Pattern match + SAST finding |
| Base64-encoded secrets | Probe | Code-enforced | Pattern match |
| Seed/default credentials | Probe | Code-enforced | Pattern match with production guard check |
| Secrets in Dockerfiles | Probe + Artifact Validation | Code-enforced | Pattern match + artifact check |
| PII/secrets in logs | Probe | Code-enforced | Pattern match |
| **Session & Token Security** | | | |
| Cookie security flags (HttpOnly/Secure/SameSite) | Probe + Adversarial + Checklist | Code-enforced + Prompt-guided | Pattern match + checklist verification |
| JWT without expiry | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + file:line evidence |
| Session fixation/regeneration | Adversarial + Shake & Break | Prompt-guided + Runtime-tested | Confidence level + HTTP proof |
| CSRF protection | Probe + Adversarial | Code-enforced + Prompt-guided | Pattern match + file:line evidence |
| Password reset flow weaknesses | Adversarial | Prompt-guided | Confidence level + file:line evidence |
| **Web Security** | | | |
| CORS misconfiguration | Probe + Adversarial + Checklist | Code-enforced + Prompt-guided | Pattern match + checklist verification |
| Open redirects | Probe | Code-enforced | Pattern match |
| Missing security headers | Artifact Validation + Checklist | Code-enforced | Artifact check + checklist |
| Cache-control (auth responses) | Adversarial | Prompt-guided | file:line evidence |
| **Deployment & Infrastructure** | | | |
| Dockerfile security (non-root, multi-stage, no secrets) | Artifact Validation | Code-enforced | Artifact validation pass/fail |
| docker-compose hardening (security_opt, cap_drop) | Artifact Validation | Code-enforced | Artifact validation pass/fail |
| Unpinned base images | Probe | Code-enforced | Pattern match |
| Debug mode in production | Adversarial + Checklist | Prompt-guided | file:line evidence + checklist |
| Internal endpoint exposure | Adversarial + Checklist | Prompt-guided | file:line evidence + checklist |
| DB connection security (TLS/SSL) | Adversarial + Checklist | Prompt-guided | Confidence level + checklist |
| **Data Protection** | | | |
| Tenant isolation gaps | Adversarial | Prompt-guided | Confidence level + file:line evidence |
| Soft delete access control | Adversarial | Prompt-guided | file:line evidence |
| Backup encryption | Adversarial + Checklist | Prompt-guided | file:line evidence + checklist |
| File upload without limits | Probe + Adversarial + Shake & Break | Code-enforced + Runtime-tested | Pattern match + HTTP proof |
| Destructive migrations without rollback | Probe | Code-enforced | Pattern match |
| Insecure crypto functions | Probe | Code-enforced | Pattern match |
| **Runtime Adversarial (Shake & Break)** | | | |
| Race conditions (double-spend, state inconsistency) | Shake & Break | Runtime-tested | Concurrent HTTP requests + response proof |
| State manipulation (unexpected API sequences) | Shake & Break | Runtime-tested | Multi-step HTTP request/response proof |
| Business logic bypasses (price manipulation, flow skipping) | Shake & Break | Runtime-tested | HTTP request/response proof |
| Webhook replay/signature bypass | Adversarial + Shake & Break | Prompt-guided + Runtime-tested | Confidence level + HTTP proof |
| **Workflow Integrity** | | | |
| Evidence gates (tests required for green/done) | Active Verification | Code-enforced + Runtime-tested | Gate violation = critical finding |
| Deployment gates (SAST/whitebox/audit blocking) | Active Verification | Code-enforced + Runtime-tested | Gate violation = critical finding |
| State persistence (round-trip integrity) | Active Verification | Runtime-tested | Serialization verification |
| **Dependencies** | | | |
| Known vulnerabilities (npm, pip) | SAST (`npm audit` / `pip-audit`) | Code-enforced | Severity-mapped findings |

**Coverage by numbers:** 32 deterministic probes · 25 adversarial review domains · 8 runtime test categories · 2 active verification categories · deployment artifact validation · dependency scanning · pre/post-deployment checklists

---

## Findings Model

Every security finding includes:

- **Severity** — `critical`, `high`, `medium`, `low`, `info`
- **Status** — `open`, `fixed`, `accepted`, `false_positive`
- **Evidence** — file:line references, pattern matches, HTTP request/response proof
- **Confidence** — required for high/critical adversarial findings
- **Justification** — required when setting status to `accepted`, `fixed`, or `false_positive` (code-enforced via `a2p_record_finding`)

### Blocking Rules

- Open CRITICAL/HIGH SAST findings block deployment
- Blocking whitebox findings (confirmed exploitable auth/secrets/tenant issues) block deployment
- Critical release audit findings block deployment
- Hypothetical adversarial findings are auto-downgraded to medium severity

---

## Dependency Scanning

- `npm audit` for Node.js projects
- `pip-audit` for Python projects
- Findings are severity-mapped and integrated into the SAST results
- Known vulnerability counts factor into deployment gate decisions

---

## Deployment Artifact Validation

Every generated deployment file is validated for security:

| File | Checks |
|------|--------|
| Dockerfile | Non-root user, multi-stage build, no COPY of secrets |
| docker-compose | `security_opt: no-new-privileges`, `cap_drop: ALL` |
| Caddyfile | Security headers, CORS policy, Permissions-Policy |
| Backup scripts | No inline credentials, encryption configured |
| Application | Body parser size limits, source maps excluded |

---

## Code-Enforced vs Prompt-Guided

A2P distinguishes between two enforcement levels:

**Code-enforced** — The MCP tool throws an error if the condition is not met. The AI agent cannot bypass this regardless of prompt instructions. Examples: evidence gates, SAST findings blocking deployment, backup gate for stateful apps.

**Prompt-guided** — The AI agent follows instructions in the prompt. These are effective but can theoretically be overridden by sufficiently creative prompt engineering. Examples: OWASP Top 10 manual review, documentation-first principle, quality audit cadence.

Both levels are important. Code enforcement prevents AI shortcuts. Prompt guidance adds depth that would be impractical to encode as hard gates (e.g., "check if this deserialization is actually reachable from user input").
