/**
 * 00-smoke.spec.ts
 * TC001 — Plugin install + activate
 * TC002 — Open Dashboard
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiGet, BASE, NS } from './_helpers';

// ── TC001 — Plugin install + activate ────────────────────────────────────────
test('@P0 TC001 — Backup menu appears after activation', async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/`);

  // Admin sidebar must contain the Nexter Backup menu entry
  const menuLink = page.locator('#adminmenu a[href*="page=nxt-backup"]');
  await expect(menuLink).toBeVisible();
});

test('@P0 TC001 — No PHP fatal notice on activation', async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);

  // The React mount root must exist
  await expect(page.locator('#nexter-site-backup')).toBeAttached();

  // No WordPress error notices from our namespace
  const notices = page.locator('.notice-error');
  for (const notice of await notices.all()) {
    const text = await notice.textContent() ?? '';
    expect(text).not.toMatch(/nxt.?backup|nexter.?backup|NXT_BACKUP/i);
  }
});

// ── TC002 — Open Dashboard ────────────────────────────────────────────────────
test('@P0 TC002 — Dashboard loads in under 3 seconds', async ({ page }) => {
  const t0 = Date.now();
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);

  // Wait for the React app to mount and stats to load
  // The React app renders stat tiles once /backup/stats resolves
  await page.waitForResponse(
    r => r.url().includes('/nxt-backup/v1/backup/stats') && r.status() === 200,
  );
  expect(Date.now() - t0).toBeLessThan(3_000);
});

test('@P0 TC002 — Stat tiles are rendered', async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  // Wait for any stat element — look for text patterns that match the 4 tiles
  await expect(page.getByText(/total backups/i).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/total size/i).first()).toBeVisible();
  await expect(page.getByText(/disk space/i).first()).toBeVisible();
  await expect(page.getByText(/success rate/i).first()).toBeVisible();
});

test('@P0 TC002 — No console errors on dashboard load', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  await page.waitForResponse(r => r.url().includes('/nxt-backup/v1/backup/stats'));

  expect(errors).toHaveLength(0);
});

test('@P0 TC002 — /backup/stats returns 200 with expected shape', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body).toHaveProperty('data.total');
  expect(body).toHaveProperty('data.total_size');
  expect(body).toHaveProperty('data.success');
});

test('@P0 TC002 — Empty-state shows CTAs when no backups exist', async ({ page }) => {
  // This may not be reachable if backups already exist — skip if list is non-empty
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const nonce = await getNonce(page);
  const listRes = await page.evaluate(async nonce => {
    const r = await fetch('/wp-json/nxt-backup/v1/backup/list', {
      headers: { 'X-WP-Nonce': nonce },
    });
    return r.json();
  }, nonce);

  if ((listRes.data as unknown[])?.length === 0) {
    await expect(page.getByText(/pick a destination/i)).toBeVisible();
    await expect(page.getByText(/set a schedule/i)).toBeVisible();
  } else {
    test.skip();
  }
});
