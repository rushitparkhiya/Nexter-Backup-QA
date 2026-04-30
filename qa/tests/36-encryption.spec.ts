/**
 * 36-encryption.spec.ts
 * TC006 — Encryption round-trip (correct passphrase)
 * TC007 — Encryption: wrong passphrase → friendly error, no partial write
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, runFullBackup, waitForRestore, BASE, ADMIN_PASS } from './_helpers';

const TEST_PASSPHRASE   = 'SuperSecret#9876!';
const WRONG_PASSPHRASE  = 'WrongPass!000';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC006 — Encryption round-trip ────────────────────────────────────────────
test('@P0 TC006 — Set encryption passphrase via PUT /backup/settings', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase: TEST_PASSPHRASE,
    encryption_enabled: true,
  });
  expect(res.status()).toBe(200);
});

test('@P0 TC006 — Encrypted backup: archive parts end in .enc', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Enable encryption
  await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(request, nonce, { encrypt: true });
  const parts  = backup.parts as string[];

  expect(parts.some(p => p.endsWith('.enc'))).toBe(true);
});

test('@P0 TC006 — Restore encrypted backup with correct passphrase succeeds', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(request, nonce, { encrypt: true });

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       TEST_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// ── TC007 — Wrong passphrase ──────────────────────────────────────────────────
test('@P0 TC007 — Restore with wrong passphrase returns failed status', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(request, nonce, { encrypt: true });

  await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  expect(run.status).toBe('failed');
});

test('@P0 TC007 — Friendly error message on wrong passphrase (no raw stack trace)', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(request, nonce, { encrypt: true });

  await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  const err  = run.error as string ?? '';

  expect(err).toMatch(/wrong passphrase|corrupted archive/i);
  expect(err).not.toMatch(/stack trace|#\d|class-encryption/i);
});

test('@P0 TC007 — No partial data written after wrong-passphrase failure', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(request, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  // Run a DB-only backup (quick) then restore with wrong pass
  const runRes = await apiPost(request, nonce, '/backup/run', { type: 'database' });
  expect(runRes.status()).toBe(200);

  const { waitForBackup } = await import('./_helpers');
  const bkp = await waitForBackup(request, nonce, { driveSteps: true });

  await apiPost(request, nonce, `/backup/restore/${bkp.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  expect(run.status).toBe('failed');

  // The run record should have no applied_components
  const applied = (run.applied_components as string[] | undefined) ?? [];
  expect(applied.length).toBe(0);
});

test.afterEach(async ({ page, request }) => {
  // Disable encryption after each test to avoid polluting others
  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', { encryption_enabled: false });
});
