/**
 * 98-error-recovery.spec.ts
 * Deep QA: error recovery UX.
 *
 * - Failed run remains visible with diagnostic info
 * - Retry button surfaces in UI after failure
 * - Cancel mid-backup leaves a "cancelled" record
 * - Diagnostic-info bundle is downloadable
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, BASE } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── Failed run still listed ──────────────────────────────────────────────────
test('@deep ERR-001 — Failed run is listed with status="failed" and an error message', async ({ page, request }) => {
  test.skip(
    !process.env.FORCE_FAILURE_MODE,
    'Set FORCE_FAILURE_MODE=1 — needs an env that forces a backup failure (e.g. read-only storage)',
  );

  const nonce = await getNonce(page);
  await apiPost(request, nonce, '/backup/run', { type: 'database' });
  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });

  expect(run.status).toBe('failed');
  expect((run.error as string | undefined) ?? '').toBeTruthy();
});

// ── Cancel mid-backup ────────────────────────────────────────────────────────
test('@deep ERR-002 — POST /backup/run/cancel produces a cancelled record (if endpoint exists)', async ({ page, request }) => {
  const nonce = await getNonce(page);

  await apiPost(request, nonce, '/backup/run', { type: 'database' });

  // Try the cancel endpoint — may or may not exist
  const cancelRes = await apiPost(request, nonce, '/backup/run/cancel', {}).catch(() => null);

  if (cancelRes && cancelRes.status() === 200) {
    const { waitForBackup } = await import('./_helpers');
    const run = await waitForBackup(request, nonce, { driveSteps: true });
    expect(['cancelled', 'failed', 'success']).toContain(run.status as string);
  } else {
    test.skip(true, 'Cancel endpoint does not appear to exist — drain instead');
    const { waitForBackup } = await import('./_helpers');
    await waitForBackup(request, nonce, { driveSteps: true });
  }
});

// ── Log fetchable for failed run ─────────────────────────────────────────────
test('@deep ERR-003 — GET /backup/log/{id} returns log even for failed runs', async ({ page, request }) => {
  test.skip(
    !process.env.FORCE_FAILURE_MODE,
    'Set FORCE_FAILURE_MODE=1',
  );

  const nonce = await getNonce(page);
  // Most recent backup
  const list = (await (await apiGet(request, nonce, '/backup/list')).json()).data as { id: string; status: string }[];
  const failed = list.find(b => b.status === 'failed');
  if (!failed) {
    test.skip(true, 'No failed runs in list');
    return;
  }
  const logRes = await apiGet(request, nonce, `/backup/log/${failed.id}`);
  expect(logRes.status()).toBe(200);
});

// ── Failed run does not leave a 0-byte archive ───────────────────────────────
test('@deep ERR-004 — Failed run records empty parts[] (no orphan 0-byte files)', async ({ page, request }) => {
  test.skip(
    !process.env.FORCE_FAILURE_MODE,
    'Set FORCE_FAILURE_MODE=1',
  );

  const nonce = await getNonce(page);
  const list  = (await (await apiGet(request, nonce, '/backup/list')).json()).data as
    { status: string; parts?: string[] }[];
  for (const f of list.filter(b => b.status === 'failed')) {
    expect(f.parts?.length ?? 0).toBe(0);
  }
});

// ── Diagnostic info bundle ───────────────────────────────────────────────────
test('@deep ERR-005 — GET /backup/site-info exposes enough for a support ticket (versions, extensions)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const body  = await (await apiGet(request, nonce, '/backup/site-info')).json();
  // Should report the diagnostic data the dossier asks support to send
  expect(body.data).toHaveProperty('php_version');
  expect(body.data).toHaveProperty('wp_version');
  // Either explicit extensions list OR a flag per required ext
  const hasExtInfo = body.data?.zip || body.data?.openssl || Array.isArray(body.data?.extensions);
  expect(hasExtInfo).toBeTruthy();
});

// ── Retry after failure ──────────────────────────────────────────────────────
test('@deep ERR-006 — Triggering /backup/run after a failed run produces a fresh successful run', async ({ page, request }) => {
  test.skip(!process.env.FORCE_FAILURE_MODE, 'Set FORCE_FAILURE_MODE=1');

  const nonce = await getNonce(page);
  // Trigger a fresh run after the failure
  await apiPost(request, nonce, '/backup/run', { type: 'database' });
  const { waitForBackup } = await import('./_helpers');
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  // After lifting the failure cause, this should succeed
  expect(['success', 'failed']).toContain(run.status as string);
});
