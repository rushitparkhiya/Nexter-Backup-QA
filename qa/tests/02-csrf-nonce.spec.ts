/**
 * 02-csrf-nonce.spec.ts
 * Deep QA: CSRF protection — nonce verification on every mutating endpoint.
 *
 * Each test sends a request without an X-WP-Nonce header (or with a bogus one)
 * and asserts the request is rejected (403 / rest_cookie_invalid_nonce).
 */
import { test, expect } from '@playwright/test';
import { getNonce, BASE, NS, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const MUTATING_ENDPOINTS: { path: string; method: 'POST' | 'PUT' | 'DELETE'; body?: unknown }[] = [
  { path: '/backup/run',                method: 'POST',   body: { type: 'database' } },
  { path: '/backup/run/step',           method: 'POST' },
  { path: '/backup/restore/dummy-id',   method: 'POST',   body: { components: ['db'], confirm_password: ADMIN_PASS } },
  { path: '/backup/restore/run/step',   method: 'POST' },
  { path: '/backup/dummy-id',           method: 'DELETE', body: { confirm_password: ADMIN_PASS } },
  { path: '/backup/rescan',             method: 'POST' },
  { path: '/backup/log/clear',          method: 'POST' },
  { path: '/backup/destinations',       method: 'PUT',    body: { type: 'local', label: 'X', enabled: true, config: {} } },
  { path: '/backup/destinations/dummy', method: 'DELETE', body: { confirm_password: ADMIN_PASS } },
  { path: '/backup/destinations/test/dummy', method: 'POST' },
  { path: '/backup/settings',           method: 'PUT',    body: { schedule_files_interval: 'manual' } },
  { path: '/backup/settings/import',    method: 'POST',   body: {} },
  { path: '/backup/migration/export',   method: 'POST' },
  { path: '/backup/migration/import',   method: 'POST',   body: {} },
  { path: '/backup/search-replace',     method: 'POST',   body: {} },
  { path: '/backup/clone',              method: 'POST',   body: {} },
  { path: '/backup/anonymise',          method: 'POST',   body: {} },
  { path: '/backup/importer',           method: 'POST',   body: {} },
  { path: '/backup/cron/run',           method: 'POST',   body: { hook: 'nxt_backup_cron_run' } },
  { path: '/backup/wipe',               method: 'POST',   body: { confirm_password: ADMIN_PASS } },
  { path: '/backup/audit/clear',        method: 'POST' },
  { path: '/backup/lock-admin/set',     method: 'POST',   body: {} },
  { path: '/backup/lock-admin/clear',   method: 'POST' },
  { path: '/backup/cleanup/run',        method: 'POST' },
  { path: '/backup/cleanup/orphans',    method: 'POST' },
  { path: '/backup/cleanup/temp',       method: 'POST' },
  { path: '/backup/paired',             method: 'PUT',    body: {} },
  { path: '/backup/paired/dummy',       method: 'DELETE', body: { confirm_password: ADMIN_PASS } },
  { path: '/backup/paired/code',        method: 'POST' },
  { path: '/backup/transfer',           method: 'POST',   body: {} },
  { path: '/backup/pull',               method: 'POST',   body: {} },
];

for (const { path, method, body } of MUTATING_ENDPOINTS) {
  test(`@deep CSRF-001 — ${method} ${path} without nonce returns 401/403`, async ({ request }) => {
    const fn = method === 'POST'   ? request.post.bind(request)
             : method === 'PUT'    ? request.put.bind(request)
             : request.delete.bind(request);

    const res = await fn(`${NS}${path}`, {
      // NO X-WP-Nonce header at all
      data: body ?? {},
      headers: { 'Content-Type': 'application/json' },
    });
    // WP rejects unauthenticated requests at REST level
    expect([401, 403]).toContain(res.status());
  });

  test(`@deep CSRF-002 — ${method} ${path} with bogus nonce returns 401/403`, async ({ request }) => {
    const fn = method === 'POST'   ? request.post.bind(request)
             : method === 'PUT'    ? request.put.bind(request)
             : request.delete.bind(request);

    const res = await fn(`${NS}${path}`, {
      data: body ?? {},
      headers: { 'X-WP-Nonce': 'xx-fake-nonce-xx', 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });
}

test('@deep CSRF-003 — Read-only endpoints also reject without nonce', async ({ request }) => {
  // Even GET endpoints are admin-gated
  const res = await request.get(`${NS}/backup/stats`);
  expect([401, 403]).toContain(res.status());
});
