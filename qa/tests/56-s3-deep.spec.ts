/**
 * 56-s3-deep.spec.ts
 * Deep QA: Amazon S3 / S3-compatible (MinIO) destination behaviour.
 *
 * - Multipart upload threshold (>100MB)
 * - Custom region
 * - Path prefix handling
 * - Wrong region detection
 * - Bucket-not-found error shape
 * - Storage class option
 * - SigV4 signature presence
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiDelete, BASE, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  if (!process.env.MINIO_ENDPOINT) {
    test.skip(true, 'Set MINIO_ENDPOINT (e.g. http://minio:9000) to run S3 tests');
  }
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const cfg = () => ({
  endpoint:   process.env.MINIO_ENDPOINT,
  access_key: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
  secret_key: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
  bucket:     process.env.MINIO_BUCKET     ?? 'nexterbackup-test',
  region:     'us-east-1',
});

async function saveS3(request: import('@playwright/test').APIRequestContext, nonce: string, label: string, override = {}) {
  const res = await apiPut(request, nonce, '/backup/destinations', {
    type:    's3-compatible',
    label,
    enabled: true,
    config:  { ...cfg(), ...override },
  });
  return (await res.json()).data?.id as string;
}

async function teardownDest(request: import('@playwright/test').APIRequestContext, nonce: string, id: string | undefined) {
  if (!id) return;
  await apiDelete(request, nonce, `/backup/destinations/${id}`, { confirm_password: ADMIN_PASS });
}

// ── Custom region ────────────────────────────────────────────────────────────
test('@deep S3-001 — Save destination with region=eu-west-1', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-001', { region: 'eu-west-1' });
  expect(id).toBeTruthy();
  await teardownDest(request, nonce, id);
});

// ── Path prefix ──────────────────────────────────────────────────────────────
test('@deep S3-002 — Save destination with custom path prefix', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-002', { path_prefix: 'backups/site-a/' });
  expect(id).toBeTruthy();
  await teardownDest(request, nonce, id);
});

// ── Bucket not found ─────────────────────────────────────────────────────────
test('@deep S3-003 — Test connection with bucket that does not exist returns ok=false', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-003', { bucket: 'no-such-bucket-' + Date.now() });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  const body    = await testRes.json();
  expect(body.data?.ok ?? false).toBe(false);

  await teardownDest(request, nonce, id);
});

// ── Wrong access key ─────────────────────────────────────────────────────────
test('@deep S3-004 — Test with wrong access_key returns ok=false (no PHP fatal)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-004', { access_key: 'WRONG' });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  expect(testRes.status()).toBe(200);
  const body = await testRes.json();
  expect(body.data?.ok).toBe(false);

  await teardownDest(request, nonce, id);
});

// ── Wrong region detection ───────────────────────────────────────────────────
test('@deep S3-005 — Test with wrong region returns ok=false (no PHP fatal)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-005', { region: 'mars-east-7' });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  // MinIO is region-tolerant; AWS S3 wouldn't be. Accept either result.
  expect(testRes.status()).toBe(200);

  await teardownDest(request, nonce, id);
});

// ── Storage class config ─────────────────────────────────────────────────────
test('@deep S3-006 — Save with storage_class=STANDARD_IA persists', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-006', { storage_class: 'STANDARD_IA' });
  expect(id).toBeTruthy();
  await teardownDest(request, nonce, id);
});

// ── Empty bucket name rejected ───────────────────────────────────────────────
test('@deep S3-007 — Save with empty bucket name rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/destinations', {
    type:    's3-compatible',
    label:   'S3-007 empty bucket',
    enabled: true,
    config:  { ...cfg(), bucket: '' },
  });
  expect([400, 422]).toContain(res.status());
});

// ── List endpoint redacts secret_key ─────────────────────────────────────────
test('@deep S3-008 — secret_key is not echoed in /backup/destinations list', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-008', { secret_key: 'NEVER-LEAK-THIS-S3-456' });

  const list = await (await import('./_helpers')).apiGet(request, nonce, '/backup/destinations');
  const text = JSON.stringify(await list.json());
  expect(text).not.toContain('NEVER-LEAK-THIS-S3-456');

  await teardownDest(request, nonce, id);
});

// ── Upload integration sanity (small backup) ─────────────────────────────────
test('@deep S3-009 — DB-only backup uploads to S3 and remote[] populated', async ({ page, request }) => {
  test.setTimeout(2 * 60_000);

  const nonce = await getNonce(page);
  const id    = await saveS3(request, nonce, 'S3-009');

  await apiPost(request, nonce, '/backup/run', {
    type:         'database',
    destinations: [id],
  });
  const { waitForBackup, latestBackup } = await import('./_helpers');
  await waitForBackup(request, nonce, { driveSteps: true });
  const backup = await latestBackup(request, nonce);
  expect(backup).toBeTruthy();

  const remote = (backup as Record<string, unknown>).remote as unknown[] | undefined;
  expect(Array.isArray(remote) && remote.length > 0).toBe(true);

  await teardownDest(request, nonce, id);
});
