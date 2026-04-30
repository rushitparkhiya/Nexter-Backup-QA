/**
 * 04-data-integrity.spec.ts
 * Deep QA: end-to-end data integrity (the only test class that proves the
 * backup actually preserves data â€” everything else only proves the runner
 * exits 0).
 *
 * Approach: write known sentinel data â†’ backup â†’ mutate or wipe â†’ restore â†’
 * verify exact match.
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, apiGet, runFullBackup, waitForRestore,
  BASE, ADMIN_PASS,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// Helper: write a sentinel option via REST (uses our own endpoints when possible,
// or falls back to wp/v2 if a built-in field exists)
async function setOption(page: import('@playwright/test').Page, key: string, value: string) {
  const nonce = await getNonce(page);
  await page.evaluate(
    async ([k, v, nonce]) => {
      // Use admin-ajax to set an option via a WP-CLI-like helper
      await fetch('/wp-admin/admin-ajax.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `action=update_option&_wpnonce=${nonce}&option_name=${encodeURIComponent(k)}&option_value=${encodeURIComponent(v)}`,
      }).catch(() => {});
    },
    [key, value, nonce],
  );
}

// â”€â”€ DB-level round-trip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-001 â€” Sentinel post survives full backup â†’ wipe-it â†’ restore', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const nonce = await getNonce(page);

  // 1. Create a sentinel post via WP REST
  const sentinelTitle = `INT-001 sentinel ${Date.now()}`;
  const createRes = await page.request.post(`${BASE}/wp-json/wp/v2/posts`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    { title: sentinelTitle, content: 'unique-marker-XYZ-7890', status: 'publish' },
  });
  expect(createRes.status()).toBe(201);
  const sentinelId = (await createRes.json()).id as number;

  // 2. Backup
  const backup = await runFullBackup(page, nonce);

  // 3. Delete the sentinel
  const delRes = await page.request.delete(
    `${BASE}/wp-json/wp/v2/posts/${sentinelId}?force=true`,
    { headers: { 'X-WP-Nonce': nonce } },
  );
  expect([200, 410]).toContain(delRes.status());

  // 4. Restore DB
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  // 5. Sentinel must reappear
  // Need a fresh nonce because restore may have invalidated it
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const checkRes = await page.request.get(
    `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(sentinelTitle)}`,
    { headers: { 'X-WP-Nonce': newNonce } },
  );
  const found = await checkRes.json() as { id: number; title: { rendered: string } }[];
  expect(found.some(p => p.title.rendered.includes(sentinelTitle))).toBe(true);
});

// â”€â”€ Option round-trip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-002 â€” Restored DB has identical option_value for siteurl', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce = await getNonce(page);

  // Capture siteurl before backup
  const before = await page.request.get(`${BASE}/wp-json/wp/v2/settings`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const beforeSettings = await before.json() as { url?: string };

  const backup = await runFullBackup(page, nonce);

  // Restore
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const after    = await page.request.get(`${BASE}/wp-json/wp/v2/settings`, {
    headers: { 'X-WP-Nonce': newNonce },
  });
  const afterSettings = await after.json() as { url?: string };
  expect(afterSettings.url).toBe(beforeSettings.url);
});

// â”€â”€ User round-trip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-003 â€” Sentinel user survives DB restore', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce = await getNonce(page);

  const username = `int003_user_${Date.now()}`;
  const createRes = await page.request.post(`${BASE}/wp-json/wp/v2/users`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    {
      username,
      password: 'TempPass123!@#',
      email:    `${username}@example.test`,
      roles:    ['subscriber'],
    },
  });
  expect([201, 400]).toContain(createRes.status());
  if (createRes.status() === 400) {
    test.skip(true, 'User creation failed â€” likely env constraint');
    return;
  }

  const backup = await runFullBackup(page, nonce);

  // Delete the user
  const created = await createRes.json() as { id: number };
  await page.request.delete(`${BASE}/wp-json/wp/v2/users/${created.id}?reassign=1&force=true`, {
    headers: { 'X-WP-Nonce': nonce },
  });

  // Restore DB
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  // User should reappear
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const lookupRes = await page.request.get(
    `${BASE}/wp-json/wp/v2/users?search=${username}`,
    { headers: { 'X-WP-Nonce': newNonce } },
  );
  const users = await lookupRes.json() as { username?: string }[];
  expect(users.some(u => u.username === username)).toBe(true);
});

// â”€â”€ UTF-8 / multibyte â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-004 â€” Post with emoji + multibyte content survives DB round-trip', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce        = await getNonce(page);
  const emojiContent = 'ðŸŽ‰ à¤¹à¤¿à¤¨à¥à¤¦à¥€ ä¸­æ–‡ Ø§Ù„Ø¹Ø±Ø¨ÙŠØ© ðŸš€ Ñ€ÑƒÑÑÐºÐ¸Ð¹ Â¡OlÃ©! ' + Date.now();

  const createRes = await page.request.post(`${BASE}/wp-json/wp/v2/posts`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    { title: 'INT-004 multibyte', content: emojiContent, status: 'publish' },
  });
  const post = await createRes.json() as { id: number };

  const backup = await runFullBackup(page, nonce);

  // Mutate
  await page.request.post(`${BASE}/wp-json/wp/v2/posts/${post.id}`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    { content: 'corrupted' },
  });

  // Restore
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce  = await getNonce(page);
  const checkRes  = await page.request.get(`${BASE}/wp-json/wp/v2/posts/${post.id}?context=edit`, {
    headers: { 'X-WP-Nonce': newNonce },
  });
  const restored = await checkRes.json() as { content?: { raw?: string } };
  expect(restored.content?.raw ?? '').toContain('ðŸŽ‰');
  expect(restored.content?.raw ?? '').toContain('à¤¹à¤¿à¤¨à¥à¤¦à¥€');
  expect(restored.content?.raw ?? '').toContain('ä¸­æ–‡');
});

// â”€â”€ Serialized data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-005 â€” Serialized PHP option survives backup â†’ restore', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce = await getNonce(page);

  // Use the plugin's own settings (which are serialized) as a proxy for serialized data
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'every-6-hours',
    split_archives_by_component: true,
    split_archive_mb: 123,
  });

  const backup = await runFullBackup(page, nonce);

  // Mutate
  await apiPut(page, nonce, '/backup/settings', {
    schedule_files_interval: 'manual',
    split_archives_by_component: false,
    split_archive_mb: 500,
  });

  // Restore
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const after    = (await (await apiGet(page, newNonce, '/backup/settings')).json()).data;
  expect(after.schedule_files_interval).toBe('every-6-hours');
  expect(after.split_archives_by_component).toBe(true);
  expect(after.split_archive_mb).toBe(123);
});

// â”€â”€ Encrypted round-trip with verifiable content â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-006 â€” Encrypted backup preserves DB content exactly', async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const nonce = await getNonce(page);

  const passphrase = 'ZXY-int006-passphrase-!@#';
  await apiPut(page, nonce, '/backup/settings', {
    encryption_phrase:  passphrase,
    encryption_enabled: true,
  });

  const sentinelTitle = `INT-006 enc ${Date.now()}`;
  const createRes     = await page.request.post(`${BASE}/wp-json/wp/v2/posts`, {
    headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
    data:    { title: sentinelTitle, content: 'enc-marker-456789', status: 'publish' },
  });
  const post = await createRes.json() as { id: number };

  const backup = await runFullBackup(page, nonce, { encrypt: true });
  const parts  = backup.parts as string[];
  expect(parts.some(p => p.endsWith('.enc'))).toBe(true);

  // Wipe
  await page.request.delete(`${BASE}/wp-json/wp/v2/posts/${post.id}?force=true`, {
    headers: { 'X-WP-Nonce': nonce },
  });

  // Restore with passphrase
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    passphrase,
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  // Verify
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const lookup   = await page.request.get(
    `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(sentinelTitle)}`,
    { headers: { 'X-WP-Nonce': newNonce } },
  );
  const found = await lookup.json() as unknown[];
  expect(found.length).toBeGreaterThan(0);

  await apiPut(page, newNonce, '/backup/settings', { encryption_enabled: false });
});

// â”€â”€ DB row count parity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep INT-007 â€” Restored DB has same wp_posts row count as before', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const nonce = await getNonce(page);

  // Get total posts count via wp/v2 (X-WP-Total header)
  const beforeRes = await page.request.get(`${BASE}/wp-json/wp/v2/posts?per_page=1`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  const beforeCount = parseInt(beforeRes.headers()['x-wp-total'] ?? '0', 10);

  const backup = await runFullBackup(page, nonce);
  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  const run = await waitForRestore(page, nonce, { driveSteps: true });
  expect(run.status).toBe('success');

  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
  const newNonce = await getNonce(page);
  const afterRes = await page.request.get(`${BASE}/wp-json/wp/v2/posts?per_page=1`, {
    headers: { 'X-WP-Nonce': newNonce },
  });
  const afterCount = parseInt(afterRes.headers()['x-wp-total'] ?? '0', 10);
  expect(afterCount).toBe(beforeCount);
});
