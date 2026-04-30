/**
 * 36-encryption.spec.ts
 * TC006 â€” Encryption round-trip (correct passphrase)
 * TC007 â€” Encryption: wrong passphrase â†’ friendly error, no partial write
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, runFullBackup, waitForRestore, BASE, ADMIN_PASS } from './_helpers';

const TEST_PASSPHRASE   = 'SuperSecret#9876!';
const WRONG_PASSPHRASE  = 'WrongPass!000';

// Encryption tests each need a full backup + restore cycle which can take several minutes.
// 10 min: optional 409 drain (~240s) + fresh backup (~60s) + restore (~240s) per test.
test.setTimeout(600_000);

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ TC006 â€” Encryption round-trip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P0 TC006 â€” Set encryption passphrase via PUT /backup/settings', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase: TEST_PASSPHRASE,
    encryption_enabled: true,
  });
  expect(res.status()).toBe(200);
});

test('@P0 TC006 â€” Encrypted backup: archive parts end in .enc', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Enable encryption
  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });
  const parts  = backup.parts as string[];

  expect(parts.some(p => p.endsWith('.enc'))).toBe(true);
});

test('@P0 TC006 â€” Restore encrypted backup with correct passphrase succeeds', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       TEST_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);

  const run = await waitForRestore(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
  expect(run.status).toBe('success');
});

// â”€â”€ TC007 â€” Wrong passphrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P0 TC007 â€” Restore with wrong passphrase returns failed status', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
  expect(run.status).toBe('failed');
});

test('@P0 TC007 â€” Friendly error message on wrong passphrase (no raw stack trace)', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
  const err  = run.error as string ?? '';

  expect(err).toMatch(/wrong passphrase|corrupted archive/i);
  expect(err).not.toMatch(/stack trace|#\d|class-encryption/i);
});

test('@P0 TC007 â€” No partial data written after wrong-passphrase failure', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  TEST_PASSPHRASE,
    encryption_enabled: true,
  });

  // Run a full backup; use runFullBackup to handle any 409 in-progress conflicts
  const bkp = await runFullBackup(page, nonce);

  await apiPost(page, nonce, `/backup/restore/${bkp.id}`, {
    components:       ['db'],
    passphrase:       WRONG_PASSPHRASE,
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(page, nonce, { driveSteps: true, timeoutMs: 240_000 });
  expect(run.status).toBe('failed');

  // The run record should have no applied_components
  const applied = (run.applied_components as string[] | undefined) ?? [];
  expect(applied.length).toBe(0);
});

test.afterEach(async ({ page, request }) => {
  // Disable encryption after each test to avoid polluting others
  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', { encryption_enabled: false });
});
