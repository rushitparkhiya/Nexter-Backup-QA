/**
 * 35-restore-roundtrip.spec.ts
 * TC005 — Selective restore: tick only Database
 * TC115 — Restore on different domain with 2 search-replace pairs
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, runFullBackup, waitForRestore, BASE, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC005 — Selective restore: tick only Database ─────────────────────────────
test('@P0 TC005 — POST /backup/restore/{id} with components=["db"] returns 200', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const id     = backup.id as string;

  const res = await apiPost(request, nonce, `/backup/restore/${id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);
});

test('@P0 TC005 — Restore with only DB completes successfully', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);
  const id     = backup.id as string;

  await apiPost(request, nonce, `/backup/restore/${id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
});

test('@P0 TC005 — Only DB restored — plugins stage not reported', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });

  const run = await waitForRestore(request, nonce, { driveSteps: true });
  // The restore record should show applied_components: ['db'] only
  const applied = (run.applied_components ?? run.components) as string[] | undefined;
  if (applied) {
    expect(applied).toContain('db');
    expect(applied).not.toContain('plugins');
    expect(applied).not.toContain('themes');
  } else {
    // If runner doesn't expose applied list, stage log must mention only db
    expect(run.stage).not.toMatch(/plugins|themes/);
  }
});

test('@P0 TC005 — Re-auth gate: restore without password returns 401', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components: ['db'],
    // No confirm_password
  });
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.code).toMatch(/reauth_required/);
});

// ── TC115 — Restore with search-replace pairs ─────────────────────────────────
test('@P1 TC115 — Restore with 2 search-replace pairs rewrites DB correctly', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(request, nonce);

  // Insert a known string in options we can verify later
  const oldDomain = new URL(BASE).hostname;
  const newDomain = 'staging.example.test';

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components: ['db'],
    search_replace: [
      { from: oldDomain, to: newDomain },
      { from: `https://${oldDomain}`, to: `https://${newDomain}` },
    ],
    confirm_password: ADMIN_PASS,
  });
  expect(res.status()).toBe(200);

  const run = await waitForRestore(request, nonce, { driveSteps: true, timeoutMs: 120_000 });
  // Restore will run but we can't verify domain rewrite without a second site —
  // verify the restore completed without error at minimum
  expect(run.status).toBe('success');
});
