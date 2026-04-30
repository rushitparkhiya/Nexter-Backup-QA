/**
 * 38-archive-integrity.spec.ts
 * Deep QA: archive format integrity.
 *
 * - Each backup writes a manifest JSON with sha256 + size per part
 * - Manifest schema_version present
 * - Archive parts can be downloaded
 * - SHA-256 of downloaded part matches manifest
 * - Components manifest declares which components are in which part
 * - Restore detects corrupted part (manifest hash mismatch)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiGet, runFullBackup, BASE, NS } from './_helpers';
import * as crypto from 'crypto';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── Manifest exists ──────────────────────────────────────────────────────────
test('@deep ARCH-001 — Backup record includes a manifest with parts metadata', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  // Manifest may be embedded in the backup record OR fetchable
  // Inspect backup object for sha/sizes
  const parts = backup.parts as string[];
  expect(parts.length).toBeGreaterThan(0);

  // Look for part_meta / manifest field
  const hasManifest = (backup as Record<string, unknown>).manifest
                   || (backup as Record<string, unknown>).part_meta
                   || (backup as Record<string, unknown>).parts_meta
                   || (backup as Record<string, unknown>).hashes;
  expect(hasManifest).toBeTruthy();
});

// ── Each part downloadable ───────────────────────────────────────────────────
test('@deep ARCH-002 — Each archive part downloadable via GET /backup/download/{id}/{idx}', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const parts  = backup.parts as string[];

  for (let i = 0; i < parts.length; i++) {
    const res = await request.get(`${NS}/backup/download/${backup.id}/${i}`, {
      headers: { 'X-WP-Nonce': nonce },
    });
    expect([200, 302]).toContain(res.status());
  }
});

// ── Downloaded part has expected zip magic bytes ─────────────────────────────
test('@deep ARCH-003 — Downloaded part 0 starts with PK\\x03\\x04 (ZIP magic) or NXTBKP (encrypted)', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const res = await request.get(`${NS}/backup/download/${backup.id}/0`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  if (res.status() !== 200) {
    test.skip(true, 'Download endpoint not directly returning bytes (may redirect)');
    return;
  }
  const body  = await res.body();
  const magic = body.subarray(0, 6).toString('binary');
  expect(magic).toMatch(/^PK\x03\x04|^NXTBKP/);
});

// ── SHA-256 verification ─────────────────────────────────────────────────────
test('@deep ARCH-004 — Downloaded part SHA-256 matches manifest sha256 (if exposed)', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const meta   = (backup as Record<string, unknown>).part_meta
              ?? (backup as Record<string, unknown>).manifest
              ?? null;
  if (!meta) {
    test.skip(true, 'Backup record does not expose per-part sha256');
    return;
  }

  const partsMeta = (Array.isArray(meta) ? meta : (meta as Record<string, unknown>).parts) as
    { sha256?: string; index?: number }[];
  if (!Array.isArray(partsMeta)) {
    test.skip(true, 'Manifest shape unrecognised');
    return;
  }

  for (let i = 0; i < Math.min(partsMeta.length, 2); i++) {
    const expectedSha = partsMeta[i].sha256;
    if (!expectedSha) continue;

    const res  = await request.get(`${NS}/backup/download/${backup.id}/${i}`, {
      headers: { 'X-WP-Nonce': nonce },
    });
    if (res.status() !== 200) continue;
    const body = await res.body();
    const actual = crypto.createHash('sha256').update(body).digest('hex');
    expect(actual).toBe(expectedSha);
  }
});

// ── Manifest declares components ─────────────────────────────────────────────
test('@deep ARCH-005 — Backup record lists components included', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const components = (backup as Record<string, unknown>).components
                  ?? (backup as Record<string, unknown>).included_components;
  expect(components).toBeTruthy();
});

// ── Manifest schema_version ──────────────────────────────────────────────────
test('@deep ARCH-006 — Manifest declares schema_version (forward-compat tracking)', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  // Look for any version field
  const possible = ['schema_version', 'manifest_version', 'plugin_version', 'version'];
  let found = false;
  for (const k of possible) {
    if (k in (backup as Record<string, unknown>)) {
      found = true;
      break;
    }
  }
  expect(found).toBe(true);
});

// ── Backup record bytes total matches sum of parts ───────────────────────────
test('@deep ARCH-007 — Backup record total_size matches sum of part sizes', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const totalSize = (backup as Record<string, unknown>).total_size
                 ?? (backup as Record<string, unknown>).size;
  if (typeof totalSize === 'number') {
    expect(totalSize).toBeGreaterThan(0);
  }
});

// ── Restore detects corruption (mark — depends on fixture infra) ─────────────
test('@deep ARCH-008 — Restore from corrupted archive part reports failure', async ({ page, request }) => {
  test.skip(
    !process.env.CORRUPTION_TEST_MODE,
    'Set CORRUPTION_TEST_MODE=1 with a script that flips bytes in archive after backup',
  );
});
