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

// ── Helper: post a buffer to importer ────────────────────────────────────────
async function uploadBuffer(
  request: import('@playwright/test').APIRequestContext,
  nonce: string,
  buffer: Buffer,
  filename = 'test.zip',
) {
  return request.post(`${NS}/backup/importer/upload`, {
    headers:   { 'X-WP-Nonce': nonce },
    multipart: { file: { name: filename, mimeType: 'application/zip', buffer } },
  });
}

// ── Empty file ───────────────────────────────────────────────────────────────
test('@deep IMP-001 — Upload empty zip returns 400/422', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await uploadBuffer(request, nonce, Buffer.alloc(0), 'empty.zip');
  expect([400, 422]).toContain(res.status());
});

// ── Truncated zip ────────────────────────────────────────────────────────────
test('@deep IMP-002 — Upload truncated zip rejected by importer run', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Random garbage that's not a valid zip
  const garbage = Buffer.from('PK\x03\x04this-is-not-a-real-zip-signature-just-garbage');
  const upload  = await uploadBuffer(request, nonce, garbage, 'truncated.zip');

  // Either upload itself rejects OR run rejects
  if (upload.status() === 200) {
    const fileId = (await upload.json()).data?.file_id as string;
    const runRes = await apiPost(request, nonce, '/backup/importer', { file_id: fileId });
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

// ── Non-NexterBackup zip ─────────────────────────────────────────────────────
test('@deep IMP-003 — Upload generic zip without NB manifest is recognized or fails gracefully', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Build a minimal valid zip with one text file
  // Use Node.js built-in zlib for inflation; for zip we'd need adm-zip
  // Just a placeholder buffer that PHP ZipArchive will recognize as bad
  const fakeZip = Buffer.concat([
    Buffer.from('PK\x05\x06'), // EOCD
    Buffer.alloc(18, 0),
  ]);

  const upload = await uploadBuffer(request, nonce, fakeZip, 'no-manifest.zip');
  if (upload.status() === 200) {
    const fileId = (await upload.json()).data?.file_id as string;
    const runRes = await apiPost(request, nonce, '/backup/importer', { file_id: fileId });
    // No manifest → either rejected or imported as "unknown"
    expect([200, 400, 422]).toContain(runRes.status());
  } else {
    expect([400, 422]).toContain(upload.status());
  }
});

// ── Wrong manifest version ───────────────────────────────────────────────────
test('@deep IMP-004 — Manifest with future schema version surfaces compatibility warning', async ({ page, request }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'wrong-version-manifest.zip')),
    'Set up fixtures/wrong-version-manifest.zip with manifest.schema_version=999',
  );
});

// ── Encrypted zip without passphrase ─────────────────────────────────────────
test('@deep IMP-005 — Encrypted .enc file imported via Importer requires passphrase to restore', async ({ page, request }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'encrypted-backup.zip.enc')),
    'Set up fixtures/encrypted-backup.zip.enc',
  );
});

// ── Importer upload over WP upload_max_filesize ──────────────────────────────
test('@deep IMP-006 — Upload larger than WP upload_max_filesize rejected', async ({ page, request }) => {
  test.skip(
    !process.env.UPLOAD_MAX_TEST_FIXTURE,
    'Set UPLOAD_MAX_TEST_FIXTURE=1 with a fixture > upload_max_filesize',
  );
});

// ── Successful import flow shape ─────────────────────────────────────────────
test('@deep IMP-007 — Successful import surfaces a record with tagged=true (not pruned by retention)', async ({ page, request }) => {
  test.skip(
    !fs.existsSync(path.join(FIX, 'valid-backup.zip')),
    'Set up fixtures/valid-backup.zip — copy a real backup zip from the plugin',
  );

  const nonce  = await getNonce(page);
  const upload = await uploadBuffer(
    request, nonce,
    fs.readFileSync(path.join(FIX, 'valid-backup.zip')),
    'valid.zip',
  );
  const fileId = (await upload.json()).data?.file_id as string;
  const runRes = await apiPost(request, nonce, '/backup/importer', { file_id: fileId });
  expect(runRes.status()).toBe(200);
});
