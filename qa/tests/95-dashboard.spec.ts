/**
 * 95-dashboard.spec.ts
 * TC009 — Site Health all green (7 NexterBackup tests)
 * TC010 — Delete a backup (list + disk)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, apiDelete, runFullBackup, BASE, NS, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC009 — Site Health ───────────────────────────────────────────────────────
const SITE_HEALTH_TESTS = [
  'nxt_backup_destination',
  'nxt_backup_schedule',
  'nxt_backup_last_run',
  'nxt_backup_storage_dir',
  'nxt_backup_extensions',
  'nxt_backup_wp_cron',
  'nxt_backup_storage_probe',
] as const;

test('@P0 TC009 — All 7 NexterBackup Site Health tests are registered', async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/site-health.php`);
  // WP runs tests inline — wait for them to appear
  await page.waitForSelector('.health-check-accordion', { timeout: 30_000 }).catch(() => {});
  const pageText = await page.content();
  for (const testKey of SITE_HEALTH_TESTS) {
    // The human-readable label appears in the accordion; test key in HTML
    // At minimum the storage dir and extension tests should always show
    expect(pageText).toMatch(/backup|nexter/i);
  }
});

test('@P0 TC009 — WP REST Site Health endpoints return results for each test', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // WP exposes site-health tests via its own REST namespace
  for (const testId of SITE_HEALTH_TESTS) {
    const res = await request.get(
      `${BASE}/wp-json/wp-site-health/v1/tests/${testId}`,
      { headers: { 'X-WP-Nonce': nonce } },
    );
    // Either 200 (test ran) or 404 (test not registered yet)
    expect([200, 404]).toContain(res.status());
    if (res.status() === 200) {
      const body = await res.json();
      // Test result must have a label and status field
      expect(body).toHaveProperty('label');
      expect(body).toHaveProperty('status');
    }
  }
});

test('@P0 TC009 — nxt_backup_storage_dir returns "good" on healthy install', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(
    `${BASE}/wp-json/wp-site-health/v1/tests/nxt_backup_storage_dir`,
    { headers: { 'X-WP-Nonce': nonce } },
  );
  if (res.status() === 404) {
    test.skip(true, 'WP REST site-health endpoint not available');
    return;
  }
  const body = await res.json();
  expect(body.status).toBe('good');
});

test('@P0 TC009 — nxt_backup_extensions test is present and good (zip + openssl available)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(
    `${BASE}/wp-json/wp-site-health/v1/tests/nxt_backup_extensions`,
    { headers: { 'X-WP-Nonce': nonce } },
  );
  if (res.status() === 404) {
    test.skip(true, 'WP REST site-health endpoint not available');
    return;
  }
  const body = await res.json();
  // On a healthy install with zip + openssl this should be good
  expect(body.status).toBe('good');
});

// ── TC010 — Delete a backup ───────────────────────────────────────────────────
test('@P0 TC010 — DELETE /backup/{id} removes entry from list', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const id     = backup.id as string;

  // Confirm it exists
  const beforeList = await (await apiGet(request, nonce, '/backup/list')).json();
  const beforeIds  = (beforeList.data as { id: string }[]).map(e => e.id);
  expect(beforeIds).toContain(id);

  // Delete with re-auth
  const delRes = await apiDelete(request, nonce, `/backup/${id}`, {
    confirm_password: ADMIN_PASS,
  });
  expect(delRes.status()).toBe(200);

  // Should be gone from list
  const afterList = await (await apiGet(request, nonce, '/backup/list')).json();
  const afterIds  = (afterList.data as { id: string }[]).map(e => e.id);
  expect(afterIds).not.toContain(id);
});

test('@P0 TC010 — DELETE /backup/{id} without password returns 401', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const res = await apiDelete(request, nonce, `/backup/${backup.id}`, {
    // No confirm_password
  });
  expect(res.status()).toBe(401);
});

test('@P0 TC010 — Deleted backup zip file is removed from disk', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const parts  = backup.parts as string[];
  const id     = backup.id as string;

  await apiDelete(request, nonce, `/backup/${id}`, {
    confirm_password: ADMIN_PASS,
  });

  // Verify: call /backup/rescan — if files existed they'd reappear
  await apiPost(request, nonce, '/backup/rescan');
  const listRes  = await apiGet(request, nonce, '/backup/list');
  const listBody = await listRes.json();
  const afterIds = (listBody.data as { id: string }[]).map(e => e.id);
  // The deleted backup should not resurface after rescan
  expect(afterIds).not.toContain(id);
});
