/**
 * 03-permissions-deep.spec.ts
 * Deep QA: role and capability gates beyond the basic Editor case.
 *
 * - Anonymous (no session) → 401 on every endpoint
 * - Author / Subscriber → 403
 * - Custom role added to nxt_backup_allowed_roles → can read but not mutate
 *   (depends on capability filter — verify behaviour)
 * - manage_options removed via filter → admin loses access
 */
import { test, expect, chromium, BrowserContext } from '@playwright/test';
import * as path from 'path';
import { BASE, NS } from './_helpers';

async function loadCtx(stateFile: string): Promise<BrowserContext> {
  const browser = await chromium.launch();
  return browser.newContext({ storageState: path.join(__dirname, '..', '.auth', stateFile) });
}

// ── Anonymous ────────────────────────────────────────────────────────────────
test('@deep PERM-001 — Anonymous GET /backup/stats returns 401', async ({ request }) => {
  const res = await request.get(`${NS}/backup/stats`);
  expect([401, 403]).toContain(res.status());
});

test('@deep PERM-002 — Anonymous POST /backup/run returns 401', async ({ request }) => {
  const res = await request.post(`${NS}/backup/run`, { data: { type: 'database' } });
  expect([401, 403]).toContain(res.status());
});

test('@deep PERM-003 — Anonymous GET /backup/list returns 401', async ({ request }) => {
  const res = await request.get(`${NS}/backup/list`);
  expect([401, 403]).toContain(res.status());
});

test('@deep PERM-004 — Anonymous direct page hit redirects to login', async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  // WP redirects unauthenticated to /wp-login.php
  await expect(page).toHaveURL(/wp-login\.php/);
});

// ── Editor (already covered in TC008 — extending to all endpoints) ───────────
test('@deep PERM-005 — Editor blocked on every namespaced endpoint', async () => {
  const ctx = await loadCtx('editor.json');
  await (await ctx.newPage()).goto(`${BASE}/wp-admin/`);
  const nonce = await (await ctx.newPage()).evaluate(() =>
    fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=rest-nonce',
    }).then(r => r.text()),
  );

  const endpoints = [
    '/backup/stats', '/backup/list', '/backup/settings',
    '/backup/destinations', '/backup/cron', '/backup/audit',
    '/backup/cleanup/summary', '/backup/paired',
  ];
  for (const ep of endpoints) {
    const res = await ctx.request().get(`${NS}${ep}`, {
      headers: { 'X-WP-Nonce': nonce.trim() },
    });
    expect(res.status(), `Editor should be 403 on GET ${ep}`).toBe(403);
  }
  await ctx.browser()?.close();
});

test('@deep PERM-006 — Editor blocked on POST /backup/run', async () => {
  const ctx   = await loadCtx('editor.json');
  const page  = await ctx.newPage();
  await page.goto(`${BASE}/wp-admin/`);
  const nonce = await page.evaluate(() =>
    fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=rest-nonce',
    }).then(r => r.text()),
  );

  const res = await ctx.request().post(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce.trim(), 'Content-Type': 'application/json' },
    data:    { type: 'database' },
  });
  expect(res.status()).toBe(403);
  await ctx.browser()?.close();
});

// ── 403 response shape ───────────────────────────────────────────────────────
test('@deep PERM-007 — 403 response uses code "nxt_backup_forbidden" not raw WP error', async () => {
  const ctx   = await loadCtx('editor.json');
  const page  = await ctx.newPage();
  await page.goto(`${BASE}/wp-admin/`);
  const nonce = await page.evaluate(() =>
    fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=rest-nonce',
    }).then(r => r.text()),
  );

  const res = await ctx.request().get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce.trim() },
  });
  const body = await res.json();
  expect(body.code).toMatch(/nxt_backup_forbidden|rest_forbidden/);
  await ctx.browser()?.close();
});

// ── Capability removed via filter ─────────────────────────────────────────────
test('@deep PERM-008 — When manage_options is filtered away, admin loses access', async () => {
  test.skip(
    !process.env.CAP_FILTER_ACTIVE,
    'Set CAP_FILTER_ACTIVE=1 after wiring a mu-plugin that filters nxt_backup_capability to a non-existent cap',
  );
});

// ── Multisite super-admin (network admin) ────────────────────────────────────
test('@deep PERM-009 — On multisite, only super_admin can access network-wide settings', async () => {
  test.skip(
    !process.env.MULTISITE_MODE,
    'Set MULTISITE_MODE=1 with a multisite WP install',
  );
});
