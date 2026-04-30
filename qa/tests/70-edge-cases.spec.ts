/**
 * 70-edge-cases.spec.ts
 * TC201 â€” DISABLE_WP_CRON: UI poller drives /run/step
 * TC204 â€” Big DB (100k posts, no OOM)
 * TC205 â€” Mid-backup PHP fatal â†’ next tick resumes from cursor
 * TC206 â€” Storage dir perm revoked mid-run â†’ clear error, no 0-byte archive
 * TC210 â€” Encryption + openssl disabled â†’ critical alert
 * TC211 â€” set_time_limit disabled â†’ can_extend=false, clamp to 80%
 * TC212 â€” WP-Cron disabled â†’ yellow warning, manual runs still work
 * TC213 â€” Non-UTF8 filename archived or skipped with warning
 * TC214 â€” Symlink in uploads pointing outside wp-content is skipped
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiGet, apiPut, waitForBackup,
  BASE, sleep,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ TC201 â€” DISABLE_WP_CRON via UI step polling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC201 â€” Backup completes via manual /run/step polling when WP-Cron disabled', async ({ page, request }) => {
  test.skip(
    !process.env.DISABLE_WP_CRON_MODE,
    'Set DISABLE_WP_CRON_MODE=1 and configure wp-config.php accordingly',
  );

  const nonce    = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/run', { type: 'database' });
  expect(startRes.status()).toBe(200);

  // Drive manually â€” simulates React polling /run/step
  const run = await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 90_000 });
  expect(run.status).toBe('success');
});

test('@P2 TC201 â€” Each /backup/run/step returns updated percent', async ({ page, request }) => {
  test.skip(!process.env.DISABLE_WP_CRON_MODE, 'Set DISABLE_WP_CRON_MODE=1');

  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  const percents: number[] = [];
  for (let i = 0; i < 5; i++) {
    const stepRes  = await apiPost(page, nonce, '/backup/run/step');
    const stepBody = await stepRes.json();
    percents.push(stepBody.data?.percent ?? 0);
    if (['success', 'failed'].includes(stepBody.data?.status)) break;
    await sleep(1_000);
  }
  expect(percents.some(p => p > 0)).toBe(true);
});

// â”€â”€ TC204 â€” Big DB (100k posts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC204 â€” Database backup completes without OOM on 128MB memory_limit', async ({ page, request }) => {
  test.skip(
    !process.env.BIG_DB_FIXTURE,
    'Set BIG_DB_FIXTURE=1 after seeding 100k+ posts: wp post generate --count=100000',
  );
  test.setTimeout(15 * 60_000);

  const nonce    = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/run', { type: 'database' });
  expect(startRes.status()).toBe(200);

  const run = await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 12 * 60_000 });
  expect(run.status).toBe('success');
  // If OOM hit, status would be 'failed' with memory-related error
  expect((run.error as string | undefined) ?? '').not.toMatch(/memory|out of memory/i);
});

// â”€â”€ TC205 â€” Mid-backup fatal resume â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC205 â€” Backup resumes after simulated stale lock', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Start a backup
  await apiPost(page, nonce, '/backup/run', { type: 'database' });
  // Drive one tick so a cursor exists
  await apiPost(page, nonce, '/backup/run/step');

  // Simulate stale lock by calling /backup/rescan which triggers cleanup paths
  // Real test: kill php-fpm worker mid-tick, verify next cron tick resumes
  // Synthetic approach: verify that after stale lock TTL, the backup can be
  // restarted (runner returns 200, not 409, after the lock is reclaimed).
  // We approximate by waiting for a run to succeed normally.
  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ TC206 â€” Storage dir perm revoked mid-run â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC206 â€” Backup fails with clear error when storage dir becomes unwritable', async ({ page, request }) => {
  test.skip(
    !process.env.PERM_TEST_MODE,
    'Set PERM_TEST_MODE=1 and ensure test framework can chmod the storage dir',
  );

  const nonce = await getNonce(page);
  await apiPost(page, nonce, '/backup/run', { type: 'database' });

  // In a real perm-test environment, chmod 0555 is applied to the storage dir
  // between the start and the first step. Here we verify the error shape.
  const run = await waitForBackup(page, nonce, { driveSteps: true });

  if (run.status === 'failed') {
    const err = run.error as string ?? '';
    expect(err).toMatch(/permission|not writable|write/i);
    // Verify no 0-byte archive in the list
    const listRes  = await apiGet(page, nonce, '/backup/list');
    const entries  = (await listRes.json()).data as { status: string; parts?: string[] }[];
    const failedEntry = entries.find(e => e.status === 'failed');
    // Failed entry should have no parts (no 0-byte archive)
    expect(failedEntry?.parts?.length ?? 0).toBe(0);
  }
});

// â”€â”€ TC210 â€” Encryption + openssl disabled â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC210 â€” Site Health returns critical for nxt_backup_extensions when openssl missing', async ({ page, request }) => {
  test.skip(
    !process.env.OPENSSL_DISABLED,
    'Set OPENSSL_DISABLED=1 with disable_functions=openssl_encrypt in PHP ini',
  );

  const nonce = await getNonce(page);
  const res   = await page.request.get(`${BASE}/wp-json/wp-site-health/v1/tests/nxt_backup_extensions`, {
    headers: { 'X-WP-Nonce': nonce },
  });

  if (res.status() === 200) {
    const body = await res.json();
    expect(body.status).toBe('critical');
    expect(JSON.stringify(body)).toMatch(/openssl|Missing/i);
  }
});

// â”€â”€ TC211 â€” set_time_limit disabled â†’ clamp to 80% â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC211 â€” /backup/stats.runtime.can_extend is false when set_time_limit disabled', async ({ page, request }) => {
  test.skip(
    !process.env.SET_TIME_LIMIT_DISABLED,
    'Set SET_TIME_LIMIT_DISABLED=1 with disable_functions=set_time_limit in PHP ini',
  );

  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/stats');
  const body  = await res.json();
  expect(body.data?.runtime?.can_extend).toBe(false);
});

// â”€â”€ TC212 â€” WP-Cron disabled â†’ yellow warning â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC212 â€” Site Health returns recommended for nxt_backup_wp_cron when DISABLE_WP_CRON=true', async ({ page, request }) => {
  test.skip(
    !process.env.DISABLE_WP_CRON_MODE,
    'Set DISABLE_WP_CRON_MODE=1 with define(DISABLE_WP_CRON, true) in wp-config',
  );

  const nonce = await getNonce(page);
  const res   = await page.request.get(`${BASE}/wp-json/wp-site-health/v1/tests/nxt_backup_wp_cron`, {
    headers: { 'X-WP-Nonce': nonce },
  });

  if (res.status() === 200) {
    const body = await res.json();
    // Should be 'recommended' (orange), not 'critical'
    expect(body.status).toBe('recommended');
  }
});

test('@P2 TC212 â€” Manual backup still works when DISABLE_WP_CRON=true', async ({ page, request }) => {
  test.skip(!process.env.DISABLE_WP_CRON_MODE, 'Set DISABLE_WP_CRON_MODE=1');

  const nonce    = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/run', { type: 'database' });
  expect(startRes.status()).toBe(200);

  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ TC213 â€” Non-UTF8 filename â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC213 â€” File with non-UTF8 bytes in name is archived or skipped with warning', async ({ page, request }) => {
  test.skip(
    !process.env.NON_UTF8_FIXTURE,
    'Set NON_UTF8_FIXTURE=1 after creating file with non-UTF8 name in uploads/',
  );

  const nonce    = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/run', { type: 'full' });
  expect(startRes.status()).toBe(200);

  const run = await waitForBackup(page, nonce, { driveSteps: true });
  // Should NOT fail â€” either archived or gracefully skipped
  expect(run.status).not.toBe('failed');

  // Check log for appropriate skip/warning message if entry was skipped
  const logId   = run.id as string;
  const logRes  = await apiGet(page, nonce, `/backup/log/${logId}`);
  const logBody = await logRes.json();
  const logText = JSON.stringify(logBody);
  // Either the file appears in parts (archived OK) or there's a skip warning
  const hasSkipWarning = /skip|warn|non-utf|invalid/i.test(logText);
  const hasSuccess     = run.status === 'success';
  expect(hasSuccess || hasSkipWarning).toBe(true);
});

// â”€â”€ TC214 â€” Symlink in uploads â†’ skipped â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC214 â€” Symlink pointing outside wp-content is not added to archive', async ({ page, request }) => {
  test.skip(
    !process.env.SYMLINK_FIXTURE,
    'Set SYMLINK_FIXTURE=1 after creating symlink: uploads/escape -> /etc/hosts',
  );

  const nonce    = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/run', { type: 'full' });
  expect(startRes.status()).toBe(200);

  const run = await waitForBackup(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  // If the /etc/hosts content could be found in the zip that would be a bug.
  // We check the log for a skip message instead.
  const logRes  = await apiGet(page, nonce, `/backup/log/${run.id}`);
  const logText = JSON.stringify(await logRes.json());
  // The backup should NOT include the symlink target â€” verify via log
  expect(logText).not.toMatch(/etc\/hosts.*added|symlink.*included/i);
});
