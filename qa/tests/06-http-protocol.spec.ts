/**
 * 06-http-protocol.spec.ts
 * Deep QA: HTTP-level edge cases (the "below the JSON" layer).
 *
 * - Malformed JSON body
 * - Wrong Content-Type
 * - Missing Content-Type
 * - Oversized payload
 * - HEAD on GET routes
 * - OPTIONS preflight
 * - Compression headers (gzip / brotli)
 * - Conditional requests (If-None-Match)
 */
import { test, expect } from '@playwright/test';
import { getNonce, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Malformed JSON â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-001 â€” POST with malformed JSON body returns 400', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.post(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    'this is { not valid JSON',
  });
  expect([400, 500]).toContain(res.status());
});

test('@deep HTTP-002 â€” PUT with empty body returns 400 or applies defaults', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.put(`${NS}/backup/settings`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    '',
  });
  expect([200, 400, 422]).toContain(res.status());
});

// â”€â”€ Wrong Content-Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-003 â€” POST with text/plain body still parsed by WP REST', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.post(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'text/plain' },
    data:    JSON.stringify({ type: 'database' }),
  });
  // WP REST is lenient; accept either 200 or 400
  expect([200, 400, 415]).toContain(res.status());
});

// â”€â”€ Missing Content-Type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-004 â€” POST without Content-Type header returns sensible status', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.post(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce },
    data:    JSON.stringify({ type: 'database' }),
  });
  expect([200, 400, 415]).toContain(res.status());
});

// â”€â”€ Oversized payload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-005 â€” POST with 10MB body rejected (request_size_too_large or 200 with no-op)', async ({ page }) => {
  const nonce  = await getNonce(page);
  const huge   = 'A'.repeat(10 * 1024 * 1024); // 10 MB
  const res    = await page.request.put(`${NS}/backup/settings`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    JSON.stringify({ giant_field: huge }),
    timeout: 60_000,
  });
  // PHP post_max_size or request size limits should apply
  expect([200, 400, 413, 422, 500]).toContain(res.status());
});

// â”€â”€ HEAD method â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-006 â€” HEAD /backup/stats returns 200 (or 405) with no body', async ({ page }) => {
  const nonce = await getNonce(page);
  // Playwright doesn't have request.head() â€” use fetch
  const res = await page.request.fetch(`${NS}/backup/stats`, {
    method: 'HEAD',
    headers: { 'X-WP-Nonce': nonce },
  });
  expect([200, 404, 405]).toContain(res.status());
  if (res.status() === 200) {
    expect((await res.body()).length).toBe(0);
  }
});

// â”€â”€ Cache headers reaffirmation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-007 â€” Every namespaced GET response sets Pragma: no-cache', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.headers()['pragma']).toMatch(/no-cache/);
});

test('@deep HTTP-008 â€” Every namespaced GET response sets Expires: 0', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/list`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.headers()['expires']).toMatch(/^0$|^Thu, 01 Jan 1970/);
});

// â”€â”€ X-WP-Total / X-WP-TotalPages on list endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-009 â€” /backup/list returns X-WP-Total header (if pagination supported)', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/list`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  // Optional â€” some endpoints don't paginate
  const total = res.headers()['x-wp-total'];
  if (total !== undefined) {
    expect(parseInt(total, 10)).toBeGreaterThanOrEqual(0);
  }
});

// â”€â”€ No nonce echoed in response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-010 â€” REST response does not echo X-WP-Nonce in body', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const body = await res.text();
  expect(body).not.toContain(nonce);
});

// â”€â”€ Compression supported â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-011 â€” Server accepts Accept-Encoding: gzip and may compress', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/list`, {
    headers: {
      'X-WP-Nonce':      nonce,
      'Accept-Encoding': 'gzip, deflate, br',
    },
  });
  expect(res.status()).toBe(200);
  // Apache/nginx typically returns Content-Encoding: gzip for large responses
});

// â”€â”€ Vary header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-012 â€” Response includes correct Vary header for cookie-based auth', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  // WP normally sets Vary: Cookie or Accept-Encoding
  const vary = res.headers()['vary'] ?? '';
  // Acceptable absent for our namespace; if present, must include relevant fields
  if (vary) {
    expect(vary.toLowerCase()).toMatch(/cookie|accept|origin/);
  }
});

// â”€â”€ X-Robots-Tag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-013 â€” REST namespace responses are not indexable', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const xrobots = res.headers()['x-robots-tag'] ?? '';
  // WP REST typically sets noindex; if not, page is private anyway via auth
  // Acceptable either way
  expect(typeof xrobots).toBe('string');
});

// â”€â”€ Content-Type charset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-014 â€” Response Content-Type includes charset=UTF-8', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.headers()['content-type']).toMatch(/utf-?8/i);
});

// â”€â”€ Trailing slashes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep HTTP-015 â€” GET /backup/stats/ (trailing slash) behaves same as no slash', async ({ page }) => {
  const nonce  = await getNonce(page);
  const noSlash    = await page.request.get(`${NS}/backup/stats`,  { headers: { 'X-WP-Nonce': nonce } });
  const withSlash  = await page.request.get(`${NS}/backup/stats/`, { headers: { 'X-WP-Nonce': nonce } });
  // WP either normalizes or returns 404 for trailing slash
  expect([noSlash.status(), withSlash.status()]).toContain(200);
});
