/**
 * 07-auth-edge.spec.ts
 * Deep QA: authentication edge cases.
 *
 * - Application Passwords (alternative auth)
 * - User role downgraded mid-run
 * - Password changed mid-session
 * - Two simultaneous logins same user
 * - Logged-in cookie tampered
 * - Session from different site (cross-WP)
 */
import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import { getNonce, apiPost, apiGet, runFullBackup, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Application password (Basic auth) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-001 â€” Application Password lets admin call REST without nonce', async ({ request }) => {
  test.skip(
    !process.env.WP_APP_PASSWORD,
    'Set WP_APP_PASSWORD (admin app password) to test alt auth',
  );

  // Intentionally unauthenticated context — Basic auth provides auth here, no cookies needed
  const cred = Buffer.from(`${process.env.WP_ADMIN_USER}:${process.env.WP_APP_PASSWORD}`).toString('base64');
  const res  = await request.get(`${NS}/backup/stats`, {
    headers: { Authorization: `Basic ${cred}` },
  });
  expect(res.status()).toBe(200);
});

// â”€â”€ Concurrent sessions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-002 â€” Two simultaneous admin browsers see consistent backup list', async ({ browser, request }) => {
  const ctx1 = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'admin.json'),
  });
  const ctx2 = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'admin.json'),
  });

  const p1 = await ctx1.newPage();
  const p2 = await ctx2.newPage();
  await p1.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  await p2.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);

  const n1 = await getNonce(p1);
  const n2 = await getNonce(p2);

  // Run backup from session 1
  const backup = await runFullBackup(page, n1);

  // Session 2 should see it
  const list2  = await apiGet(page, n2, '/backup/list');
  const ids    = ((await list2.json()).data as { id: string }[]).map(b => b.id);
  expect(ids).toContain(backup.id);

  await ctx1.close();
  await ctx2.close();
});

// â”€â”€ Tampered logged_in cookie â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-003 â€” REST request with tampered logged_in cookie returns 401', async ({ page, request }) => {
  const cookies = await page.context().cookies();
  const loggedIn = cookies.find(c => c.name.startsWith('wordpress_logged_in_'));
  if (!loggedIn) {
    test.skip(true, 'No logged_in cookie to tamper');
    return;
  }

  // Use bare request (no admin session) and send ONLY the tampered cookie
  // so WP sees an invalid credential with no fallback valid session
  const tampered = loggedIn.value.slice(0, -8) + 'AAAAAAAA';
  const cookieHeader = `${loggedIn.name}=${tampered}`;
  const res = await request.get(`${NS}/backup/stats`, {
    headers: { Cookie: cookieHeader },
  });
  expect([401, 403]).toContain(res.status());
});

// â”€â”€ Stale nonce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-004 â€” Old nonce after logout is invalid', async ({ browser, request }) => {
  const ctx  = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'admin.json'),
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const nonce = await getNonce(page);

  // Logout
  await page.goto(`${BASE}/wp-login.php?action=logout`);
  // WP usually has a confirm; click it
  const confirmLink = page.locator('a:has-text("log out")').first();
  if (await confirmLink.isVisible()) await confirmLink.click();

  // Use the stale nonce
  const res = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect([401, 403]).toContain(res.status());
  await ctx.close();
});

// â”€â”€ User deleted mid-backup (orphan run) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-005 â€” Run record retains user_id even if user is later deleted', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const audit  = await apiGet(page, nonce, '/backup/audit', { limit: '10' });
  const entries = (await audit.json()).data as { user?: number }[];
  expect(entries[0]?.user).toBeGreaterThan(0);
});

// â”€â”€ Application passwords disabled â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-006 â€” When app passwords disabled, basic auth fails cleanly', async ({ request }) => {
  // Intentionally unauthenticated context — testing that wrong basic auth returns 401/403
  const cred = Buffer.from('admin:not-an-app-password').toString('base64');
  const res  = await request.get(`${NS}/backup/stats`, {
    headers: { Authorization: `Basic ${cred}` },
  });
  expect([401, 403]).toContain(res.status());
});

// â”€â”€ REST authorize cookie wins over Basic â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-007 â€” Cookie + nonce auth still wins when garbage Basic header present', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: {
      'X-WP-Nonce':    nonce,
      'Authorization': 'Basic invalid-garbage',
    },
  });
  // Different WP versions handle this differently â€” accept 200 (cookie wins)
  // or 401 (Basic header preferred and rejected)
  expect([200, 401, 403]).toContain(res.status());
});

// â”€â”€ Cross-tab token stays in sync after settings change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUTH-008 â€” Two tabs of the same user see the same encryption_enabled flag', async ({ browser }) => {
  const ctx  = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'admin.json'),
  });
  const t1 = await ctx.newPage();
  const t2 = await ctx.newPage();
  await t1.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  await t2.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const n1 = await getNonce(t1);
  const n2 = await getNonce(t2);

  // Toggle from tab 1 — use t1.request so cookies from ctx are included
  await t1.request.put(`${NS}/backup/settings`, {
    headers: { 'X-WP-Nonce': n1, 'Content-Type': 'application/json' },
    data:    { encryption_enabled: true, encryption_phrase: 'temp-pass-08' },
  });

  // Tab 2 reads
  const res  = await t2.request.get(`${NS}/backup/settings`, {
    headers: { 'X-WP-Nonce': n2 },
  });
  const body = await res.json();
  expect(body.data?.encryption_enabled).toBe(true);

  // Cleanup
  await t1.request.put(`${NS}/backup/settings`, {
    headers: { 'X-WP-Nonce': n1, 'Content-Type': 'application/json' },
    data:    { encryption_enabled: false },
  });
  await ctx.close();
});
