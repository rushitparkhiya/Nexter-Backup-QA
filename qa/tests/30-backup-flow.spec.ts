/**
 * 30-backup-flow.spec.ts
 * TC003 â€” Run a manual full backup
 * TC004 â€” Component-split layout (per-component zips)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, apiPut, runFullBackup, waitForBackup, BASE } from './_helpers';

// Backup flow tests involve full backup runs which can take several minutes
test.setTimeout(300_000);

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ TC003 â€” Run a manual full backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P0 TC003 â€” POST /backup/run returns 200 with queued status', async ({ page, request }) => {
  const nonce = await getNonce(page);
  let res = await apiPost(page, nonce, '/backup/run', { type: 'full' });

  // If a previous backup is still running (e.g., stale state), drive it to
  // completion then try again so this test still verifies the 200 path.
  if (res.status() === 409) {
    await waitForBackup(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
    res = await apiPost(page, nonce, '/backup/run', { type: 'full' });
  }

  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(['queued', 'running']).toContain(body.data?.status);
  expect(body.data?.id).toBeTruthy();
});

test('@P0 TC003 â€” Progress bar advances (percent increases over ticks)', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // If a fresh backup is not already running, start one
  await apiPost(page, nonce, '/backup/run', { type: 'full' });

  // Drive steps and collect percent readings; allow up to 4 minutes so that
  // even a slow first archive chunk (which may take 60-90 s) is counted.
  const percents: number[] = [];
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    await apiPost(page, nonce, '/backup/run/step');
    const res  = await apiGet(page, nonce, '/backup/run/current');
    const body = await res.json();
    const pct  = body.data?.percent as number ?? 0;
    percents.push(pct);
    const status = body.data?.status as string;
    if (status === 'success' || status === 'failed') break;
    // Once we have seen progress > 0 we have confirmed the bar advances
    if (percents.some(p => p > 0)) break;
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Percent should be non-zero at some point during the backup
  expect(percents.some(p => p > 0)).toBe(true);
});

test('@P0 TC003 â€” Backup completes with status success', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

test('@P0 TC003 â€” Archive .zip appears under nexter-backups/', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const parts = backup.parts as string[];
  expect(Array.isArray(parts)).toBe(true);
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach(p => expect(p).toMatch(/nexter-backups.*\.zip/));
});

test('@P0 TC003 â€” Completed run appears in Recent activity list', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const res  = await apiGet(page, nonce, '/backup/list');
  const body = await res.json();
  const ids  = (body.data as { id: unknown }[]).map(e => e.id);
  expect(ids).toContain(backup.id);
});

// â”€â”€ TC004 â€” Component-split layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P0 TC004 â€” Backup writes per-component zips when split_archives_by_component=true', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Ensure split mode is on
  await apiPut(page, nonce, '/backup/settings', { split_archives_by_component: true });

  const backup = await runFullBackup(page, nonce);
  const parts  = backup.parts as string[];

  const basenames = parts.map(p => p.split(/[\\/]/).pop() ?? '');
  expect(basenames.some(n => n.match(/-uploads\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-plugins\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-themes\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-db\.zip$/))).toBe(true);
});

test('@P0 TC004 â€” None of the parts match legacy unified format', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  const parts  = backup.parts as string[];

  // Legacy format would be a single flat zip with no component suffix
  const hasCombined = parts.some(p => /nxt-[a-f0-9-]+\.zip$/.test(p.split(/[\\/]/).pop() ?? ''));
  expect(hasCombined).toBe(false);
});
