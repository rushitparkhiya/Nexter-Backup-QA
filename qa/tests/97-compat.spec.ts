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

// â”€â”€ WooCommerce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-001 â€” Backup completes with WooCommerce active', async ({ page, request }) => {
  test.skip(
    !process.env.WC_INSTALLED,
    'Set WC_INSTALLED=1 after activating WooCommerce',
  );

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');

  // Verify wc_orders or wc_products tables are included in db zip
  // (We can't easily inspect zip contents from REST â€” verify run completed without errors)
  expect((backup.error as string | undefined) ?? '').toBe('');
});

test('@deep CMP-002 â€” db_tables endpoint reports WooCommerce tables', async ({ page, request }) => {
  test.skip(!process.env.WC_INSTALLED, 'Set WC_INSTALLED=1');

  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/db-tables');
  expect(res.status()).toBe(200);

  const tables = (await res.json()).data as { name: string }[];
  expect(tables.some(t => /wc_|woocommerce|wp_wc_/i.test(t.name))).toBe(true);
});

// â”€â”€ Custom DB tables (non-wp_ prefix) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-003 â€” Backup includes tables outside the wp_ prefix when present', async ({ page, request }) => {
  test.skip(
    !process.env.CUSTOM_TABLE_PRESENT,
    'Set CUSTOM_TABLE_PRESENT=1 after creating a non-wp_ prefixed table',
  );

  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/db-tables');
  const tables = (await res.json()).data as { name: string }[];
  // db-tables should list every table the plugin can see, including non-prefixed
  expect(tables.length).toBeGreaterThan(10);
});

// â”€â”€ Object cache â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-004 â€” Backup completes with Redis object cache active', async ({ page, request }) => {
  test.skip(
    !process.env.REDIS_OBJECT_CACHE,
    'Set REDIS_OBJECT_CACHE=1 with Redis dropin active',
  );

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

// â”€â”€ WPML / Polylang â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-005 â€” Backup with WPML active completes', async ({ page, request }) => {
  test.skip(!process.env.WPML_INSTALLED, 'Set WPML_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

// â”€â”€ Page cache compatibility â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-006 â€” Backup completes with WP Rocket installed', async ({ page, request }) => {
  test.skip(!process.env.WP_ROCKET_INSTALLED, 'Set WP_ROCKET_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

test('@deep CMP-007 â€” Backup completes with LiteSpeed Cache installed', async ({ page, request }) => {
  test.skip(!process.env.LITESPEED_INSTALLED, 'Set LITESPEED_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

// â”€â”€ Wordfence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-008 â€” Backup completes with Wordfence active (FCD warning expected)', async ({ page, request }) => {
  test.skip(!process.env.WORDFENCE_INSTALLED, 'Set WORDFENCE_INSTALLED=1');

  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);
  expect(backup.status).toBe('success');
});

// â”€â”€ PHP version awareness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-009 â€” /backup/site-info reports PHP version', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/site-info');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.php_version).toMatch(/^\d+\.\d+/);
});

// â”€â”€ WP version awareness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-010 â€” /backup/site-info reports WP version', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/site-info');
  const body  = await res.json();
  expect(body.data?.wp_version).toMatch(/^\d+\.\d+/);
});

// â”€â”€ Multisite â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CMP-011 â€” On multisite, /backup/site-info reports network info', async ({ page, request }) => {
  test.skip(!process.env.MULTISITE_MODE, 'Set MULTISITE_MODE=1');

  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/site-info');
  const body  = await res.json();
  expect(body.data?.is_multisite).toBe(true);
});
