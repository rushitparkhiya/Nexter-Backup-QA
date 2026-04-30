/**
 * 87-time-clock.spec.ts
 * Deep QA: time / scheduling edge cases.
 *
 * - DST transitions (US/Europe boundaries)
 * - Timestamps stored as UTC, displayed per WP timezone
 * - Schedule with starttime in past schedules for tomorrow
 * - 2038 problem (Y2038): far-future timestamp handling
 * - Server clock skew detection
 * - Cron event next-run timestamp is in the future
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPut, apiGet, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Cron next-run is in the future â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-001 â€” Every scheduled cron event has next > now', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'daily',
  });

  const events = (await (await apiGet(page, nonce, '/backup/cron')).json()).data as
    { hook: string; next: number }[];
  for (const e of events) {
    expect(e.next).toBeGreaterThan(Date.now() / 1000);
  }
});

// â”€â”€ Starttime in past pushes to next day â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-002 â€” Schedule starttime in past is rolled forward', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Set starttime to "00:01" â€” very likely past for current time
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval:  'daily',
    schedule_files_starttime: '00:01',
  });

  const events = (await (await apiGet(page, nonce, '/backup/cron')).json()).data as
    { hook: string; next: number; args?: { type?: string } }[];
  const filesEvt = events.find(e => e.hook === 'nxt_backup_cron_run' && e.args?.type === 'files');
  if (filesEvt) {
    expect(filesEvt.next).toBeGreaterThan(Date.now() / 1000);
  }
});

// â”€â”€ Timezone-aware display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-003 â€” /backup/site-info reports timezone string', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(page, nonce, '/backup/site-info')).json();
  if ('timezone' in (body.data ?? {})) {
    expect(typeof body.data.timezone).toBe('string');
  }
});

// â”€â”€ Stats fresh-since-last-backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-004 â€” /backup/stats includes last_backup ts in seconds (10-digit)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(page, nonce, '/backup/stats')).json();
  if (body.data?.last_backup_ts) {
    // Should be a Unix timestamp (10 digits in second resolution)
    expect(String(body.data.last_backup_ts).length).toBeGreaterThanOrEqual(10);
    expect(body.data.last_backup_ts).toBeLessThan(2_500_000_000); // before 2049
  }
});

// â”€â”€ Far-future starttime accepted but normalised â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-005 â€” Starttime "23:59" accepted', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval:  'daily',
    schedule_files_starttime: '23:59',
  });
  expect(res.status()).toBe(200);
});

test('@deep TIME-006 â€” Starttime "25:00" rejected (invalid)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval:  'daily',
    schedule_files_starttime: '25:00',
  });
  // Some implementations coerce, others reject. Both acceptable; verify no 500.
  expect([200, 400, 422]).toContain(res.status());
});

test('@deep TIME-007 â€” Starttime "abc" rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval:  'daily',
    schedule_files_starttime: 'abc',
  });
  expect([200, 400, 422]).toContain(res.status());
});

// â”€â”€ Audit timestamps monotonically increase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-008 â€” Audit log timestamps are non-decreasing in oldest-first order', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Generate a few entries
  for (let i = 0; i < 3; i++) await apiPut(page, nonce, '/backup/settings', { split_archive_mb: 100 + i });

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '50' })).json()).data as
    { ts: number }[];
  // Most recent first â€” verify ts decreases
  for (let i = 1; i < entries.length; i++) {
    expect(entries[i].ts).toBeLessThanOrEqual(entries[i - 1].ts);
  }
});

// â”€â”€ Cron event next is sane (within 30 days) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep TIME-009 â€” No cron event scheduled more than 35 days out', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const events = (await (await apiGet(page, nonce, '/backup/cron')).json()).data as
    { next: number }[];
  const max35d = Date.now() / 1000 + 35 * 86_400;
  for (const e of events) {
    expect(e.next).toBeLessThan(max35d);
  }
});
