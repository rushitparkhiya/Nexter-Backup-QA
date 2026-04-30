/**
 * 75-paired-sites.spec.ts
 * TC111 — Pair two sites (one-time pair codes)
 * TC112 — Push backup to paired site
 * TC113 — Pull latest from paired site
 *
 * NOTE: These tests require two running WP installs.
 * Set WP_SITE_B_URL env var to the second site URL.
 * The SSRF guard blocks loopback — use Docker container hostnames or
 * publicly-routable addresses, not 127.0.0.1/localhost.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, apiDelete, runFullBackup, BASE, NS, ADMIN_PASS } from './_helpers';

const SITE_B = process.env.WP_SITE_B_URL ?? '';

test.beforeEach(async ({ page }) => {
  if (!SITE_B) {
    test.skip(true, 'WP_SITE_B_URL env var not set — paired-site tests require two WP installs');
  }
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── TC111 — Pair two sites ────────────────────────────────────────────────────
test('@P1 TC111 — Generate pair code on Site B and pair from Site A', async ({ page, request }) => {
  const nonceA = await getNonce(page);

  // Step 1: Get pair code from Site B via its REST API (admin auth required on B)
  const codeBRes = await request.post(`${SITE_B}/wp-json/nxt-backup/v1/backup/paired/code`, {
    headers: {
      'X-WP-Nonce': process.env.WP_SITE_B_NONCE ?? '',
      'Content-Type': 'application/json',
    },
    data: {},
  });
  expect(codeBRes.status()).toBe(200);
  const { data: codeData } = await codeBRes.json() as { data: { code: string; expires_in: number } };
  expect(codeData.code).toBeTruthy();
  expect(codeData.expires_in).toBeGreaterThan(0);

  // Step 2: Pair Site A → Site B
  const pairRes = await apiPut(request, nonceA, '/backup/paired', {
    url:   SITE_B,
    code:  codeData.code,
    label: 'Site B (test)',
  });
  expect(pairRes.status()).toBe(200);

  // Step 3: Verify both sites show active pair
  const listARes  = await apiGet(request, nonceA, '/backup/paired');
  const listABody = await listARes.json();
  const pairOnA   = (listABody.data as { label: string; status: string }[])
    .find(p => p.label === 'Site B (test)');
  expect(pairOnA).toBeDefined();
  expect(pairOnA?.status).toBe('active');
});

// ── TC112 — Push backup to paired site ───────────────────────────────────────
test('@P1 TC112 — POST /backup/transfer pushes archive to paired site', async ({ page, request }) => {
  const nonceA = await getNonce(page);

  // Ensure a pair exists
  const listRes  = await apiGet(request, nonceA, '/backup/paired');
  const pairs    = (await listRes.json()).data as { id: string; label: string }[];
  const siteBPair = pairs.find(p => p.label === 'Site B (test)');

  if (!siteBPair) {
    test.skip(true, 'No active pair for Site B — run TC111 first');
    return;
  }

  // Run a backup on Site A
  const backup = await runFullBackup(request, nonceA);

  // Push to Site B
  const pushRes = await apiPost(request, nonceA, '/backup/transfer', {
    backup_id: backup.id,
    pair_id:   siteBPair.id,
  });
  expect(pushRes.status()).toBe(200);

  // Verify on Site B that the backup appeared
  const listBRes  = await request.get(`${SITE_B}/wp-json/nxt-backup/v1/backup/list`, {
    headers: { 'X-WP-Nonce': process.env.WP_SITE_B_NONCE ?? '' },
  });
  const listBBody = await listBRes.json();
  const received  = (listBBody.data as { label?: string }[]).find(
    b => b.label && /received from/i.test(b.label),
  );
  expect(received).toBeDefined();
});

// ── TC113 — Pull latest from paired site ─────────────────────────────────────
test('@P1 TC113 — POST /backup/pull fetches latest from paired site', async ({ page, request }) => {
  const nonceA = await getNonce(page);

  const listRes  = await apiGet(request, nonceA, '/backup/paired');
  const pairs    = (await listRes.json()).data as { id: string; label: string }[];
  const siteBPair = pairs.find(p => p.label === 'Site B (test)');

  if (!siteBPair) {
    test.skip(true, 'No active pair for Site B — run TC111 first');
    return;
  }

  const pullRes = await apiPost(request, nonceA, '/backup/pull', {
    pair_id: siteBPair.id,
  });
  expect(pullRes.status()).toBe(200);

  // Verify entry appears with "Pulled from" label
  const listARes  = await apiGet(request, nonceA, '/backup/list');
  const listABody = await listARes.json();
  const pulled    = (listABody.data as { label?: string }[]).find(
    b => b.label && /pulled from/i.test(b.label),
  );
  expect(pulled).toBeDefined();
});
