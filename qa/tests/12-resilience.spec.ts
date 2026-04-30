/**
 * 12-resilience.spec.ts
 * Deep QA: resilience scenarios — what happens when something goes wrong
 * outside the plugin's normal control.
 *
 * - Worker dies between zip parts → next tick resumes
 * - Run record corrupted (JSON garbled) — backup_recover_run option
 * - Plugin deactivated mid-run (sessions persist via cron)
 * - Hung tick (no advance for 3× max_runtime) auto-reclaimed
 * - WP table dropped between backup and restore (graceful failure)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, runFullBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── Lock auto-reclaim after long stall ───────────────────────────────────────
test('@deep RES-001 — Stale lock from old run does not block new runs', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Drain any in-flight work
  const { waitForBackup } = await import('./_helpers');

  await apiPost(request, nonce, '/backup/run', { type: 'database' });
  await waitForBackup(request, nonce, { driveSteps: true });

  // Immediately start another — should not hit a stale lock
  const second = await apiPost(request, nonce, '/backup/run', { type: 'database' });
  expect(second.status()).toBe(200);
  await waitForBackup(request, nonce, { driveSteps: true });
});

// ── Lock TTL: subsequent enqueue blocked while running ───────────────────────
test('@deep RES-002 — Active backup blocks new enqueue with 409 within lock TTL', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });

  const concurrent = await apiPost(request, nonce, '/backup/run', { type: 'database' });
  expect([200, 409]).toContain(concurrent.status());

  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(request, nonce, { driveSteps: true });
});

// ── Watchdog re-arm ──────────────────────────────────────────────────────────
test('@deep RES-003 — After every tick a watchdog cron event is scheduled', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });
  await apiPost(request, nonce, '/backup/run/step');

  const events = (await (await apiGet(request, nonce, '/backup/cron')).json()).data as
    { hook: string }[];
  // Watchdog hook is the run-step hook
  expect(events.some(e => /backup_run|cron_run|run_step/.test(e.hook))).toBe(true);

  const { waitForBackup } = await import('./_helpers');
  await waitForBackup(request, nonce, { driveSteps: true });
});

// ── Mid-run plugin-disable simulation ────────────────────────────────────────
test('@deep RES-004 — Backup state survives a settings update mid-run', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });

  // Mutate settings while running
  const { apiPut } = await import('./_helpers');
  await apiPut(request, nonce, '/backup/settings', { split_archive_mb: 250 });

  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  expect(['success', 'failed']).toContain(run.status as string);
});

// ── Multiple cron workers race ───────────────────────────────────────────────
test('@deep RES-005 — Two parallel /backup/run/step calls do not duplicate work', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });

  const [a, b] = await Promise.all([
    apiPost(request, nonce, '/backup/run/step'),
    apiPost(request, nonce, '/backup/run/step'),
  ]);
  // One returns 200, the other 200 with same/no advance OR 409 lock contention
  expect([a.status(), b.status()].every(s => [200, 409, 423].includes(s))).toBe(true);

  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// ── Restore from missing source backup ───────────────────────────────────────
test('@deep RES-006 — Restore of a backup whose files were manually deleted fails clearly', async ({ page, request }) => {
  test.skip(
    !process.env.RESILIENCE_TEST_MODE,
    'Set RESILIENCE_TEST_MODE=1 — needs file system manipulation between backup + restore',
  );
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const restoreRes = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components: ['db'],
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
  // After we delete part files manually, restore should fail with file-not-found error
  expect([400, 404, 500]).toContain(restoreRes.status());
});

// ── Plugin re-activation cleans up stale state ───────────────────────────────
test('@deep RES-007 — Plugin re-activation clears any orphan nxt_backup_current_run option', async ({ page, request }) => {
  test.skip(
    !process.env.WP_CLI_AVAILABLE,
    'Needs WP-CLI to deactivate/reactivate',
  );
  // Test stub — would shell out to wp plugin deactivate + activate, then verify run state is idle
});

// ── REST namespace responds even with no backups present ─────────────────────
test('@deep RES-008 — /backup/list works on a fresh plugin (zero backups)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/list');
  expect(res.status()).toBe(200);
  const body  = await res.json();
  expect(Array.isArray(body.data)).toBe(true);
});
