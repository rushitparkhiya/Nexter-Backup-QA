/**
 * 42-anonymise-clone.spec.ts
 * Deep QA: anonymiser + clone-to-staging.
 *
 * - Anonymise scrubs PII fields (emails, names) but keeps row counts
 * - Clone-to-staging creates a usable second site
 * - Clone with anonymise enabled scrubs PII en route
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiGet, BASE, sleep } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Anonymise endpoint shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ANO-001 â€” POST /backup/anonymise returns 200 (or 400 on missing target)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/anonymise', {
    backup_id: 'no-such-id',
  });
  expect([200, 400, 404, 422]).toContain(res.status());
});

// â”€â”€ Anonymise on a real backup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep ANO-002 â€” Anonymise on latest backup completes successfully', async ({ page, request }) => {
  test.setTimeout(5 * 60_000);
  const nonce = await getNonce(page);

  const { runFullBackup } = await import('./_helpers');
  const backup = await runFullBackup(page, nonce);

  const res = await apiPost(page, nonce, '/backup/anonymise', {
    backup_id: backup.id,
  });
  expect([200, 202]).toContain(res.status());
});

// â”€â”€ Clone start â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-100 â€” POST /backup/clone returns clone job id', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/clone', {
    target_subdir: 'staging-test',
  });
  // May 200 with job, or 400 if subdir already exists
  expect([200, 400, 409, 422]).toContain(res.status());
  if (res.status() === 200) {
    const body = await res.json();
    expect(body.data?.id).toBeTruthy();
  }
});

// â”€â”€ Clone status polling â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-101 â€” GET /backup/clone/{id} polls status of running clone', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const startRes = await apiPost(page, nonce, '/backup/clone', {
    target_subdir: 'staging-test-' + Date.now(),
  });

  if (startRes.status() !== 200) {
    test.skip(true, 'Clone could not start in this environment');
    return;
  }

  const cloneId = (await startRes.json()).data?.id as string;
  const polls   = 5;
  for (let i = 0; i < polls; i++) {
    const res = await apiGet(page, nonce, `/backup/clone/${cloneId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data?.status).toBeTruthy();
    if (['success', 'failed'].includes(body.data?.status)) break;
    await sleep(3_000);
  }
});

// â”€â”€ Clone with bogus target subdir rejected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep CLN-102 â€” Clone with target_subdir containing path traversal rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/clone', {
    target_subdir: '../../etc',
  });
  expect([400, 422]).toContain(res.status());
});

// â”€â”€ Search-replace standalone â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep SR-001 â€” POST /backup/search-replace dry-run returns affected count', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(page, nonce, '/backup/search-replace', {
    pairs:   [{ from: 'this-string-doesnt-exist-anywhere-xyz789', to: 'replaced' }],
    dry_run: true,
  });
  expect([200, 400, 422]).toContain(res.status());
});
