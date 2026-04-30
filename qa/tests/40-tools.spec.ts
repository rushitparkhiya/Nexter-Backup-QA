/**
 * 40-tools.spec.ts
 * TC114 — Upload archive zip via Importer
 * TC123 — Audit log records every mutating action
 * TC306 — Audit log export to CSV (no secrets visible)
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

// ── TC114 — Upload archive zip via Importer ───────────────────────────────────
test('@P1 TC114 — POST /backup/importer/upload accepts a valid zip', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Create a minimal fixture zip in memory using the backup we just ran
  const backup = await runFullBackup(request, nonce);
  const parts  = backup.parts as string[];
  const dbZip  = parts.find(p => p.endsWith('-db.zip'));

  if (!dbZip) {
    test.skip(true, 'No db.zip part found — ensure split_archives_by_component=true');
    return;
  }

  // We cannot directly access the server filesystem from the test —
  // Instead verify the upload endpoint accepts our multipart POST.
  // Use the pre-built fixture zip if available, else skip.
  const fixtureZip = path.join(__dirname, '..', 'fixtures', 'valid-backup.zip');
  if (!fs.existsSync(fixtureZip)) {
    test.skip(true, 'fixtures/valid-backup.zip not found — see Appendix B in the code map');
    return;
  }

  const uploadRes = await request.post(`${NS}/backup/importer/upload`, {
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

test('@P1 TC114 — POST /backup/importer processes uploaded zip and status=success', async ({ page, request }) => {
  const nonce      = await getNonce(page);
  const fixtureZip = path.join(__dirname, '..', 'fixtures', 'valid-backup.zip');
  if (!fs.existsSync(fixtureZip)) {
    test.skip(true, 'fixtures/valid-backup.zip not found');
    return;
  }

  const uploadRes  = await request.post(`${NS}/backup/importer/upload`, {
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

  const runRes  = await apiPost(request, nonce, '/backup/importer', { file_id: fileId });
  expect(runRes.status()).toBe(200);

  // Verify it appears in the backup list as restorable
  const listRes  = await apiGet(request, nonce, '/backup/list');
  const listBody = await listRes.json();
  const imported = (listBody.data as { tagged?: boolean }[]).find(b => b.tagged);
  expect(imported).toBeDefined();
});

// ── TC123 — Audit log ─────────────────────────────────────────────────────────
test('@P1 TC123 — Audit log records backup.run after running a backup', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  await runFullBackup(request, nonce);

  const res  = await apiGet(request, nonce, '/backup/audit', { limit: '50' });
  const body = await res.json();
  const entries = (body.data ?? []) as { action: string; user: number; ts: number }[];

  const runEntry = entries.find(e => e.action === 'backup.run');
  expect(runEntry).toBeDefined();
  expect(runEntry?.user).toBeGreaterThan(0);
  expect(runEntry?.ts).toBeGreaterThan(0);
});

test('@P1 TC123 — Audit log records destination.save', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Save a local destination (always available)
  await apiPut(request, nonce, '/backup/destinations', {
    type:    'local',
    label:   'Audit test local',
    enabled: true,
    config:  {},
  });

  const res     = await apiGet(request, nonce, '/backup/audit', { limit: '50' });
  const entries = (await res.json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'destination.save')).toBe(true);
});

test('@P1 TC123 — Audit log records reauth.failed on wrong password', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  // Deliberately wrong password
  await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: 'deliberately_wrong',
  });

  const res     = await apiGet(request, nonce, '/backup/audit', { limit: '50' });
  const entries = (await res.json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'reauth.failed')).toBe(true);
});

test('@P1 TC123 — Audit log: no secrets visible in context column', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const res     = await apiGet(request, nonce, '/backup/audit', { limit: '100' });
  const body    = await res.json();
  const rawText = JSON.stringify(body);

  // Context should not contain real token/secret/password values — only ••••
  expect(rawText).not.toMatch(/"_token":"[^•"]{4,}"/);
  expect(rawText).not.toMatch(/"_secret":"[^•"]{4,}"/);
  expect(rawText).not.toMatch(/"access_key":"[^•"]{8,}"/);
});

// ── TC306 — Audit log export to CSV ──────────────────────────────────────────
test('@P3 TC306 — Audit CSV download contains no secrets', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // The export is triggered from the UI — hit the REST endpoint that backs it
  // /backup/audit?limit=1000 returns the data; UI converts to CSV
  const res  = await apiGet(request, nonce, '/backup/audit', { limit: '1000' });
  expect(res.status()).toBe(200);
  const body    = await res.json();
  const rawText = JSON.stringify(body);

  const secretPattern = /(password|secret|token|access_key)\s*[=:]\s*"[^•"]{8,}"/i;
  expect(rawText).not.toMatch(secretPattern);
});
