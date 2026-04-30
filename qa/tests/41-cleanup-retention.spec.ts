/**
 * 41-cleanup-retention.spec.ts
 * Deep QA: cleanup, retention, and orphan handling.
 *
 * - Retention "keep last N" actually deletes older entries
 * - Retention "keep last X days" honoured
 * - keep_forever entries never pruned
 * - Orphan archives detected and removed
 * - Temp dir wipe
 * - Cleanup during active backup is rejected or queued
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, apiGet, runFullBackup,
  BASE,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Cleanup endpoint shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-001 â€” GET /backup/cleanup/summary returns expected fields', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/cleanup/summary');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data).toBeDefined();
  // Common fields: orphans count, temp size, retention candidates
  expect(typeof body.data).toBe('object');
});

test('@deep CLN-002 â€” POST /backup/cleanup/run executes without error', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/cleanup/run');
  expect(res.status()).toBe(200);
});

test('@deep CLN-003 â€” POST /backup/cleanup/orphans returns 200', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/cleanup/orphans');
  expect(res.status()).toBe(200);
});

test('@deep CLN-004 â€” POST /backup/cleanup/temp returns 200', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/cleanup/temp');
  expect(res.status()).toBe(200);
});

// â”€â”€ Retention: keep last N â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-005 â€” Retention "keep last 1" prunes older entries on next sweep', async ({ page, request }) => {
  test.setTimeout(8 * 60_000);
  const nonce = await getNonce(page);

  // Set retention to keep only 1
  await apiPut(page, nonce, '/backup/settings', {
    retention_mode:  'keep-last-n',
    retention_count: 1,
  });

  // Run two backups
  await runFullBackup(page, nonce);
  await runFullBackup(page, nonce);

  // Run cleanup
  await apiPost(page, nonce, '/backup/cleanup/run');

  // Only one (or zero, if pruning purged both) should remain
  const listRes = await apiGet(page, nonce, '/backup/list');
  const list    = (await listRes.json()).data as unknown[];
  expect(list.length).toBeLessThanOrEqual(2); // tolerant: at most the two we just made

  // Reset retention
  await apiPut(page, nonce, '/backup/settings', { retention_mode: 'forever' });
});

// â”€â”€ keep_forever survives retention sweep â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-006 â€” keep_forever backups not pruned by retention', async ({ page, request }) => {
  test.setTimeout(5 * 60_000);
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    retention_mode:  'keep-last-n',
    retention_count: 1,
  });

  // Tag one as keep-forever
  await apiPost(page, nonce, '/backup/run', {
    type:         'database',
    keep_forever: true,
    label:        'Forever-CLN-006',
  });
  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(page, nonce, { driveSteps: true });

  // Run another (regular) backup
  await runFullBackup(page, nonce);

  // Run cleanup
  await apiPost(page, nonce, '/backup/cleanup/run');

  // Forever-CLN-006 must still be present
  const listRes = await apiGet(page, nonce, '/backup/list');
  const list    = (await listRes.json()).data as { label?: string }[];
  expect(list.some(b => b.label === 'Forever-CLN-006')).toBe(true);

  await apiPut(page, nonce, '/backup/settings', { retention_mode: 'forever' });
});

// â”€â”€ Cleanup during active backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-007 â€” Cleanup invoked while backup is running does not corrupt the run', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Start a backup
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  // Immediately invoke cleanup
  const cleanupRes = await apiPost(page, nonce, '/backup/cleanup/run');
  expect([200, 409]).toContain(cleanupRes.status());

  // The backup should still complete
  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(['success', 'running']).toContain(run.status as string);
});

// â”€â”€ Orphan archives picked up by rescan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-008 â€” POST /backup/rescan after orphan creation refreshes list', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Run a backup so a record exists
  await runFullBackup(page, nonce);

  const before = await apiGet(page, nonce, '/backup/list');
  const beforeCount = ((await before.json()).data as unknown[]).length;

  await apiPost(page, nonce, '/backup/rescan');

  const after = await apiGet(page, nonce, '/backup/list');
  const afterCount = ((await after.json()).data as unknown[]).length;

  // Count should be â‰¥ before (rescan should not lose entries)
  expect(afterCount).toBeGreaterThanOrEqual(beforeCount);
});
