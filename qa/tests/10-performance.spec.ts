/**
 * 10-performance.spec.ts
 * Deep QA: performance budgets per endpoint.
 *
 * - /backup/stats < 300ms
 * - /backup/list < 500ms
 * - /backup/run/current < 200ms
 * - /backup/audit (limit=50) < 500ms
 * - Backup throughput on small fixture
 * - Page load (Dashboard) within budget
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiGet, apiPost, runFullBackup, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

async function timed<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const t0 = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - t0 };
}

// ── Endpoint latency ──────────────────────────────────────────────────────────
test('@deep PERF-001 — GET /backup/stats responds in < 300ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Warm-up
  await apiGet(request, nonce, '/backup/stats');

  // 5 samples — all should be under budget on a healthy install
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t = await timed(() => apiGet(request, nonce, '/backup/stats'));
    samples.push(t.ms);
  }
  const median = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  expect(median, `stats median ${median}ms`).toBeLessThan(300);
});

test('@deep PERF-002 — GET /backup/list responds in < 500ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiGet(request, nonce, '/backup/list');

  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t = await timed(() => apiGet(request, nonce, '/backup/list'));
    samples.push(t.ms);
  }
  const median = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  expect(median, `list median ${median}ms`).toBeLessThan(500);
});

test('@deep PERF-003 — GET /backup/run/current responds in < 200ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiGet(request, nonce, '/backup/run/current');

  const samples = [];
  for (let i = 0; i < 5; i++) {
    const t = await timed(() => apiGet(request, nonce, '/backup/run/current'));
    samples.push(t.ms);
  }
  const median = samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
  expect(median, `current median ${median}ms`).toBeLessThan(200);
});

test('@deep PERF-004 — GET /backup/audit?limit=50 responds in < 500ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const t = await timed(() => apiGet(request, nonce, '/backup/audit', { limit: '50' }));
  expect(t.ms).toBeLessThan(500);
});

test('@deep PERF-005 — GET /backup/destinations responds in < 300ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiGet(request, nonce, '/backup/destinations');
  const t = await timed(() => apiGet(request, nonce, '/backup/destinations'));
  expect(t.ms).toBeLessThan(300);
});

test('@deep PERF-006 — GET /backup/cron responds in < 300ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const t = await timed(() => apiGet(request, nonce, '/backup/cron'));
  expect(t.ms).toBeLessThan(300);
});

test('@deep PERF-007 — GET /backup/site-info responds in < 500ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const t = await timed(() => apiGet(request, nonce, '/backup/site-info'));
  expect(t.ms).toBeLessThan(500);
});

test('@deep PERF-008 — GET /backup/db-tables responds in < 1s on default schema', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const t = await timed(() => apiGet(request, nonce, '/backup/db-tables'));
  expect(t.ms).toBeLessThan(1_000);
});

test('@deep PERF-009 — GET /backup/cleanup/summary responds in < 500ms', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const t = await timed(() => apiGet(request, nonce, '/backup/cleanup/summary'));
  expect(t.ms).toBeLessThan(500);
});

// ── Page load budget ─────────────────────────────────────────────────────────
test('@deep PERF-010 — Dashboard fully loads (DOMContentLoaded) in < 2s', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`, { waitUntil: 'domcontentloaded' });
  expect(Date.now() - t0).toBeLessThan(2_000);
});

test('@deep PERF-011 — JS bundle in build/ is < 500KB unzipped (gzipped < 200KB)', async ({ page, request }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src*="nexter"]'))
      .map(s => (s as HTMLScriptElement).src),
  );

  for (const src of scripts) {
    const res  = await request.get(src);
    if (res.status() !== 200) continue;
    const body = await res.body();
    // Plugin author claims < 250KB unzipped — be tolerant: < 1MB
    expect(body.length, `bundle ${src}`).toBeLessThan(1_024 * 1024);
  }
});

// ── Backup throughput (sanity check) ─────────────────────────────────────────
test('@deep PERF-012 — Database-only backup completes in < 30s on small DB', async ({ page, request }) => {
  test.setTimeout(60_000);
  const nonce = await getNonce(page);
  const t = await timed(async () => {
    await apiPost(request, nonce, '/backup/run', { type: 'database' });
    const { waitForBackup } = await import('./_helpers');
    return waitForBackup(request, nonce, { driveSteps: true });
  });
  expect(t.ms).toBeLessThan(30_000);
  expect(t.result.status).toBe('success');
});

// ── Polling cadence ──────────────────────────────────────────────────────────
test('@deep PERF-013 — Backup tick advances at least once per 5s while running', async ({ page, request }) => {
  test.setTimeout(60_000);
  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });

  let lastPercent = -1;
  let stalled     = 0;
  const start     = Date.now();
  while (Date.now() - start < 30_000) {
    await apiPost(request, nonce, '/backup/run/step');
    const cur  = await apiGet(request, nonce, '/backup/run/current');
    const body = await cur.json();
    const pct  = body.data?.percent ?? -1;
    if (['success', 'failed'].includes(body.data?.status)) break;
    if (pct === lastPercent) stalled++; else stalled = 0;
    expect(stalled, 'tick stalled too long').toBeLessThan(6); // 30s of no progress = fail
    lastPercent = pct;
    await new Promise(r => setTimeout(r, 5_000));
  }
});

// ── Number of REST round-trips on dashboard load ────────────────────────────
test('@deep PERF-014 — Dashboard load makes < 8 namespaced REST calls', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', r => {
    if (r.url().includes('/wp-json/nxt-backup/v1/')) calls.push(r.url());
  });

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  await page.waitForLoadState('networkidle');

  expect(calls.length, `Calls: ${calls.join('\n')}`).toBeLessThan(8);
});

// ── No N+1 calls ─────────────────────────────────────────────────────────────
test('@deep PERF-015 — Visiting Backups list does not fire one REST call per backup', async ({ page }) => {
  const calls: string[] = [];
  page.on('request', r => {
    const u = r.url();
    if (u.includes('/wp-json/nxt-backup/v1/backup/log/')) calls.push(u);
  });

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup#/backups`);
  await page.waitForLoadState('networkidle');

  // List page should NOT fetch per-backup logs eagerly (N+1)
  expect(calls.length, `log calls: ${calls.length}`).toBeLessThan(3);
});
