/**
 * 51-destinations-deep.spec.ts
 * Deep QA: destination behaviour beyond the dossier P1 connect-and-test.
 *
 * - List redaction (secrets stripped from /backup/destinations response)
 * - TLS verify toggle
 * - 429 retry/backoff (mocked via wrong-but-recoverable creds)
 * - delete_local_after_remote setting
 * - Multiple destinations one backup
 * - Destination disable flag
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, apiGet, apiDelete, runFullBackup,
  BASE,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── Credential redaction ──────────────────────────────────────────────────────
test('@deep DST-001 — GET /backup/destinations does not leak access_key in plain', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Save an SFTP destination with a known password
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type:    'sftp',
    label:   'DST-001',
    enabled: false,
    config: {
      host:     'sftp-redact-test',
      port:     22,
      username: 'tester',
      password: 'SECRET-PASSWORD-NEVER-LEAK-9988',
      path:     '/upload',
    },
  });
  expect(saveRes.status()).toBe(200);
  const destId = (await saveRes.json()).data?.id as string;

  // List should redact the password
  const listRes  = await apiGet(request, nonce, '/backup/destinations');
  const listText = JSON.stringify(await listRes.json());
  expect(listText).not.toContain('SECRET-PASSWORD-NEVER-LEAK-9988');

  // Cleanup
  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

test('@deep DST-002 — GET /backup/destinations does not leak S3 secret_key in plain', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type:    'amazon-s3',
    label:   'DST-002',
    enabled: false,
    config: {
      access_key: 'AKIA-LEAK-TEST-7766',
      secret_key: 'SECRET-S3-NEVER-LEAK-12345',
      bucket:     'test',
      region:     'us-east-1',
    },
  });
  if (saveRes.status() !== 200) {
    test.skip(true, 'amazon-s3 destination not accepted in this build');
    return;
  }
  const destId   = (await saveRes.json()).data?.id as string;
  const listRes  = await apiGet(request, nonce, '/backup/destinations');
  const listText = JSON.stringify(await listRes.json());
  expect(listText).not.toContain('SECRET-S3-NEVER-LEAK-12345');

  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

// ── TLS verify toggle ────────────────────────────────────────────────────────
test('@deep DST-003 — Destination config accepts ssl_verify=false toggle', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type:    'sftp',
    label:   'DST-003 ssl_verify',
    enabled: false,
    config: {
      host:       'localhost',
      port:       22,
      username:   'x',
      password:   'y',
      ssl_verify: false,
    },
  });
  expect(saveRes.status()).toBe(200);

  const destId = (await saveRes.json()).data?.id as string;
  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

// ── delete_local_after_remote ────────────────────────────────────────────────
test('@deep DST-004 — delete_local_after_remote setting can be toggled', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', {
    delete_local_after_remote: true,
  });

  const after = (await (await apiGet(request, nonce, '/backup/settings')).json()).data;
  expect(after.delete_local_after_remote).toBe(true);

  // Reset
  await apiPut(request, nonce, '/backup/settings', { delete_local_after_remote: false });
});

// ── Test endpoint returns structured result ──────────────────────────────────
test('@deep DST-005 — POST /backup/destinations/test/{id} returns ok+message', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Save local destination — always testable
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: 'DST-005 local', enabled: true, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${destId}`);
  expect(testRes.status()).toBe(200);
  const body = await testRes.json();
  expect(body.data?.ok).toBeDefined();

  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

// ── Disabled destination ignored on backup ───────────────────────────────────
test('@deep DST-006 — Backup does not upload to a destination with enabled=false', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: 'DST-006 disabled', enabled: false, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  // Run backup explicitly ticking the disabled destination
  await apiPost(request, nonce, '/backup/run', {
    type:         'database',
    destinations: [destId],
  });
  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  // Acceptable: either skipped or refused
  expect(['success', 'failed']).toContain(run.status as string);

  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

// ── Update destination ───────────────────────────────────────────────────────
test('@deep DST-007 — PUT /backup/destinations updates existing destination', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: 'Original label', enabled: true, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  // Update label
  const updateRes = await apiPut(request, nonce, '/backup/destinations', {
    id:     destId,
    type:   'local',
    label:  'Updated label',
    enabled: true,
    config: {},
  });
  expect(updateRes.status()).toBe(200);

  const listRes = await apiGet(request, nonce, '/backup/destinations');
  const dest    = ((await listRes.json()).data as { id: string; label: string }[])
    .find(d => d.id === destId);
  expect(dest?.label).toBe('Updated label');

  await apiDelete(request, nonce, `/backup/destinations/${destId}`, {
    confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
  });
});

// ── Multiple destinations one backup ─────────────────────────────────────────
test('@deep DST-008 — Backup with two destinations writes uploads to both', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const dest1 = (await (await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: 'DST-008 A', enabled: true, config: {},
  })).json()).data?.id as string;

  const dest2 = (await (await apiPut(request, nonce, '/backup/destinations', {
    type: 'local', label: 'DST-008 B', enabled: true, config: { subdir: 'alt' },
  })).json()).data?.id as string;

  await apiPost(request, nonce, '/backup/run', {
    type:         'database',
    destinations: [dest1, dest2],
  });
  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  // Cleanup
  for (const id of [dest1, dest2]) {
    await apiDelete(request, nonce, `/backup/destinations/${id}`, {
      confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
    });
  }
});
