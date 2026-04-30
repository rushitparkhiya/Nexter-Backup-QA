/**
 * 85-schedule-settings.spec.ts
 * TC109 — Schedule: every 6 hours (settings persist + next-run timestamp)
 * TC110 — Schedule fires automatically (manual trigger via /backup/cron/run)
 * TC307 — Settings export/import round-trip
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPut, apiGet, apiPost, waitForBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC109 — Schedule: every 6 hours ──────────────────────────────────────────
test('@P1 TC109 — PUT /backup/settings with schedule_files_interval=every-6-hours returns 200', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval:  'every-6-hours',
    schedule_files_starttime: '02:00',
  });
  expect(res.status()).toBe(200);
});

test('@P1 TC109 — Next-run timestamp exists after saving 6-hour schedule', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval:  'every-6-hours',
    schedule_files_starttime: '02:00',
  });

  const res  = await apiGet(request, nonce, '/backup/cron');
  const body = await res.json();
  const events = (body.data ?? []) as { hook: string; next: number }[];
  const filesEvent = events.find(e => e.hook === 'nxt_backup_cron_run');
  expect(filesEvent).toBeDefined();
  expect(filesEvent!.next).toBeGreaterThan(Date.now() / 1000);
});

test('@P1 TC109 — Schedule settings persist across page reload', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval:  'every-6-hours',
    schedule_db_interval:     'every-3-days',
  });

  // Re-fetch settings
  const res  = await apiGet(request, nonce, '/backup/settings');
  const body = await res.json();
  expect(body.data?.schedule_files_interval).toBe('every-6-hours');
  expect(body.data?.schedule_db_interval).toBe('every-3-days');
});

// ── TC110 — Schedule fires automatically ─────────────────────────────────────
test('@P1 TC110 — POST /backup/cron/run triggers a backup and it completes', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Ensure a schedule is active so cron dispatch has something to do
  await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval: 'every-6-hours',
  });

  const res = await apiPost(request, nonce, '/backup/cron/run', {
    hook: 'nxt_backup_cron_run',
  });
  expect(res.status()).toBe(200);

  // Drive to completion
  const run = await waitForBackup(request, nonce, { driveSteps: true, timeoutMs: 90_000 });
  expect(run.status).toBe('success');
});

// ── TC307 — Settings export/import round-trip ─────────────────────────────────
test('@P3 TC307 — GET /backup/settings/export then POST /backup/settings/import restores settings', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Set known non-default values
  await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval: 'every-6-hours',
    split_archives_by_component: true,
    split_archive_mb: 200,
  });

  // Export
  const exportRes  = await apiGet(request, nonce, '/backup/settings/export');
  expect(exportRes.status()).toBe(200);
  const exported = await exportRes.json();

  // Reset to defaults by setting opposite values
  await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval: 'manual',
    split_archives_by_component: false,
    split_archive_mb: 500,
  });

  // Import
  const importRes = await request.post(`${page.url().replace(/wp-admin.*/, '')}wp-json/nxt-backup/v1/backup/settings/import`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    exported,
  });
  expect(importRes.status()).toBe(200);

  // Verify restored
  const afterRes  = await apiGet(request, nonce, '/backup/settings');
  const afterBody = await afterRes.json();
  expect(afterBody.data?.schedule_files_interval).toBe('every-6-hours');
  expect(afterBody.data?.split_archives_by_component).toBe(true);
  expect(afterBody.data?.split_archive_mb).toBe(200);
});
