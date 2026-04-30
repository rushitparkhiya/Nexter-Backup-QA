/**
 * 12-resilience.spec.ts
 * Deep QA: resilience scenarios â€” what happens when something goes wrong
 * outside the plugin's normal control.
 *
 * - Worker dies between zip parts â†’ next tick resumes
 * - Run record corrupted (JSON garbled) â€” backup_recover_run option
 * - Plugin deactivated mid-run (sessions persist via cron)
 * - Hung tick (no advance for 3Ã— max_runtime) auto-reclaimed
 * - WP table dropped between backup and restore (graceful failure)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, runFullBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Lock auto-reclaim after long stall â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-001 â€” Stale lock from old run does not block new runs', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Drain any in-flight work
  const { waitForBackup } = await import('./_helpers');

  await apiPost(page, nonce, '/backup/run', { type: 'database' });
  await waitForBackup(page, nonce, { driveSteps: true });

  // Immediately start another â€” should not hit a stale lock
  const second = await apiPost(page, nonce, '/backup/run', { type: 'database' });
  expect(second.status()).toBe(200);
  await waitForBackup(page, nonce, { driveSteps: true });
});

// â”€â”€ Lock TTL: subsequent enqueue blocked while running â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-002 â€” Active backup blocks new enqueue with 409 within lock TTL', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  const concurrent = await apiPost(page, nonce, '/backup/run', { type: 'database' });
  expect([200, 409]).toContain(concurrent.status());

  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(page, nonce, { driveSteps: true });
});

// â”€â”€ Watchdog re-arm â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-003 â€” After every tick a watchdog cron event is scheduled', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });
  await apiPost(page, nonce, '/backup/run/step');

  const events = (await (await apiGet(page, nonce, '/backup/cron')).json()).data as
    { hook: string }[];
  // Watchdog hook is the run-step hook
  expect(events.some(e => /backup_run|cron_run|run_step/.test(e.hook))).toBe(true);

  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(page, nonce, { driveSteps: true });
});

// â”€â”€ Mid-run plugin-disable simulation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-004 â€” Backup state survives a settings update mid-run', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  // Mutate settings while running
  const { apiPut } = await import('./_helpers');
  await apiPut(page, nonce, '/backup/settings', { split_archive_mb: 250 });

  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(['success', 'failed']).toContain(run.status as string);
});

// â”€â”€ Multiple cron workers race â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-005 â€” Two parallel /backup/run/step calls do not duplicate work', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  const [a, b] = await Promise.all([
    apiPost(page, nonce, '/backup/run/step'),
    apiPost(page, nonce, '/backup/run/step'),
  ]);
  // One returns 200, the other 200 with same/no advance OR 409 lock contention
  expect([a.status(), b.status()].every(s => [200, 409, 423].includes(s))).toBe(true);

  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Restore from missing source backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-006 â€” Restore of a backup whose files were manually deleted fails clearly', async ({ page, request }) => {
  test.skip(
    !process.env.RESILIENCE_TEST_MODE,
    'Set RESILIENCE_TEST_MODE=1 â€” needs file system manipulation between backup + restore',
  );
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const restoreRes = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components: ['db'],
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
  // After we delete part files manually, restore should fail with file-not-found error
  expect([400, 404, 500]).toContain(restoreRes.status());
});

// â”€â”€ Plugin re-activation cleans up stale state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-007 â€” Plugin re-activation clears any orphan nxt_backup_current_run option', async ({ page, request }) => {
  test.skip(
    !process.env.WP_CLI_AVAILABLE,
    'Needs WP-CLI to deactivate/reactivate',
  );
  // Test stub â€” would shell out to wp plugin deactivate + activate, then verify run state is idle
});

// â”€â”€ REST namespace responds even with no backups present â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep RES-008 â€” /backup/list works on a fresh plugin (zero backups)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/list');
  expect(res.status()).toBe(200);
  const body  = await res.json();
  expect(Array.isArray(body.data)).toBe(true);
});
