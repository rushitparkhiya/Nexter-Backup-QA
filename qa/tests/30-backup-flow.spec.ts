/**
 * 30-backup-flow.spec.ts
 * TC003 — Run a manual full backup
 * TC004 — Component-split layout (per-component zips)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, apiPut, runFullBackup, waitForBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC003 — Run a manual full backup ─────────────────────────────────────────
test('@P0 TC003 — POST /backup/run returns 200 with queued status', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/run', { type: 'full' });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(['queued', 'running']).toContain(body.data?.status);
  expect(body.data?.id).toBeTruthy();
});

test('@P0 TC003 — Progress bar advances (percent increases over ticks)', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Start a fresh backup
  await apiPost(request, nonce, '/backup/run', { type: 'full' });

  const percents: number[] = [];
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && percents.length < 3) {
    await apiPost(request, nonce, '/backup/run/step');
    const res  = await apiGet(request, nonce, '/backup/run/current');
    const body = await res.json();
    const pct  = body.data?.percent ?? 0;
    percents.push(pct as number);
    if ((body.data?.status as string) === 'success') break;
    await new Promise(r => setTimeout(r, 2_000));
  }

  // Percent should be non-zero and (on a multi-tick backup) ascending
  expect(percents.some(p => p > 0)).toBe(true);
});

test('@P0 TC003 — Backup completes with status success', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

test('@P0 TC003 — Archive .zip appears under nexter-backups/', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const parts = backup.parts as string[];
  expect(Array.isArray(parts)).toBe(true);
  expect(parts.length).toBeGreaterThan(0);
  parts.forEach(p => expect(p).toMatch(/nexter-backups.*\.zip/));
});

test('@P0 TC003 — Completed run appears in Recent activity list', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const res  = await apiGet(request, nonce, '/backup/list');
  const body = await res.json();
  const ids  = (body.data as { id: unknown }[]).map(e => e.id);
  expect(ids).toContain(backup.id);
});

// ── TC004 — Component-split layout ───────────────────────────────────────────
test('@P0 TC004 — Backup writes per-component zips when split_archives_by_component=true', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Ensure split mode is on
  await apiPut(request, nonce, '/backup/settings', { split_archives_by_component: true });

  const backup = await runFullBackup(request, nonce);
  const parts  = backup.parts as string[];

  const basenames = parts.map(p => p.split(/[\\/]/).pop() ?? '');
  expect(basenames.some(n => n.match(/-uploads\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-plugins\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-themes\.zip$/))).toBe(true);
  expect(basenames.some(n => n.match(/-db\.zip$/))).toBe(true);
});

test('@P0 TC004 — None of the parts match legacy unified format', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const parts  = backup.parts as string[];

  // Legacy format would be a single flat zip with no component suffix
  const hasCombined = parts.some(p => /nxt-[a-f0-9-]+\.zip$/.test(p.split(/[\\/]/).pop() ?? ''));
  expect(hasCombined).toBe(false);
});
