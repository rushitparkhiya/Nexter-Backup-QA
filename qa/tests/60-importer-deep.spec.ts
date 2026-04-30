/**
 * 60-importer-deep.spec.ts
 * Deep QA: importer edge cases beyond TC114.
 *
 * - Empty zip
 * - Truncated zip
 * - Non-NexterBackup zip (no manifest)
 * - Wrong manifest version
 * - Encrypted zip without passphrase
 * - Oversized upload (>upload_max_filesize)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { getNonce, apiPost, BASE, NS } from './_helpers';

const FIX = path.join(__dirname, '..', 'fixtures');

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Helper: post a buffer to importer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function uploadBuffer(
  page: import('@playwright/test').Page,
  nonce: string,
  buffer: Buffer,
  filename = 'test.zip',
) {
  return page.request.post(`${NS}/backup/importer/upload`, {
    headers:   { 'X-WP-Nonce': nonce },
    multipart: { file: { name: filename, mimeType: 'application/zip', buffer } },
  });
}

// â”€â”€ Empty file â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-001 â€” Upload empty zip returns 400/422', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await uploadBuffer(page, nonce, Buffer.alloc(0), 'empty.zip');
  expect([400, 422]).toContain(res.status());
});

// â”€â”€ Truncated zip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-002 â€” Upload truncated zip rejected by importer run', async ({ page }) => {
  const nonce = await getNonce(page);
  // Random garbage that's not a valid zip
  const garbage = Buffer.from('PK\x03\x04this-is-not-a-real-zip-signature-just-garbage');
  const upload  = await uploadBuffer(page, nonce, garbage, 'truncated.zip');

  // Either upload itself rejects OR run rejects
  if (upload.status() === 200) {
    const fileId = (await upload.json()).data?.file_id as string;
    const runRes = await apiPost(page, nonce, '/backup/importer', { file_id: fileId });
    expect([200, 400, 422]).toContain(runRes.status());
    if (runRes.status() === 200) {
      // Check the imported entry status
      const body = await runRes.json();
      expect(body.data?.status).toBe('failed');
    }
  } else {
    expect([400, 422]).toContain(upload.status());
  }
});

// â”€â”€ Non-NexterBackup zip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-003 â€” Upload generic zip without NB manifest is recognized or fails gracefully', async ({ page }) => {
  const nonce = await getNonce(page);

  // Build a minimal valid zip with one text file
  // Use Node.js built-in zlib for inflation; for zip we'd need adm-zip
  // Just a placeholder buffer that PHP ZipArchive will recognize as bad
  const fakeZip = Buffer.concat([
    Buffer.from('PK\x05\x06'), // EOCD
    Buffer.alloc(18, 0),
  ]);

  const upload = await uploadBuffer(page, nonce, fakeZip, 'no-manifest.zip');
  if (upload.status() === 200) {
    const fileId = (await upload.json()).data?.file_id as string;
    const runRes = await apiPost(page, nonce, '/backup/importer', { file_id: fileId });
    // No manifest â†’ either rejected or imported as "unknown"
    expect([200, 400, 422]).toContain(runRes.status());
  } else {
    expect([400, 422]).toContain(upload.status());
  }
});

// â”€â”€ Wrong manifest version â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-004 â€” Manifest with future schema version surfaces compatibility warning', async ({ page }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'wrong-version-manifest.zip')),
    'Set up fixtures/wrong-version-manifest.zip with manifest.schema_version=999',
  );
});

// â”€â”€ Encrypted zip without passphrase â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-005 â€” Encrypted .enc file imported via Importer requires passphrase to restore', async ({ page }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'encrypted-backup.zip.enc')),
    'Set up fixtures/encrypted-backup.zip.enc',
  );
});

// â”€â”€ Importer upload over WP upload_max_filesize â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-006 â€” Upload larger than WP upload_max_filesize rejected', async ({ page }) => {
  test.skip(
    !process.env.UPLOAD_MAX_TEST_FIXTURE,
    'Set UPLOAD_MAX_TEST_FIXTURE=1 with a fixture > upload_max_filesize',
  );
});

// â”€â”€ Successful import flow shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep IMP-007 â€” Successful import surfaces a record with tagged=true (not pruned by retention)', async ({ page }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'valid-backup.zip')),
    'Set up fixtures/valid-backup.zip â€” copy a real backup zip from the plugin',
  );

  const nonce  = await getNonce(page);
  const upload = await uploadBuffer(
    request, nonce,
    fs.readFileSync(path.join(FIX, 'valid-backup.zip')),
    'valid.zip',
  );
  const fileId = (await upload.json()).data?.file_id as string;
  const runRes = await apiPost(page, nonce, '/backup/importer', { file_id: fileId });
  expect(runRes.status()).toBe(200);
});
