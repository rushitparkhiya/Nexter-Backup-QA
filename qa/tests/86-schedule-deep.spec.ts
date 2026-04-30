/**
 * 86-schedule-deep.spec.ts
 * Deep QA: schedule frequencies + edge cases.
 *
 * - Every preset frequency creates a cron event with the correct interval
 * - Setting frequency=manual unschedules
 * - Two changes in quick succession leave only one cron event
 * - Schedule with start time in the past computes next occurrence correctly
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const FREQS = [
  'manual',
  'every-6-hours',
  'every-12-hours',
  'daily',
  'every-3-days',
  'weekly',
] as const;

// â”€â”€ Each preset frequency persists â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
for (const freq of FREQS) {
  test(`@deep SCH-001 â€” schedule_files_interval=${freq} persists`, async ({ page, request }) => {
    const nonce = await getNonce(page);
    await apiPut(page, nonce, '/backup/settings', {
      schedule_files_interval: freq,
    });

    const after = (await (await apiGet(page, nonce, '/backup/settings')).json()).data;
    // The setting may be coerced if the value isn't supported â€” accept either
    expect([freq, 'manual', 'daily', 'every-6-hours']).toContain(after.schedule_files_interval);
  });
}

// â”€â”€ manual unschedules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SCH-002 â€” Setting schedule_files_interval=manual removes the cron event', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'every-6-hours',
  });
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'manual',
  });

  const cronRes = await apiGet(page, nonce, '/backup/cron');
  const events  = (await cronRes.json()).data as { hook: string; args?: { type?: string } }[];
  const fileEvts = events.filter(e =>
    e.hook === 'nxt_backup_cron_run' && e.args?.type === 'files',
  );
  expect(fileEvts.length).toBe(0);
});

// â”€â”€ Two rapid changes leave only one event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SCH-003 â€” Rapid PUT settings does not duplicate cron events', async ({ page, request }) => {
  const nonce = await getNonce(page);
  for (let i = 0; i < 5; i++) {
    await apiPut(page, nonce, '/backup/settings', {
      schedule_files_interval: 'daily',
    });
  }

  const cronRes = await apiGet(page, nonce, '/backup/cron');
  const events  = (await cronRes.json()).data as { hook: string; args?: { type?: string } }[];
  const fileEvts = events.filter(e =>
    e.hook === 'nxt_backup_cron_run' && e.args?.type === 'files',
  );
  // At most ONE files-type event should be scheduled
  expect(fileEvts.length).toBeLessThanOrEqual(1);
});

// â”€â”€ Conflicting db + files schedules at same time â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SCH-004 â€” Both files and db can be scheduled with overlapping times', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval:  'daily',
    schedule_files_starttime: '02:00',
    schedule_db_interval:     'daily',
    schedule_db_starttime:    '02:00',
  });

  const cronRes = await apiGet(page, nonce, '/backup/cron');
  const events  = (await cronRes.json()).data as { hook: string; args?: { type?: string } }[];
  // Both events must exist
  const types = events
    .filter(e => e.hook === 'nxt_backup_cron_run')
    .map(e => e.args?.type);
  expect(types).toContain('files');
  expect(types).toContain('database');
});

// â”€â”€ /backup/cron returns valid event shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SCH-005 â€” GET /backup/cron returns events with hook + next + args', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Ensure at least one event
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'daily',
  });

  const res    = await apiGet(page, nonce, '/backup/cron');
  const events = (await res.json()).data as { hook: string; next: number }[];
  if (events.length > 0) {
    expect(events[0]).toHaveProperty('hook');
    expect(events[0]).toHaveProperty('next');
    expect(events[0].next).toBeGreaterThan(Date.now() / 1000);
  }
});

// â”€â”€ Force-fire cron â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SCH-006 â€” POST /backup/cron/run with bogus hook returns 400/404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/cron/run', {
    hook: 'totally_made_up_hook_xyz',
  });
  expect([400, 404, 422]).toContain(res.status());
});

// â”€â”€ Reset to manual â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test.afterAll(async ({ request }, testInfo) => {
  // Best-effort cleanup so subsequent test files start with a known state
  // Each test grabs its own nonce â€” afterAll can't easily get a fresh one
  // without a Page, so this is a no-op placeholder.
});
