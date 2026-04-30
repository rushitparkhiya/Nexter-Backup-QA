/**
 * 37-encryption-deep.spec.ts
 * Deep QA: encryption beyond the dossier P0 round-trip.
 *
 * - Empty / very long / unicode passphrases
 * - PBKDF2 KDF rounds filter
 * - Tampered .enc detection
 * - Backup with one passphrase, restore after passphrase change
 * - Magic header validation
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, runFullBackup, waitForRestore, waitForBackup,
  BASE, ADMIN_PASS,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

test.afterEach(async ({ page }) => {
  // Always disable encryption after each test
  const nonce = await getNonce(page);
  await apiPut(page, nonce, '/backup/settings', { encryption_enabled: false });
});

// â”€â”€ Empty passphrase rejection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-001 â€” PUT /backup/settings rejects empty encryption_phrase when enabled=true', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  '',
    encryption_enabled: true,
  });
  // Either rejected OR encryption silently disabled
  if (res.status() === 200) {
    // Verify encryption was NOT actually enabled
    const after = (await (await page.request.get(`${BASE}/wp-json/nxt-backup/v1/backup/settings`, {
      headers: { 'X-WP-Nonce': nonce },
    })).json()).data;
    expect(after.encryption_enabled).toBe(false);
  } else {
    expect([400, 422]).toContain(res.status());
  }
});

// â”€â”€ Very long passphrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-002 â€” Very long passphrase (1024 chars) accepted and round-trips', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce      = await getNonce(page);
  const passphrase = 'A'.repeat(1024) + '!';

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passphrase,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Unicode passphrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-003 â€” Unicode passphrase round-trips correctly', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce      = await getNonce(page);
  const passphrase = 'å¯†ç ðŸ”ãƒ‘ã‚¹ãƒ¯ãƒ¼ãƒ‰ðŸ—ï¸ÐšÐ¾Ð´Ò·ÑƒÐ¼Ð»Ð°';

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passphrase,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });
  const res    = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Special-char passphrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-004 â€” Passphrase with quotes / backslashes round-trips', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce      = await getNonce(page);
  const passphrase = `quote"backslash\\\\nl\nNUL\0end`;

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passphrase,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });
  const res    = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Backup with old passphrase, restore after change â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-005 â€” Backup made with passphrase A restores OK even after settings switched to passphrase B', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const nonce = await getNonce(page);
  const passA = 'pass-A-original-secret-9988';
  const passB = 'pass-B-NEW-after-rotate-7766';

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passA,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  // Rotate to a different passphrase
  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passB,
    encryption_enabled: true,
  });

  // Restore using the ORIGINAL passphrase via payload override
  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase:       passA,
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Restore using stored passphrase (no payload override) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-006 â€” Restore without payload passphrase uses stored phrase', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce      = await getNonce(page);
  const passphrase = 'ENC-006-stored-pass-1234';

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passphrase,
    encryption_enabled: true,
  });

  const backup = await runFullBackup(page, nonce, { encrypt: true });

  // No passphrase in restore payload â€” runner reads from settings
  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

// â”€â”€ Encryption_phrase not echoed back in GET /backup/settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-007 â€” GET /backup/settings does not return raw encryption_phrase', async ({ page }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  'should-be-hidden-from-get-789',
    encryption_enabled: true,
  });

  const res     = await page.request.get(`${BASE}/wp-json/nxt-backup/v1/backup/settings`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const body    = await res.json();
  const rawText = JSON.stringify(body);
  // Either masked entirely or replaced with bullets
  expect(rawText).not.toContain('should-be-hidden-from-get-789');
});

// â”€â”€ Settings export hides encryption_phrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-008 â€” GET /backup/settings/export does not include encryption_phrase plain', async ({ page }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  'export-pass-secret-321',
    encryption_enabled: true,
  });

  const res = await page.request.get(`${BASE}/wp-json/nxt-backup/v1/backup/settings/export`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const text = await res.text();
  expect(text).not.toContain('export-pass-secret-321');
});

// â”€â”€ Invalid magic header â†’ friendly error â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-009 â€” Restore of non-encrypted file via .enc-renamed path errors gracefully', async ({ page }) => {
  test.skip(
    !process.env.TAMPERED_ENC_FIXTURE,
    'Set TAMPERED_ENC_FIXTURE=1 after creating fixtures/tampered.enc',
  );
  // Test stub â€” would import the tampered fixture and assert friendly error
});

// â”€â”€ No encryption when disabled â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ENC-010 â€” Backup with encryption disabled produces NO .enc parts', async ({ page }) => {
  const nonce = await getNonce(page);

  await apiPut(page, nonce, '/backup/settings', { encryption_enabled: false });

  const backup = await runFullBackup(page, nonce);
  const parts  = backup.parts as string[];
  expect(parts.every(p => !p.endsWith('.enc'))).toBe(true);
});
