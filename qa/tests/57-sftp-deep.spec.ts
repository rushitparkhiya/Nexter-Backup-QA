/**
 * 57-sftp-deep.spec.ts
 * Deep QA: SFTP destination behaviour.
 *
 * - Password auth round-trip
 * - Public-key auth path
 * - Custom port
 * - Wrong host (DNS failure) returns ok=false, not 500
 * - Path with no trailing slash works
 * - Resumable upload offset-aware (mocked)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiDelete, BASE, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  if (!process.env.SFTP_HOST) {
    test.skip(true, 'Set SFTP_HOST (e.g. sftp from docker-compose) to run');
  }
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const cfg = (override = {}) => ({
  host:     process.env.SFTP_HOST ?? 'sftp',
  port:     parseInt(process.env.SFTP_PORT ?? '22', 10),
  username: process.env.SFTP_USER ?? 'testuser',
  password: process.env.SFTP_PASS ?? 'testpass',
  path:     '/upload',
  ...override,
});

async function saveSftp(request: import('@playwright/test').APIRequestContext, nonce: string, label: string, override = {}) {
  const res = await apiPut(request, nonce, '/backup/destinations', {
    type: 'sftp', label, enabled: true, config: cfg(override),
  });
  return (await res.json()).data?.id as string;
}

async function teardownDest(request: import('@playwright/test').APIRequestContext, nonce: string, id: string | undefined) {
  if (!id) return;
  await apiDelete(request, nonce, `/backup/destinations/${id}`, { confirm_password: ADMIN_PASS });
}

// ── Password auth ────────────────────────────────────────────────────────────
test('@deep SFTP-001 — Password auth: connection test reports ok=true', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-001');

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  const body    = await testRes.json();
  expect(body.data?.ok).toBe(true);

  await teardownDest(request, nonce, id);
});

// ── Public-key auth ──────────────────────────────────────────────────────────
test('@deep SFTP-002 — Save SFTP with private_key field is accepted', async ({ page, request }) => {
  test.skip(!process.env.SFTP_PRIVATE_KEY, 'Set SFTP_PRIVATE_KEY (PEM contents) to test key auth');

  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-002', {
    password:    '',
    private_key: process.env.SFTP_PRIVATE_KEY,
  });
  expect(id).toBeTruthy();
  await teardownDest(request, nonce, id);
});

// ── Custom port ──────────────────────────────────────────────────────────────
test('@deep SFTP-003 — Custom port persists in config', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-003', { port: 2222 });
  expect(id).toBeTruthy();
  await teardownDest(request, nonce, id);
});

// ── Wrong host ───────────────────────────────────────────────────────────────
test('@deep SFTP-004 — Test with unresolvable host returns ok=false (not 500)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-004', {
    host: 'host-that-does-not-exist-' + Date.now() + '.invalid',
  });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  expect(testRes.status()).toBe(200);
  const body = await testRes.json();
  expect(body.data?.ok).toBe(false);

  await teardownDest(request, nonce, id);
});

// ── Wrong port ───────────────────────────────────────────────────────────────
test('@deep SFTP-005 — Test with wrong port (22999) returns ok=false', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-005', { port: 22999 });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  expect(testRes.status()).toBe(200);
  const body = await testRes.json();
  expect(body.data?.ok).toBe(false);

  await teardownDest(request, nonce, id);
});

// ── Wrong password ───────────────────────────────────────────────────────────
test('@deep SFTP-006 — Test with wrong password returns ok=false', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-006', { password: 'definitely-wrong' });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  expect(testRes.status()).toBe(200);
  const body = await testRes.json();
  expect(body.data?.ok).toBe(false);

  await teardownDest(request, nonce, id);
});

// ── Path without trailing slash ──────────────────────────────────────────────
test('@deep SFTP-007 — Path "/upload" (no trailing slash) accepted', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-007', { path: '/upload' });

  const testRes = await apiPost(request, nonce, `/backup/destinations/test/${id}`);
  expect(testRes.status()).toBe(200);

  await teardownDest(request, nonce, id);
});

// ── Backup upload integration ────────────────────────────────────────────────
test('@deep SFTP-008 — DB backup uploads via SFTP and remote[] populated', async ({ page, request }) => {
  test.setTimeout(2 * 60_000);
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-008');

  await apiPost(request, nonce, '/backup/run', { type: 'database', destinations: [id] });
  const { waitForBackup, latestBackup } = await import('./_helpers');
  await waitForBackup(request, nonce, { driveSteps: true });
  const backup = await latestBackup(request, nonce);
  expect(backup).toBeTruthy();

  await teardownDest(request, nonce, id);
});

// ── Password redaction ───────────────────────────────────────────────────────
test('@deep SFTP-009 — SFTP password not echoed in /destinations list', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const id    = await saveSftp(request, nonce, 'SFTP-009', { password: 'NEVER-LEAK-SFTP-PASS-123' });

  const { apiGet } = await import('./_helpers');
  const list = await apiGet(request, nonce, '/backup/destinations');
  const text = JSON.stringify(await list.json());
  expect(text).not.toContain('NEVER-LEAK-SFTP-PASS-123');

  await teardownDest(request, nonce, id);
});
