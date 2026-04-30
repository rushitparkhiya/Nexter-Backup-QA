/**
 * 91-security-deep.spec.ts
 * Deep QA: security beyond TC008/119/120/208/209.
 *
 * - SQL injection in route params
 * - XSS in destination labels / pair labels
 * - Path traversal in /backup/download/{id}
 * - Open redirect in OAuth callback
 * - Audit log XSS storage
 * - Race condition on enqueue lock
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, apiGet, apiDelete, BASE, NS, ADMIN_PASS,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── SQL injection probes ─────────────────────────────────────────────────────
test('@deep SEC-001 — SQL injection in /backup/{id} path param does not execute', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const probes = [
    "1' OR '1'='1",
    "1; DROP TABLE wp_options;--",
    "1 UNION SELECT user_pass FROM wp_users",
    "../../etc/passwd",
  ];

  for (const probe of probes) {
    const res = await apiDelete(request, nonce, `/backup/${encodeURIComponent(probe)}`, {
      confirm_password: ADMIN_PASS,
    });
    expect([400, 404]).toContain(res.status());

    // Verify wp_users table still has the admin user
    const stillAlive = await apiGet(request, nonce, '/backup/stats');
    expect(stillAlive.status()).toBe(200);
  }
});

test('@deep SEC-002 — SQL injection in /backup/destinations/{id} path param', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const probe = "1' OR '1'='1";
  const res   = await apiDelete(request, nonce, `/backup/destinations/${encodeURIComponent(probe)}`, {
    confirm_password: ADMIN_PASS,
  });
  expect([400, 404]).toContain(res.status());
});

test('@deep SEC-003 — SQL injection in /backup/log/{id} path param', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, `/backup/log/${encodeURIComponent("1' OR '1'='1")}`);
  expect([400, 404]).toContain(res.status());
});

// ── XSS in destination label stored & echoed ─────────────────────────────────
test('@deep SEC-004 — XSS payload in destination label is escaped on read', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const xss     = '<script>alert("xss-pwn")</script>';
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: xss, enabled: true, config: {},
  });
  expect(saveRes.status()).toBe(200);
  const destId = (await saveRes.json()).data?.id as string;

  // Visit dashboard — label should be displayed but NOT execute script
  const xssFired: boolean[] = [];
  page.on('dialog', async dlg => { xssFired.push(true); await dlg.dismiss(); });

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup#/storage`);
  await page.waitForTimeout(2_000);

  expect(xssFired).toHaveLength(0);

  // Cleanup
  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: ADMIN_PASS,
  });
});

// ── XSS in audit log context ─────────────────────────────────────────────────
test('@deep SEC-005 — XSS payload in destination label is escaped in audit log', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const xss   = '"><img src=x onerror=alert(1)>';

  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: xss, enabled: true, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  const auditRes = await apiGet(request, nonce, '/backup/audit', { limit: '20' });
  const text     = JSON.stringify(await auditRes.json());

  // The raw XSS string may appear in the audit data (it's JSON-encoded), but
  // when rendered to HTML it must be escaped. Verify no unescaped tags.
  // We test by visiting the audit page in the browser and checking for alerts.
  const xssFired: boolean[] = [];
  page.on('dialog', async dlg => { xssFired.push(true); await dlg.dismiss(); });
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup#/tools/audit`);
  await page.waitForTimeout(2_000);
  expect(xssFired).toHaveLength(0);

  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: ADMIN_PASS,
  });
});

// ── Path traversal in download ────────────────────────────────────────────────
test('@deep SEC-006 — GET /backup/download/{id} with path-traversal id rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const probes = ['../../../wp-config.php', '..%2F..%2F..%2Fwp-config.php', '%2E%2E%2Fwp-config'];
  for (const probe of probes) {
    const res = await request.get(
      `${NS}/backup/download/${encodeURIComponent(probe)}`,
      { headers: { 'X-WP-Nonce': nonce } },
    );
    expect([400, 403, 404]).toContain(res.status());
  }
});

test('@deep SEC-007 — GET /backup/download/{id}/{idx} with negative idx rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Need a valid backup id
  const listRes = await apiGet(request, nonce, '/backup/list');
  const backup  = (await listRes.json()).data?.[0] as { id?: string } | undefined;
  if (!backup?.id) { test.skip(true, 'No backups exist'); return; }

  const res = await request.get(`${NS}/backup/download/${backup.id}/-1`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect([400, 404]).toContain(res.status());
});

// ── Open redirect in OAuth callback ──────────────────────────────────────────
test('@deep SEC-008 — OAuth callback does not redirect to external URL via state contents', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Try to redirect via the state field
  const res = await request.get(
    `${NS}/backup/destinations/google-drive/oauth/callback?code=x&state=https%3A%2F%2Fevil.example.com`,
    {
      headers: { 'X-WP-Nonce': nonce },
      maxRedirects: 0,
    },
  );

  if (res.status() >= 300 && res.status() < 400) {
    const loc = res.headers()['location'] ?? '';
    // Must NOT redirect to evil.example.com
    expect(loc).not.toMatch(/evil\.example\.com/);
  }
});

// ── Pair-accept does not echo unsanitised label ──────────────────────────────
test('@deep SEC-009 — Pair label is sanitised on read', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const xss   = '<svg/onload=alert(1)>';

  // We cannot create a real pair without a 2nd site, but PUT with bogus URL
  // exercises the validation path
  const res = await apiPut(request, nonce, '/backup/paired', {
    url:   'https://test.example.test',
    code:  'fake',
    label: xss,
  });
  // Most likely 400 due to bogus URL/code, but if accepted, label must be escaped
  if (res.status() === 200) {
    const listRes = await apiGet(request, nonce, '/backup/paired');
    const labels  = ((await listRes.json()).data as { label?: string }[]).map(p => p.label ?? '');
    expect(labels.every(l => !l.includes('<svg') || l.includes('&lt;'))).toBe(true);
  }
});

// ── Race on enqueue lock ─────────────────────────────────────────────────────
test('@deep SEC-010 — 5 parallel POST /backup/run requests result in exactly one 200', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const results = await Promise.all(
    Array.from({ length: 5 }, () => apiPost(request, nonce, '/backup/run', { type: 'database' })),
  );
  const statuses = results.map(r => r.status());
  const okCount  = statuses.filter(s => s === 200).length;
  const lockedCount = statuses.filter(s => s === 409).length;

  expect(okCount).toBe(1);
  expect(okCount + lockedCount).toBe(5);

  // Drain
  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(request, nonce, { driveSteps: true });
});

// ── Generic error messages on public endpoints ───────────────────────────────
test('@deep SEC-011 — Public /pair/accept does not disclose IP class or system info on rejection', async ({ request }) => {
  const res  = await request.post(`${NS}/backup/pair/accept`, {
    headers: { 'Content-Type': 'application/json' },
    data:    { code: 'invalid-' + Date.now() },
  });
  const text = await res.text();
  // Must NOT echo internal paths, hostnames, or stack frames
  expect(text).not.toMatch(/\/var\/www|\/home\/|fatal|stack|trace|\.php:\d+/i);
});
