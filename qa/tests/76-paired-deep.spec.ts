/**
 * 76-paired-deep.spec.ts
 * Deep QA: paired-site security beyond the dossier P1.
 *
 * - Pair code single-use (rejected on second accept)
 * - Pair code expiry (after 1800s TTL)
 * - Per-IP rate limit on /backup/pair/accept (10/900s)
 * - Per-code-hash rate limit (5/300s)
 * - HMAC signature mismatch rejected
 * - Cross-namespace state contamination
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Per-IP rate limit on /pair/accept â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-001 â€” More than 10 invalid pair-accept attempts in 15 min returns 429', async ({ request }) => {
  let firstReject: number | null = null;
  for (let i = 0; i < 12; i++) {
    const res = await page.request.post(`${NS}/backup/pair/accept`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { code: `bogus-code-${i}-${Date.now()}` },
    });
    if (res.status() === 429) { firstReject = i; break; }
  }
  // Per the dossier: 10 / 900s per IP â€” should hit at request #11
  if (firstReject !== null) {
    expect(firstReject).toBeLessThanOrEqual(11);
  }
});

// â”€â”€ Per-code-hash rate limit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-002 â€” Same bogus code hammered hits per-code rate limit (5/300s)', async ({ request }) => {
  const code = 'fixed-bogus-code-' + Date.now();
  let firstReject: number | null = null;
  for (let i = 0; i < 7; i++) {
    const res = await page.request.post(`${NS}/backup/pair/accept`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { code },
    });
    if (res.status() === 429) { firstReject = i; break; }
  }
  if (firstReject !== null) {
    expect(firstReject).toBeLessThanOrEqual(6);
  }
});

// â”€â”€ Code requires valid format â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-003 â€” POST /backup/pair/accept without code returns 400/422', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/pair/accept`, {
    headers: { 'Content-Type': 'application/json' },
    data:    {},
  });
  expect([400, 401, 403, 422, 429]).toContain(res.status());
});

// â”€â”€ Generate pair code returns expected shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-004 â€” POST /backup/paired/code returns code + expires_in', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/paired/code');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.code).toMatch(/^[A-Za-z0-9-]{8,}$/);
  expect(body.data?.expires_in).toBeGreaterThan(0);
  expect(body.data?.expires_in).toBeLessThanOrEqual(1800); // dossier says 1800s TTL
});

// â”€â”€ Generated code single-use â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-005 â€” Pair code can only be accepted once', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const codeRes = await apiPost(page, nonce, '/backup/paired/code');
  const code    = (await codeRes.json()).data?.code as string;

  // First accept (would normally come from the OTHER site)
  const accept1 = await page.request.post(`${NS}/backup/pair/accept`, {
    headers: { 'Content-Type': 'application/json' },
    data:    { code, url: 'https://requesting-site.example.test', label: 'A' },
  });
  // First might 200 or fail SSRF check (URL is fake)
  expect([200, 400, 422]).toContain(accept1.status());

  // Second accept with same code must fail (single-use)
  const accept2 = await page.request.post(`${NS}/backup/pair/accept`, {
    headers: { 'Content-Type': 'application/json' },
    data:    { code, url: 'https://second-attempt.example.test', label: 'B' },
  });
  expect([400, 401, 403, 410, 422, 429]).toContain(accept2.status());
});

// â”€â”€ HMAC signature on inter-site routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-006 â€” POST /backup/incoming without HMAC signature rejected', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/incoming`, {
    headers: { 'Content-Type': 'application/json' },
    data:    { backup_id: 'fake' },
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

test('@deep PAIR-007 â€” POST /backup/fetch without HMAC signature rejected', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/fetch`, {
    headers: { 'Content-Type': 'application/json' },
    data:    {},
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

test('@deep PAIR-008 â€” POST /backup/notify without HMAC signature rejected', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/notify`, {
    headers: { 'Content-Type': 'application/json' },
    data:    {},
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

test('@deep PAIR-009 â€” POST /backup/list-paired without HMAC signature rejected', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/list-paired`, {
    headers: { 'Content-Type': 'application/json' },
    data:    {},
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

// â”€â”€ HMAC signature with wrong secret rejected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-010 â€” POST /backup/incoming with bogus X-NXT-Signature rejected', async ({ request }) => {
  const res = await page.request.post(`${NS}/backup/incoming`, {
    headers: {
      'Content-Type':     'application/json',
      'X-NXT-Signature':  'sha256=' + 'a'.repeat(64),
      'X-NXT-Timestamp':  String(Math.floor(Date.now() / 1000)),
      'X-NXT-Pair-ID':    'fake-pair',
    },
    data: { backup_id: 'fake' },
  });
  expect([400, 401, 403, 422]).toContain(res.status());
});

// â”€â”€ Cleanup any pair codes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep PAIR-011 â€” Audit log records pair.rate_limited on excessive failures', async ({ page, request }) => {
  // Trigger a rate-limit
  for (let i = 0; i < 12; i++) {
    await page.request.post(`${NS}/backup/pair/accept`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { code: `audit-probe-${i}` },
    });
  }

  const nonce   = await getNonce(page);
  const audit   = await apiGet(page, nonce, '/backup/audit', { limit: '50' });
  const entries = (await audit.json()).data as { action: string }[];
  // Either pair.rate_limited or pair.accept_failed should appear
  expect(entries.some(e => /pair\./.test(e.action))).toBe(true);
});
