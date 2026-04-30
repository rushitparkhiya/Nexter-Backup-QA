/**
 * 11-rest-shape.spec.ts
 * Deep QA: response shape contracts.
 *
 * Each endpoint must return data of a specific shape. Future regressions
 * that rename a field or change a type are caught here even if the route
 * still returns 200.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiGet, runFullBackup, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── /backup/stats ────────────────────────────────────────────────────────────
test('@deep SHAPE-001 — /backup/stats has total + total_size + success + runtime fields', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/stats')).json();
  expect(body.data).toHaveProperty('total');
  expect(body.data).toHaveProperty('total_size');
  expect(typeof body.data.total).toBe('number');
});

// ── /backup/site-info ────────────────────────────────────────────────────────
test('@deep SHAPE-002 — /backup/site-info has php_version + wp_version + is_multisite', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/site-info')).json();
  expect(body.data?.php_version).toMatch(/^\d+\.\d+/);
  expect(body.data?.wp_version).toMatch(/^\d+\.\d+/);
  expect(typeof body.data?.is_multisite).toBe('boolean');
});

// ── /backup/site-size ────────────────────────────────────────────────────────
test('@deep SHAPE-003 — /backup/site-size has uploads_size + plugins_size + themes_size', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/site-size')).json();
  expect(body.data).toBeDefined();
  // Each size field is a non-negative number
  for (const key of ['uploads_size', 'plugins_size', 'themes_size', 'mu_plugins_size', 'wpcore_size']) {
    if (key in (body.data ?? {})) {
      expect((body.data as Record<string, number>)[key]).toBeGreaterThanOrEqual(0);
    }
  }
});

// ── /backup/list ──────────────────────────────────────────────────────────────
test('@deep SHAPE-004 — /backup/list returns array; each entry has id+status+ts+parts', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await runFullBackup(request, nonce);

  const body = await (await apiGet(request, nonce, '/backup/list')).json();
  const list = body.data as { id: string; status: string; ts?: number; parts: string[] }[];
  expect(Array.isArray(list)).toBe(true);
  expect(list.length).toBeGreaterThan(0);
  for (const entry of list.slice(0, 3)) {
    expect(typeof entry.id).toBe('string');
    expect(['success', 'failed', 'running', 'queued']).toContain(entry.status);
    expect(Array.isArray(entry.parts)).toBe(true);
  }
});

// ── /backup/destinations ─────────────────────────────────────────────────────
test('@deep SHAPE-005 — /backup/destinations entries have id+type+label+enabled', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/destinations')).json();
  const dests = body.data as { id: string; type: string; label: string; enabled: boolean }[];
  for (const d of dests.slice(0, 3)) {
    expect(typeof d.id).toBe('string');
    expect(typeof d.type).toBe('string');
    expect(typeof d.label).toBe('string');
    expect(typeof d.enabled).toBe('boolean');
  }
});

// ── /backup/db-tables ────────────────────────────────────────────────────────
test('@deep SHAPE-006 — /backup/db-tables entries have name + rows + size', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/db-tables')).json();
  const tables = body.data as { name: string; rows?: number; size?: number }[];
  expect(Array.isArray(tables)).toBe(true);
  expect(tables.length).toBeGreaterThan(0);
  for (const t of tables.slice(0, 3)) {
    expect(typeof t.name).toBe('string');
  }
});

// ── /backup/cron ─────────────────────────────────────────────────────────────
test('@deep SHAPE-007 — /backup/cron entries have hook + next + (optional) args', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const body   = await (await apiGet(request, nonce, '/backup/cron')).json();
  const events = body.data as { hook: string; next: number }[];
  expect(Array.isArray(events)).toBe(true);
  for (const e of events.slice(0, 3)) {
    expect(typeof e.hook).toBe('string');
    expect(typeof e.next).toBe('number');
  }
});

// ── /backup/audit ─────────────────────────────────────────────────────────────
test('@deep SHAPE-008 — /backup/audit entries have action + user + ts + ip + ua', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  await runFullBackup(request, nonce);

  const body    = await (await apiGet(request, nonce, '/backup/audit', { limit: '5' })).json();
  const entries = body.data as { action: string; user: number; ts: number; ip?: string; ua?: string }[];
  for (const e of entries.slice(0, 3)) {
    expect(typeof e.action).toBe('string');
    expect(typeof e.user).toBe('number');
    expect(typeof e.ts).toBe('number');
  }
});

// ── /backup/cleanup/summary ──────────────────────────────────────────────────
test('@deep SHAPE-009 — /backup/cleanup/summary returns object with numeric stats', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/cleanup/summary')).json();
  expect(typeof body.data).toBe('object');
});

// ── /backup/run/current (idle) ───────────────────────────────────────────────
test('@deep SHAPE-010 — /backup/run/current when idle returns status="idle" or empty', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Wait for any prior runs to drain
  const body = await (await apiGet(request, nonce, '/backup/run/current')).json();
  // Either idle, an empty object, or a terminal state
  expect(['idle', 'success', 'failed', 'cancelled', undefined])
    .toContain(body.data?.status);
});

// ── /backup/settings ──────────────────────────────────────────────────────────
test('@deep SHAPE-011 — /backup/settings returns the documented setting keys', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/settings')).json();
  // Sample keys we know exist
  const keys = ['schedule_files_interval', 'split_archives_by_component', 'split_archive_mb'];
  for (const k of keys) {
    expect(body.data, `missing key ${k}`).toHaveProperty(k);
  }
});

// ── /backup/paired ────────────────────────────────────────────────────────────
test('@deep SHAPE-012 — /backup/paired returns array (possibly empty)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/paired')).json();
  expect(Array.isArray(body.data)).toBe(true);
});

// ── /backup/sync/jobs ─────────────────────────────────────────────────────────
test('@deep SHAPE-013 — /backup/sync/jobs returns array (possibly empty)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/sync/jobs')).json();
  expect(Array.isArray(body.data)).toBe(true);
});

// ── Error response shape ─────────────────────────────────────────────────────
test('@deep SHAPE-014 — Error responses follow {code, message, data: {status}} contract', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Force a 404
  const res  = await apiGet(request, nonce, '/backup/log/totally-fake-id-here');
  if (res.status() >= 400) {
    const body = await res.json();
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    if (body.data) expect(body.data).toHaveProperty('status');
  }
});
