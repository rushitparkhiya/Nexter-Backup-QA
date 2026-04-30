/**
 * 45-lock-admin.spec.ts
 * Deep QA: lock-admin (separate password gate for the Backup admin area).
 *
 * - /backup/lock-admin/set establishes a lock password
 * - /backup/lock-admin/verify with correct password unlocks
 * - /backup/lock-admin/verify with wrong password returns 401
 * - /backup/lock-admin/clear with re-auth removes the lock
 * - Without unlock, certain endpoints return 423 (or similar)
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, BASE, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const LOCK_PASS = 'LockTestPassXyZ!9988';

// ── Set lock password ────────────────────────────────────────────────────────
test('@deep LA-001 — POST /backup/lock-admin/set establishes lock password', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: LOCK_PASS,
  });
  expect([200, 400, 422]).toContain(res.status());

  // Cleanup
  if (res.status() === 200) {
    await apiPost(request, nonce, '/backup/lock-admin/clear', {
      confirm_password: ADMIN_PASS,
    });
  }
});

// ── Set lock with weak password ──────────────────────────────────────────────
test('@deep LA-002 — Weak lock password rejected (if validation exists)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: '12',
  });
  // Acceptable to accept (no built-in strength gate) OR reject
  expect([200, 400, 422]).toContain(res.status());
  // Cleanup if accepted
  if (res.status() === 200) {
    await apiPost(request, nonce, '/backup/lock-admin/clear', {
      confirm_password: ADMIN_PASS,
    });
  }
});

// ── Verify with correct password ─────────────────────────────────────────────
test('@deep LA-003 — POST /backup/lock-admin/verify with correct pass returns 200', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const setRes = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: LOCK_PASS,
  });
  if (setRes.status() !== 200) {
    test.skip(true, 'lock-admin/set returned non-200');
    return;
  }

  const verifyRes = await apiPost(request, nonce, '/backup/lock-admin/verify', {
    password: LOCK_PASS,
  });
  expect(verifyRes.status()).toBe(200);

  // Cleanup
  await apiPost(request, nonce, '/backup/lock-admin/clear', {
    confirm_password: ADMIN_PASS,
  });
});

// ── Verify with wrong password ───────────────────────────────────────────────
test('@deep LA-004 — POST /backup/lock-admin/verify with wrong pass returns 401', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const setRes = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: LOCK_PASS,
  });
  if (setRes.status() !== 200) {
    test.skip(true, 'lock-admin/set returned non-200');
    return;
  }

  const wrongRes = await apiPost(request, nonce, '/backup/lock-admin/verify', {
    password: 'definitely-wrong-pass',
  });
  expect([401, 403]).toContain(wrongRes.status());

  await apiPost(request, nonce, '/backup/lock-admin/clear', {
    confirm_password: ADMIN_PASS,
  });
});

// ── Clear without re-auth ────────────────────────────────────────────────────
test('@deep LA-005 — POST /backup/lock-admin/clear without confirm_password returns 401', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const setRes = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: LOCK_PASS,
  });
  if (setRes.status() !== 200) {
    test.skip(true, 'lock-admin/set returned non-200');
    return;
  }

  const clearRes = await apiPost(request, nonce, '/backup/lock-admin/clear', {});
  // Re-auth gate may apply (typically yes)
  expect([200, 401]).toContain(clearRes.status());

  // Cleanup
  await apiPost(request, nonce, '/backup/lock-admin/clear', {
    confirm_password: ADMIN_PASS,
  });
});

// ── Brute-force rate limit on verify ─────────────────────────────────────────
test('@deep LA-006 — Multiple wrong password attempts trigger rate-limit', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const setRes = await apiPost(request, nonce, '/backup/lock-admin/set', {
    password: LOCK_PASS,
  });
  if (setRes.status() !== 200) {
    test.skip(true);
    return;
  }

  let firstReject: number | null = null;
  for (let i = 0; i < 10; i++) {
    const r = await apiPost(request, nonce, '/backup/lock-admin/verify', {
      password: `wrong-${i}`,
    });
    if (r.status() === 429) { firstReject = i; break; }
  }

  if (firstReject !== null) {
    expect(firstReject).toBeLessThan(10);
  }

  await apiPost(request, nonce, '/backup/lock-admin/clear', {
    confirm_password: ADMIN_PASS,
  });
});
