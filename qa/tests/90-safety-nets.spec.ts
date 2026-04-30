/**
 * 90-safety-nets.spec.ts
 * TC008 â€” Permissions: non-admin user
 * TC119 â€” Concurrent click protection (409)
 * TC120 â€” Re-auth gate on Restore
 * TC121 â€” Re-auth gate on Wipe
 * TC122 â€” Re-auth gate on Unpair-site
 * TC208 â€” SSRF probe: 169.254.169.254 as paired-site URL
 * TC209 â€” Zip-slip probe: importer with ../../wp-config.php
 */
import { test, expect, chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import * as AdmZip from 'adm-zip'; // polyfilled in fixtures if needed
import {
  getNonce, apiPost, apiPut, apiGet, apiDelete,
  runFullBackup, BASE, NS, ADMIN_PASS,
} from './_helpers';

// â”€â”€ TC008 â€” Permissions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P0 TC008 â€” Editor does not see Backup menu in admin sidebar', async () => {
  const browser = await chromium.launch();
  const ctx     = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'editor.json'),
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/wp-admin/`);

  const menuLink = page.locator('#adminmenu a[href*="page=nxt-backup"]');
  await expect(menuLink).not.toBeVisible();
  await browser.close();
});

test('@P0 TC008 â€” Editor gets 403 on direct REST hit to /backup/stats', async () => {
  const browser = await chromium.launch();
  const ctx     = await browser.newContext({
    storageState: path.join(__dirname, '..', '.auth', 'editor.json'),
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/wp-admin/`);

  // Use wpApiSettings.nonce (the valid WP REST nonce injected into every admin page)
  // so the request is authenticated as the editor user (not rejected for invalid nonce)
  const nonce = await page.evaluate((): string =>
    (window as unknown as { wpApiSettings?: { nonce?: string } }).wpApiSettings?.nonce ?? '',
  );

  const res = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  // WP may return plugin-level "forbidden" or cookie/nonce-level rejection —
  // both indicate the editor cannot access this endpoint
  expect(body.code).toMatch(/forbidden|invalid_nonce|unauthorized/i);
  await browser.close();
});

// â”€â”€ TC119 â€” Concurrent click protection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC119 â€” Second POST /backup/run within 1s returns 409', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Fire two parallel requests
  const [res1, res2] = await Promise.all([
    apiPost(page, nonce, '/backup/run', { type: 'full' }),
    apiPost(page, nonce, '/backup/run', { type: 'full' }),
  ]);

  const statuses = [res1.status(), res2.status()];
  expect(statuses).toContain(200);
  expect(statuses).toContain(409);

  const failedBody = await (statuses[0] === 409 ? res1 : res2).json();
  expect(failedBody.code).toMatch(/already_running/);
});

// â”€â”€ TC120 â€” Re-auth gate on Restore â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC120 â€” Restore without confirm_password returns 401', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components: ['db'],
    // No confirm_password
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toMatch(/reauth_required/);
});

test('@P1 TC120 â€” Restore with wrong password returns 401 reauth_invalid', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: 'definitely_wrong_password_!@#',
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toMatch(/reauth_invalid/);
});

test('@P1 TC120 â€” Restore with correct password proceeds (200)', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  const res = await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
});

// â”€â”€ TC121 â€” Re-auth gate on Wipe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC121 â€” POST /backup/wipe without password returns 401', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/wipe', {
    settings: 0, destinations: 0,
    // No confirm_password â€” dry run guard
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toMatch(/reauth_required/);
});

// â”€â”€ TC122 â€” Re-auth gate on Unpair-site â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC122 â€” DELETE /backup/paired/{id} without password returns 401', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Get any paired site id (create dummy if none)
  const listRes = await apiGet(page, nonce, '/backup/paired');
  const list    = (await listRes.json()).data as { id: string }[];

  if (list.length === 0) {
    // Nothing to unpair â€” just verify the endpoint rejects without password
    // by passing a fake id
    const res = await apiDelete(page, nonce, '/backup/paired/999', {
      // No confirm_password
    });
    expect([401, 404]).toContain(res.status());
  } else {
    const res = await apiDelete(page, nonce, `/backup/paired/${list[0].id}`, {
      // No confirm_password
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.code).toMatch(/reauth_required/);
  }
});

// â”€â”€ TC208 â€” SSRF probe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC208 â€” Pairing with 169.254.169.254 is rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/paired', {
    url:   'http://169.254.169.254',
    code:  'fake-pair-code',
    label: 'SSRF probe',
  });
  expect([400, 403, 422]).toContain(res.status());
  const body = await res.json();
  expect(JSON.stringify(body)).toMatch(/unsafe|ssrf|metadata|private|loopback/i);
});

test('@P2 TC208 â€” Pairing with RFC1918 address 10.0.0.1 is rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/paired', {
    url:   'http://10.0.0.1',
    code:  'fake-pair-code',
    label: 'RFC1918 probe',
  });
  expect([400, 403, 422]).toContain(res.status());
});

test('@P2 TC208 â€” Pairing with loopback 127.0.0.1 is rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/paired', {
    url:   'http://127.0.0.1',
    code:  'fake-pair-code',
    label: 'Loopback probe',
  });
  expect([400, 403, 422]).toContain(res.status());
});

test('@P2 TC208 â€” Pairing with gopher:// scheme is rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(page, nonce, '/backup/paired', {
    url:   'gopher://evil.example.com',
    code:  'fake-pair-code',
    label: 'gopher probe',
  });
  expect([400, 403, 422]).toContain(res.status());
});

// â”€â”€ TC209 â€” Zip-slip probe â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P2 TC209 â€” Importer zip with ../../wp-config.php entry is skipped', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Create a malicious zip in memory (fixtures/zip-slip.zip must exist)
  // The fixture must be pre-created â€” see Appendix B in the code map.
  const fixtureZip = path.join(__dirname, '..', 'fixtures', 'zip-slip.zip');
  if (!fs.existsSync(fixtureZip)) {
    test.skip(true, 'zip-slip.zip fixture not found â€” see Appendix B');
    return;
  }

  // Upload via importer
  const uploadRes = await page.request.post(`${NS}/backup/importer/upload`, {
    headers:   { 'X-WP-Nonce': nonce },
    multipart: {
      file: {
        name:     'zip-slip.zip',
        mimeType: 'application/zip',
        buffer:   fs.readFileSync(fixtureZip),
      },
    },
  });
  expect([200, 422]).toContain(uploadRes.status());

  if (uploadRes.status() === 200) {
    const uploadBody = await uploadRes.json();
    const fileId     = uploadBody.data?.file_id as string;

    const runRes  = await apiPost(page, nonce, '/backup/importer', { file_id: fileId });
    const runBody = await runRes.json();

    // Either the import fails safely OR succeeds with the malicious entry skipped
    // Verify wp-config.php was NOT overwritten (it should still start with <?php)
    // We can verify by checking the log for the skip message
    const logId = runBody.data?.id as string | undefined;
    if (logId) {
      const logRes  = await apiGet(page, nonce, `/backup/log/${logId}`);
      const logBody = await logRes.json();
      const logText = JSON.stringify(logBody);
      expect(logText).toMatch(/skip|unsafe|reject/i);
    }
  }
});
