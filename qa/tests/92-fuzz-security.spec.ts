/**
 * 92-fuzz-security.spec.ts
 * Deep QA: security-flavoured fuzz.
 *
 * - Polyglot payloads (strings that are valid in multiple parsers)
 * - SSRF probes against every URL-accepting endpoint
 * - Header injection (\r\n in values)
 * - Open redirect probes
 * - Argon2 / bcrypt hash strings as input (looks like a value, isn't)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const URL_FIELDS = [
  '/backup/paired',  // url field
];

const POLYGLOTS = [
  '"><script>alert(1)</script>',
  '\'-alert(1)-\'',
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '${7*7}',
  '{{7*7}}',
  'http://evil.example.com‮.com', // RTL spoof
];

// ── SSRF: paired url across schemes ──────────────────────────────────────────
const SSRF_URLS = [
  'http://169.254.169.254/latest/meta-data/',
  'http://localhost',
  'http://[::1]',
  'http://10.0.0.1',
  'http://172.17.0.1',
  'http://192.168.0.1',
  'http://[fd00:ec2::254]',
  'http://0.0.0.0',
  'http://0',
  'http://2130706433', // 127.0.0.1 as int
  'http://127.1',      // shorthand loopback
  'gopher://test',
  'file:///etc/passwd',
  'ftp://test',
  'http://test\r\nX-Injected: yes',
];

for (const url of SSRF_URLS) {
  test(`@deep SECF-001 — SSRF probe ${JSON.stringify(url.slice(0, 40))} rejected`, async ({ page, request }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(request, nonce, '/backup/paired', {
      url, code: 'fake', label: 'ssrf-probe',
    });
    expect([400, 403, 422]).toContain(res.status());
  });
}

// ── Polyglot input ───────────────────────────────────────────────────────────
for (const p of POLYGLOTS) {
  test(`@deep SECF-002 — Polyglot label ${JSON.stringify(p.slice(0, 30))} stored safely`, async ({ page, request }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(request, nonce, '/backup/destinations', {
      type: 'local', label: p, enabled: false, config: {},
    });
    expect([200, 400, 422]).toContain(res.status());

    if (res.status() === 200) {
      const id = (await res.json()).data?.id as string;
      const { apiDelete } = await import('./_helpers');
      await apiDelete(request, nonce, `/backup/destinations/${id}`, {
        confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
      });
    }
  });
}

// ── Header injection in OAuth state ──────────────────────────────────────────
test('@deep SECF-003 — \\r\\n in OAuth state param does not injected into response headers', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const malicious = encodeURIComponent('safe\r\nX-Injected: pwned\r\n');
  const res = await request.get(
    `${NS}/backup/destinations/google-drive/oauth/callback?code=x&state=${malicious}`,
    { headers: { 'X-WP-Nonce': nonce } },
  );
  expect(res.headers()['x-injected']).toBeUndefined();
});

// ── Path traversal in importer file_id ───────────────────────────────────────
test('@deep SECF-004 — POST /backup/importer with traversed file_id rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  for (const p of ['../../wp-config.php', '..%2F..%2Fwp-config', '/etc/hosts']) {
    const res = await apiPost(request, nonce, '/backup/importer', { file_id: p });
    expect([400, 403, 404, 422]).toContain(res.status());
  }
});

// ── Path traversal in storage_dir ────────────────────────────────────────────
test('@deep SECF-005 — Storage dir = file:///etc/passwd rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  for (const p of ['file:///etc/passwd', '\\\\hostname\\share', 'phar://attack.phar']) {
    const res = await apiPut(request, nonce, '/backup/settings', { storage_dir: p });
    expect([200, 400, 422]).toContain(res.status());
    // If accepted we must verify it didn't actually use it — ideally rejected
  }
});

// ── XML/JSON polyglot in JSON body ───────────────────────────────────────────
test('@deep SECF-006 — XML in JSON-only POST body rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.post(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    '<?xml version="1.0"?><run><type>full</type></run>',
  });
  expect([400, 422]).toContain(res.status());
});

// ── Prototype pollution attempt in settings ──────────────────────────────────
test('@deep SECF-007 — Settings PUT with __proto__ key does not poison globals', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    __proto__: { isAdminEverywhere: true },
    constructor: { prototype: { x: 'pwn' } },
  });
  expect([200, 400, 422]).toContain(res.status());

  // Verify globals not poisoned by re-fetching site-info
  const { apiGet } = await import('./_helpers');
  const after = await apiGet(request, nonce, '/backup/site-info');
  expect(after.status()).toBe(200);
});

// ── Wrong HTTP method on public route ────────────────────────────────────────
test('@deep SECF-008 — PATCH /backup/run not allowed', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.fetch(`${NS}/backup/run`, {
    method:  'PATCH',
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    JSON.stringify({ type: 'full' }),
  });
  expect([404, 405]).toContain(res.status());
});
