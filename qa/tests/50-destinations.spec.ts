/**
 * 50-destinations.spec.ts
 * TC101 â€” Connect Google Drive (OAuth round-trip)
 * TC102 â€” Connect Dropbox
 * TC103 â€” Connect OneDrive
 * TC104 â€” Connect Amazon S3
 * TC105 â€” Connect SFTP
 * TC106 â€” Run backup with cloud destination
 * TC107 â€” Disconnect cloud â†’ Reconnect alert
 * TC108 â€” Reconnect after revoke
 * TC118 â€” Cache-Control: no-store on /run/current
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, apiDelete, runFullBackup, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ TC101â€“103 â€” OAuth destinations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Full OAuth flows need real credentials. These tests cover the API shape.

test('@P1 TC101 â€” POST /backup/destinations/google-drive/oauth/start returns authorize_url', async ({ page, request }) => {
  test.skip(
    !process.env.GOOGLE_CLIENT_ID,
    'Set GOOGLE_CLIENT_ID env var to run OAuth tests',
  );
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/destinations/google-drive/oauth/start', {
    client_id:     process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.authorize_url).toMatch(/accounts\.google\.com/);
  expect(body.data?.state).toBeTruthy();
});

test('@P1 TC102 â€” POST /backup/destinations/dropbox/oauth/start returns authorize_url', async ({ page, request }) => {
  test.skip(!process.env.DROPBOX_APP_KEY, 'Set DROPBOX_APP_KEY env var');
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/destinations/dropbox/oauth/start', {
    app_key:    process.env.DROPBOX_APP_KEY,
    app_secret: process.env.DROPBOX_APP_SECRET,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.authorize_url).toMatch(/dropbox\.com/);
});

test('@P1 TC103 â€” POST /backup/destinations/onedrive/oauth/start returns authorize_url', async ({ page, request }) => {
  test.skip(!process.env.ONEDRIVE_CLIENT_ID, 'Set ONEDRIVE_CLIENT_ID env var');
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/destinations/onedrive/oauth/start', {
    client_id:     process.env.ONEDRIVE_CLIENT_ID,
    client_secret: process.env.ONEDRIVE_CLIENT_SECRET,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.data?.authorize_url).toMatch(/microsoft\.com|live\.com/);
});

// â”€â”€ TC104 â€” Amazon S3 (via MinIO) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC104 â€” Connect S3-compatible (MinIO): test button reports success', async ({ page, request }) => {
  test.skip(!process.env.MINIO_ENDPOINT, 'Set MINIO_ENDPOINT=http://minio:9000 env var');

  const nonce = await getNonce(page);

  // Save destination
  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type:    's3-compatible',
    label:   'MinIO Test',
    enabled: true,
    config: {
      endpoint:   process.env.MINIO_ENDPOINT,
      access_key: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secret_key: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      bucket:     process.env.MINIO_BUCKET ?? 'nexterbackup-test',
      region:     'us-east-1',
    },
  });
  expect(saveRes.status()).toBe(200);
  const destId = (await saveRes.json()).data?.id as string;

  // Test connection
  const testRes  = await apiPost(page, nonce, `/backup/destinations/test/${destId}`);
  expect(testRes.status()).toBe(200);
  const testBody = await testRes.json();
  expect(testBody.data?.ok).toBe(true);

  // Cleanup
  await apiDelete(page, nonce, `/backup/destinations/${destId}`);
});

// â”€â”€ TC105 â€” SFTP â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC105 â€” Connect SFTP: test button reports success', async ({ page, request }) => {
  test.skip(!process.env.SFTP_HOST, 'Set SFTP_HOST env var (e.g. sftp for docker-compose)');

  const nonce = await getNonce(page);

  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type:    'sftp',
    label:   'SFTP Test',
    enabled: true,
    config: {
      host:     process.env.SFTP_HOST ?? 'sftp',
      port:     parseInt(process.env.SFTP_PORT ?? '22'),
      username: process.env.SFTP_USER ?? 'testuser',
      password: process.env.SFTP_PASS ?? 'testpass',
      path:     '/upload',
    },
  });
  expect(saveRes.status()).toBe(200);
  const destId = (await saveRes.json()).data?.id as string;

  const testRes = await apiPost(page, nonce, `/backup/destinations/test/${destId}`);
  expect(testRes.status()).toBe(200);
  expect((await testRes.json()).data?.ok).toBe(true);

  await apiDelete(page, nonce, `/backup/destinations/${destId}`);
});

// â”€â”€ TC106 â€” Run backup with cloud destination ticked â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC106 â€” Backup uploads to S3-compatible when destination is ticked', async ({ page, request }) => {
  test.skip(!process.env.MINIO_ENDPOINT, 'Requires MinIO env vars');

  const nonce = await getNonce(page);

  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type: 's3-compatible', label: 'MinIO CI', enabled: true,
    config: {
      endpoint:   process.env.MINIO_ENDPOINT,
      access_key: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secret_key: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      bucket:     process.env.MINIO_BUCKET ?? 'nexterbackup-test',
      region:     'us-east-1',
    },
  });
  const destId = (await saveRes.json()).data?.id as string;

  const backup = await runFullBackup(page, nonce, { destinations: [destId] });
  // remote[] on the backup record lists cloud-uploaded parts
  const remote = backup.remote as unknown[] | undefined;
  expect(remote && remote.length > 0).toBe(true);

  await apiDelete(page, nonce, `/backup/destinations/${destId}`);
});

// â”€â”€ TC107 â€” Disconnect cloud â†’ Reconnect alert â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC107 â€” POST /backup/destinations/test returns error after revoke', async ({ page, request }) => {
  test.skip(!process.env.MINIO_ENDPOINT, 'Requires MinIO env vars');

  const nonce = await getNonce(page);
  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type: 's3-compatible', label: 'Revoke test', enabled: true,
    config: {
      endpoint: process.env.MINIO_ENDPOINT,
      // Intentionally wrong credentials to simulate revoked token
      access_key: 'invalid_key', secret_key: 'invalid_secret',
      bucket: 'no-such-bucket', region: 'us-east-1',
    },
  });
  const destId = (await saveRes.json()).data?.id as string;

  const testRes = await apiPost(page, nonce, `/backup/destinations/test/${destId}`);
  const body    = await testRes.json();
  expect(body.data?.ok ?? false).toBe(false);
  expect(body.data?.message ?? body.message ?? '').toBeTruthy();

  await apiDelete(page, nonce, `/backup/destinations/${destId}`);
});

// â”€â”€ TC118 â€” Cache-Control: no-store on REST responses â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@P1 TC118 â€” GET /backup/run/current has Cache-Control: no-store header', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/run/current');

  const cc = res.headers()['cache-control'] ?? '';
  expect(cc).toMatch(/no-store/);
});

test('@P1 TC118 â€” GET /backup/stats has Cache-Control: no-store header', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiGet(page, nonce, '/backup/stats');
  const cc    = res.headers()['cache-control'] ?? '';
  expect(cc).toMatch(/no-store/);
});

test('@P1 TC118 â€” POST /backup/run/step has Cache-Control: no-store header', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Start a backup first so step does something
  await apiPost(page, nonce, '/backup/run', { type: 'database' });
  const res = await apiPost(page, nonce, '/backup/run/step');
  const cc  = res.headers()['cache-control'] ?? '';
  expect(cc).toMatch(/no-store/);
});
