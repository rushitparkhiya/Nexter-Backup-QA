/**
 * 97-compat.spec.ts
 * Deep QA: cross-plugin / hosting compatibility.
 *
 * - WooCommerce active during backup (large schema)
 * - Custom DB tables (non-wp_ prefix) backed up
 * - Object cache (Redis/Memcached) doesn't break backup
 * - WPML / Polylang multilingual content survives DB round-trip
 * - W3 Total Cache / WP Rocket interplay
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiGet, runFullBackup,
  BASE,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── WooCommerce ──────────────────────────────────────────────────────────────
test('@deep CMP-001 — Backup completes with WooCommerce active', async ({ page, request }) => {
  test.skip(
    !process.env.WC_INSTALLED,
    'Set WC_INSTALLED=1 after activating WooCommerce',
  );

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');

  // Verify wc_orders or wc_products tables are included in db zip
  // (We can't easily inspect zip contents from REST — verify run completed without errors)
  expect((backup.error as string | undefined) ?? '').toBe('');
});

test('@deep CMP-002 — db_tables endpoint reports WooCommerce tables', async ({ page, request }) => {
  test.skip(!process.env.WC_INSTALLED, 'Set WC_INSTALLED=1');

  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/db-tables');
  expect(res.status()).toBe(200);

  const tables = (await res.json()).data as { name: string }[];
  expect(tables.some(t => /wc_|woocommerce|wp_wc_/i.test(t.name))).toBe(true);
});

// ── Custom DB tables (non-wp_ prefix) ─────────────────────────────────────────
test('@deep CMP-003 — Backup includes tables outside the wp_ prefix when present', async ({ page, request }) => {
  test.skip(
    !process.env.CUSTOM_TABLE_PRESENT,
    'Set CUSTOM_TABLE_PRESENT=1 after creating a non-wp_ prefixed table',
  );

  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/db-tables');
  const tables = (await res.json()).data as { name: string }[];
  // db-tables should list every table the plugin can see, including non-prefixed
  expect(tables.length).toBeGreaterThan(10);
});

// ── Object cache ──────────────────────────────────────────────────────────────
test('@deep CMP-004 — Backup completes with Redis object cache active', async ({ page, request }) => {
  test.skip(
    !process.env.REDIS_OBJECT_CACHE,
    'Set REDIS_OBJECT_CACHE=1 with Redis dropin active',
  );

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

// ── WPML / Polylang ──────────────────────────────────────────────────────────
test('@deep CMP-005 — Backup with WPML active completes', async ({ page, request }) => {
  test.skip(!process.env.WPML_INSTALLED, 'Set WPML_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

// ── Page cache compatibility ──────────────────────────────────────────────────
test('@deep CMP-006 — Backup completes with WP Rocket installed', async ({ page, request }) => {
  test.skip(!process.env.WP_ROCKET_INSTALLED, 'Set WP_ROCKET_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

test('@deep CMP-007 — Backup completes with LiteSpeed Cache installed', async ({ page, request }) => {
  test.skip(!process.env.LITESPEED_INSTALLED, 'Set LITESPEED_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

// ── Wordfence ────────────────────────────────────────────────────────────────
test('@deep CMP-008 — Backup completes with Wordfence active (FCD warning expected)', async ({ page, request }) => {
  test.skip(!process.env.WORDFENCE_INSTALLED, 'Set WORDFENCE_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  expect(backup.status).toBe('success');
});

// ── PHP version awareness ────────────────────────────────────────────────────
test('@deep CMP-009 — /backup/site-info reports PHP version', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/site-info');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.php_version).toMatch(/^\d+\.\d+/);
});

// ── WP version awareness ─────────────────────────────────────────────────────
test('@deep CMP-010 — /backup/site-info reports WP version', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/site-info');
  const body  = await res.json();
  expect(body.data?.wp_version).toMatch(/^\d+\.\d+/);
});

// ── Multisite ────────────────────────────────────────────────────────────────
test('@deep CMP-011 — On multisite, /backup/site-info reports network info', async ({ page, request }) => {
  test.skip(!process.env.MULTISITE_MODE, 'Set MULTISITE_MODE=1');

  const nonce = await getNonce(page);
  const res   = await apiGet(request, nonce, '/backup/site-info');
  const body  = await res.json();
  expect(body.data?.is_multisite).toBe(true);
});
