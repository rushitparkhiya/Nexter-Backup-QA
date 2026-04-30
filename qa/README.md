# NexterBackup QA Suite

Playwright test suite for **NexterBackup v1.0.0**.

Two layers:

1. **Dossier baseline** (`@P0` `@P1` `@P2` `@P3` tags) — the 55 test cases
   from the official Release Dossier QA plan. Pass these to ship.
2. **Deep QA** (`@deep` tag) — ~110 adversarial / edge / integrity / security
   / concurrency / compat tests that the dossier doesn't enumerate. Pass these
   for high confidence.

## Quick start

```bash
cp .env.example .env
# Fill in WP_URL, WP_ADMIN_PASS at minimum
npm install
npx playwright install chromium

# Dossier baseline
npm run test:p0          # 10 must-pass
npm run test:p1          # 23 high-priority
npm run test:p2          # 14 edge cases
npm run test:p3          # 8 polish

# Deep QA
npx playwright test --grep '@deep'

# Everything
npm test
```

## Structure

```
qa/
├── playwright.config.ts
├── docker-compose.yml          # WP 6.6 + MariaDB + MinIO + SFTP
├── package.json
├── .env.example
├── fixtures/                   # zip-slip.zip, valid-backup.zip, etc.
└── tests/
    ├── _helpers.ts             # apiGet/Post/Put/Delete, waitForBackup, runFullBackup
    ├── global.setup.ts         # admin + editor session creation
    │
    │ ── Dossier baseline ─────────────────────────────
    ├── 00-smoke.spec.ts                # TC001 TC002
    ├── 30-backup-flow.spec.ts          # TC003 TC004
    ├── 35-restore-roundtrip.spec.ts    # TC005 TC115
    ├── 36-encryption.spec.ts           # TC006 TC007
    ├── 40-tools.spec.ts                # TC114 TC123 TC306
    ├── 50-destinations.spec.ts         # TC101-108 TC118
    ├── 70-edge-cases.spec.ts           # TC201-214
    ├── 75-paired-sites.spec.ts         # TC111 TC112 TC113
    ├── 80-sync-jobs.spec.ts            # TC308 (WP-CLI)
    ├── 85-schedule-settings.spec.ts    # TC109 TC110 TC307
    ├── 90-safety-nets.spec.ts          # TC008 TC119-122 TC208 TC209
    ├── 95-dashboard.spec.ts            # TC009 TC010
    ├── 99-perf.spec.ts                 # TC116 TC117
    ├── A0-visual.spec.ts               # TC301-305
    │
    │ ── Deep QA ─────────────────────────────────────
    ├── 01-rest-validation.spec.ts      # VAL-001…024 (input validation per endpoint)
    ├── 02-csrf-nonce.spec.ts           # CSRF-001…003 (nonce required on every mutating route)
    ├── 03-permissions-deep.spec.ts     # PERM-001…009 (anonymous, editor, role binding)
    ├── 04-data-integrity.spec.ts       # INT-001…007 (round-trip data: post, user, settings, UTF-8)
    ├── 05-concurrency.spec.ts          # CON-001…006 (backup+restore races, concurrent settings)
    ├── 31-backup-deep.spec.ts          # BKP-001…013 (single-component, exclusions, keep_forever)
    ├── 37-encryption-deep.spec.ts      # ENC-001…010 (empty/long/unicode passphrases, rotation)
    ├── 41-cleanup-retention.spec.ts    # CLN-001…008 (retention, orphans, keep-forever survival)
    ├── 42-anonymise-clone.spec.ts      # ANO/CLN-100/SR (anonymise, clone-to-staging, S/R)
    ├── 51-destinations-deep.spec.ts    # DST-001…008 (redaction, TLS, multi-dest, disabled flag)
    ├── 52-oauth-deep.spec.ts           # OAUTH-001…007 (state CSRF, expiry, replay, rate limit)
    ├── 60-importer-deep.spec.ts        # IMP-001…007 (empty/truncated/non-NB zips)
    ├── 76-paired-deep.spec.ts          # PAIR-001…011 (code reuse, HMAC, rate limits)
    ├── 81-cli-deep.spec.ts             # CLI-001…015 (every subcommand, exit codes, JSON shape)
    ├── 86-schedule-deep.spec.ts        # SCH-001…006 (every preset, conflicts, no duplicates)
    ├── 91-security-deep.spec.ts        # SEC-001…011 (SQLi, XSS, path traversal, open redirect)
    ├── 96-audit-deep.spec.ts           # AUD-001…010 (pagination, capping, secret scrubbing)
    ├── 97-compat.spec.ts               # CMP-001…011 (WC, WPML, Redis, multisite, page caches)
    └── B0-browser-ux.spec.ts           # UX-001…009 (tab close, reload, multi-session, deep links)
```

## Tag taxonomy

| Tag | Meaning |
|-----|---------|
| `@P0` | Dossier P0 — must pass before ship |
| `@P1` | Dossier P1 — high priority |
| `@P2` | Dossier P2 — edge cases (not blocking) |
| `@P3` | Dossier P3 — polish |
| `@deep` | Adversarial / integrity / security / concurrency tests not in the dossier |

Run any subset:
```bash
npx playwright test --grep '@P0|@deep'      # Sign-off + paranoia
npx playwright test --grep '@deep'          # Deep QA only
npx playwright test --grep '@P0'            # Smoke only
```

## Counts

| Layer | Specs | Tests |
|-------|------:|------:|
| Dossier baseline (`@P0..@P3`) | 14 | 55 |
| Deep QA round 1 (`@deep`)     | 17 | ~110 |
| Deep QA round 2 (`@deep`)     | 14 | ~150 |
| **Grand total**               | **45** | **~315** |

### Round 2 spec files
- `06-http-protocol.spec.ts`     HTTP-001..015 — malformed JSON, wrong Content-Type, HEAD, headers, charset
- `07-auth-edge.spec.ts`         AUTH-001..008 — App Password, multi-session, tampered cookie, stale nonce
- `08-idempotency.spec.ts`       IDEM-001..006 + STATE-001..003 — repeat ops, state-machine transitions
- `09-fuzz.spec.ts`              FUZZ-001..008 — random / weird inputs to settings / labels / configs
- `10-performance.spec.ts`       PERF-001..015 — latency budgets, throughput, N+1 detection, bundle size
- `11-rest-shape.spec.ts`        SHAPE-001..014 — response contract verification per endpoint
- `12-resilience.spec.ts`        RES-001..008 — stale lock, watchdog, race, restore-missing-source
- `38-archive-integrity.spec.ts` ARCH-001..008 — manifest, sha256 verification, magic bytes
- `43-notifications.spec.ts`     NOT-001..008 — email triggers, throttling, attachments
- `44-auto-backup.spec.ts`       AB-001..005 — on plugin/theme/core update, cooldown
- `45-lock-admin.spec.ts`        LA-001..006 — lock password set/verify/clear, brute-force rate-limit
- `56-s3-deep.spec.ts`           S3-001..009 — region, prefix, wrong bucket, redaction
- `57-sftp-deep.spec.ts`         SFTP-001..009 — password/key auth, port, wrong host, redaction
- `58-local-storage.spec.ts`     LS-001..007 — storage_dir, traversal, custom subdir
- `87-time-clock.spec.ts`        TIME-001..009 — DST, starttime, timestamps, cron sanity
- `92-fuzz-security.spec.ts`     SECF-001..008 — SSRF (15 URLs), polyglot, header injection, prototype
- `98-error-recovery.spec.ts`    ERR-001..006 — failure UX, log fetchable, no 0-byte archives

## Running with Docker

```bash
docker compose up --wait     # Brings up WP, MariaDB, MinIO, SFTP
npm install
npm test
```

## CI scaffolding

Every spec is gated by `test.skip()` when its env prerequisite is missing
(e.g. `MINIO_ENDPOINT`, `WP_SITE_B_URL`, `WC_INSTALLED`). On vanilla CI
without those, only the core ~80 tests run. Set the appropriate env vars
to unlock the rest.

## Authoring conventions

1. **Always use `_helpers.ts` wrappers** (`apiGet`, `apiPost`, `runFullBackup`,
   `waitForBackup`) — they handle nonce + retry + timeout consistently.
2. **Test ID = filename group prefix** (e.g. `TC003-`, `VAL-007-`, `SEC-010-`)
   so failures map back to a single source.
3. **Use `test.skip(true, '...')`** instead of failing when an environment
   prerequisite is missing — keeps CI green when fixtures are absent.
4. **No hardcoded paths** — read from `WP_URL`, `BASE`, `NS` constants.

## Reference

- [Code map](../checklists/nexterbackup-test-code-map.md) — every test case → file/method/REST endpoint
- [QA checklist (human walk-through)](../checklists/nexterbackup-qa-checklist.md) — dossier-shaped manual checklist
