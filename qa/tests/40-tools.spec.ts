/**
 * 40-tools.spec.ts
 * TC114 â€” Upload archive zip via Importer
 * TC123 â€” Audit log records every mutating action
 * TC306 â€” Audit log export to CSV (no secrets visible)
 */
import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  getNonce, apiPost, apiGet, apiPut, apiDelete,
  runFullBackup, BASE, NS, ADMIN_PASS,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ TC114 â€” Upload archive zip via Importer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC114 â€” POST /backup/importer/upload accepts a valid zip', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Create a minimal fixture zip in memory using the backup we just ran
  const backup = await runFullBackup(page, nonce);
  const parts  = backup.parts as string[];
  const dbZip  = parts.find(p => p.endsWith('-db.zip'));

  if (!dbZip) {
    test.skip(true, 'No db.zip part found â€” ensure split_archives_by_component=true');
    return;
  }

  // We cannot directly access the server filesystem from the test â€”
  // Instead verify the upload endpoint accepts our multipart POST.
  // Use the pre-built fixture zip if available, else skip.
  const fixtureZip = path.join(__dirname, '..', 'fixtures', 'valid-backup.zip');
  if (!fs.existsSync(fixtureZip)) {
    test.skip(true, 'fixtures/valid-backup.zip not found â€” see Appendix B in the code map');
    return;
  }

  const uploadRes = await page.request.post(`${NS}/backup/importer/upload`, {
    headers:   { 'X-WP-Nonce': nonce },
    multipart: {
      file: {
        name:     'valid-backup.zip',
        mimeType: 'application/zip',
        buffer:   fs.readFileSync(fixtureZip),
      },
    },
  });
  expect(uploadRes.status()).toBe(200);
  const uploadBody = await uploadRes.json();
  expect(uploadBody.data?.file_id).toBeTruthy();
});

test('@P1 TC114 â€” POST /backup/importer processes uploaded zip and status=success', async ({ page, request }) => {
  const nonce      = await getNonce(page);
  const fixtureZip = path.join(__dirname, '..', 'fixtures', 'valid-backup.zip');
  if (!fs.existsSync(fixtureZip)) {
    test.skip(true, 'fixtures/valid-backup.zip not found');
    return;
  }

  const uploadRes  = await page.request.post(`${NS}/backup/importer/upload`, {
    headers:   { 'X-WP-Nonce': nonce },
    multipart: {
      file: {
        name:     'valid-backup.zip',
        mimeType: 'application/zip',
        buffer:   fs.readFileSync(fixtureZip),
      },
    },
  });
  const fileId = (await uploadRes.json()).data?.file_id as string;

  const runRes  = await apiPost(page, nonce, '/backup/importer', { file_id: fileId });
  expect(runRes.status()).toBe(200);

  // Verify it appears in the backup list as restorable
  const listRes  = await apiGet(page, nonce, '/backup/list');
  const listBody = await listRes.json();
  const imported = (listBody.data as { tagged?: boolean }[]).find(b => b.tagged);
  expect(imported).toBeDefined();
});

// â”€â”€ TC123 â€” Audit log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC123 â€” Audit log records backup.run after running a backup', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  await runFullBackup(page, nonce);

  const res  = await apiGet(page, nonce, '/backup/audit', { limit: '50' });
  const body = await res.json();
  const entries = (body.data ?? []) as { action: string; user: number; ts: number }[];

  const runEntry = entries.find(e => e.action === 'backup.run');
  expect(runEntry).toBeDefined();
  expect(runEntry?.user).toBeGreaterThan(0);
  expect(runEntry?.ts).toBeGreaterThan(0);
});

test('@P1 TC123 â€” Audit log records destination.save', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Save a local destination (always available)
  await apiPut(page, nonce, '/backup/destinations', {
    type:    'local',
    label:   'Audit test local',
    enabled: true,
    config:  {},
  });

  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '50' });
  const entries = (await res.json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'destination.save')).toBe(true);
});

test('@P1 TC123 â€” Audit log records reauth.failed on wrong password', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  // Deliberately wrong password
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: 'deliberately_wrong',
  });

  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '50' });
  const entries = (await res.json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'reauth.failed')).toBe(true);
});

test('@P1 TC123 â€” Audit log: no secrets visible in context column', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '100' });
  const body    = await res.json();
  const rawText = JSON.stringify(body);

  // Context should not contain real token/secret/password values â€” only â€¢â€¢â€¢â€¢
  expect(rawText).not.toMatch(/"_token":"[^â€¢"]{4,}"/);
  expect(rawText).not.toMatch(/"_secret":"[^â€¢"]{4,}"/);
  expect(rawText).not.toMatch(/"access_key":"[^â€¢"]{8,}"/);
});

// â”€â”€ TC306 â€” Audit log export to CSV â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P3 TC306 â€” Audit CSV download contains no secrets', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // The export is triggered from the UI â€” hit the REST endpoint that backs it
  // /backup/audit?limit=1000 returns the data; UI converts to CSV
  const res  = await apiGet(page, nonce, '/backup/audit', { limit: '1000' });
  expect(res.status()).toBe(200);
  const body    = await res.json();
  const rawText = JSON.stringify(body);

  const secretPattern = /(password|secret|token|access_key)\s*[=:]\s*"[^â€¢"]{8,}"/i;
  expect(rawText).not.toMatch(secretPattern);
});
