# Phase A: Credential Validation Results

**Date:** 2026-03-14
**Method:** Read-only API calls against each service endpoint
**Security:** No tokens logged, no resources created/modified/deleted

---

## Test 1: GitHub

- **Companion:** GitHub
- **Token available:** yes
- **API calls:**
  - `GET /user` — HTTP 200
  - `GET /user/repos?per_page=1` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (`/user` returned authenticated user object with `login`, `id`, `type: User`; `/user/repos` returned valid JSON array — empty list, account may have no owned repos visible to this token's scope)
- **README claim status:** VERIFIED
- **Notes:** Token authenticates successfully. Repos list is empty, which may reflect token scope (fine-grained PAT) or account state — not a token issue.

---

## Test 2: Stripe

- **Companion:** Stripe
- **Token available:** yes (secret key + publishable key)
- **API call:**
  - `GET /v1/products?limit=1` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (returned `object: list`, `data` array with 1 product, `url: /v1/products`)
- **Test mode confirmed:** yes (key prefix is `sk_test_`)
- **README claim status:** VERIFIED
- **Notes:** Test-mode key works correctly. Product data exists in test account.

---

## Test 3: Cloudflare

- **Companion:** Cloudflare
- **Token available:** yes (API key + email)
- **API call:**
  - `GET /client/v4/zones?per_page=1` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (`success: true`, `result` array present — empty list, no zones configured)
- **README claim status:** VERIFIED
- **Notes:** Authentication succeeds. Zero zones is valid — account may not have domains configured yet.

---

## Test 4: Sentry

- **Companion:** Sentry
- **Token available:** yes
- **API call:**
  - `GET /api/0/organizations/` — HTTP 401
- **API call succeeded:** no
- **Response contains expected data:** no (response: `{"detail":"Invalid org token"}`)
- **README claim status:** FAILED
- **Notes:** The token format appears to be an org-scoped auth token (`sntrys_` prefix) but the API rejects it as invalid. Possible causes: token expired, token revoked, or token lacks the required `org:read` scope. The token may also need to target a specific Sentry region endpoint rather than `sentry.io`.

---

## Test 5: Vercel

- **Companion:** Vercel
- **Token available:** yes
- **API call:**
  - `GET /v6/deployments?limit=1` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (`deployments` array present — empty list, no deployments exist)
- **README claim status:** VERIFIED
- **Notes:** Token authenticates successfully. Empty deployment list is valid for a new/unused account.

---

## Test 6: Upstash

- **Companion:** Upstash
- **Token available:** yes (email + API key)
- **API call:**
  - `GET /v2/redis/databases` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (returned valid JSON array — empty list, no databases created)
- **README claim status:** VERIFIED
- **Notes:** Authentication succeeds. Empty database list is expected for a fresh account.

---

## Test 7: Supabase

- **Companion:** Supabase
- **Token available:** yes
- **API call:**
  - `GET /v1/projects` — HTTP 200
- **API call succeeded:** yes
- **Response contains expected data:** yes (returned JSON array with 1 project)
- **README claim status:** VERIFIED
- **Notes:** Token authenticates successfully. One project exists in the account.

---

## Summary

| # | Companion   | Token Available | HTTP Status | Auth OK | Expected Data | Status     |
|---|-------------|-----------------|-------------|---------|---------------|------------|
| 1 | GitHub      | yes             | 200         | yes     | yes           | VERIFIED   |
| 2 | Stripe      | yes             | 200         | yes     | yes           | VERIFIED   |
| 3 | Cloudflare  | yes             | 200         | yes     | yes           | VERIFIED   |
| 4 | Sentry      | yes             | 401         | no      | no            | FAILED     |
| 5 | Vercel      | yes             | 200         | yes     | yes           | VERIFIED   |
| 6 | Upstash     | yes             | 200         | yes     | yes           | VERIFIED   |
| 7 | Supabase    | yes             | 200         | yes     | yes           | VERIFIED   |

**Overall: 6/7 credentials verified, 1 failed (Sentry — invalid/expired token)**
