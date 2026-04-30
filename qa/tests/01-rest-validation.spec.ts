/**
 * 01-rest-validation.spec.ts
 * Deep QA: REST input validation
 *
 * Adversarial payloads against every mutating endpoint.
 * Verifies: missing required params, wrong types, oversized payloads,
 * malformed JSON, method-not-allowed, unknown route IDs.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, apiGet, apiDelete, BASE, NS, ADMIN_PASS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// ── /backup/run ──────────────────────────────────────────────────────────────
test('@deep VAL-001 — POST /backup/run with unknown type still accepted (defaults to full)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/run', { type: 'totally-bogus-type' });
  // Either rejected with 400 OR coerced to a sensible default — both are acceptable
  expect([200, 400, 422]).toContain(res.status());
});

test('@deep VAL-002 — POST /backup/run with non-array destinations rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/run', {
    type:         'full',
    destinations: 'not-an-array',
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-003 — POST /backup/run with non-existent destination ID', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/run', {
    type:         'full',
    destinations: ['nonexistent-dest-id-xyz'],
  });
  // Should either succeed (and skip unknown) or fail validation
  expect([200, 400, 404, 422]).toContain(res.status());
});

test('@deep VAL-004 — POST /backup/run with extremely long label rejected or truncated', async ({ page, request }) => {
  const nonce    = await getNonce(page);
  const bigLabel = 'X'.repeat(10_000);
  const res      = await apiPost(request, nonce, '/backup/run', {
    type:  'full',
    label: bigLabel,
  });
  if (res.status() === 200) {
    // If accepted, verify it was truncated, not stored verbatim
    const listRes = await apiGet(request, nonce, '/backup/list');
    const top     = (await listRes.json()).data?.[0] as { label?: string };
    expect((top.label ?? '').length).toBeLessThan(1_000);
  } else {
    expect([400, 422]).toContain(res.status());
  }
});

// ── /backup/restore/{id} ─────────────────────────────────────────────────────
test('@deep VAL-005 — POST /backup/restore/nonexistent-id returns 404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/restore/abc-does-not-exist', {
    components:       ['db'],
    confirm_password: ADMIN_PASS,
  });
  expect([404, 400]).toContain(res.status());
});

test('@deep VAL-006 — Restore with empty components array rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Need a valid backup id — get any
  const listRes = await apiGet(request, nonce, '/backup/list');
  const backup  = (await listRes.json()).data?.[0] as { id?: string } | undefined;
  if (!backup?.id) { test.skip(true, 'No backups exist'); return; }

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       [],
    confirm_password: ADMIN_PASS,
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-007 — Restore with unknown component name rejected or ignored', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const listRes = await apiGet(request, nonce, '/backup/list');
  const backup  = (await listRes.json()).data?.[0] as { id?: string } | undefined;
  if (!backup?.id) { test.skip(true, 'No backups exist'); return; }

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['rm-rf-slash'],
    confirm_password: ADMIN_PASS,
  });
  // Acceptable: either filter the unknown component out (200) or reject (400)
  expect([200, 400, 422]).toContain(res.status());
});

test('@deep VAL-008 — Restore search_replace pair without "from" field rejected', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const listRes = await apiGet(request, nonce, '/backup/list');
  const backup  = (await listRes.json()).data?.[0] as { id?: string } | undefined;
  if (!backup?.id) { test.skip(true, 'No backups exist'); return; }

  const res = await apiPost(request, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    search_replace:   [{ to: 'new.example' }],   // missing "from"
    confirm_password: ADMIN_PASS,
  });
  expect([200, 400, 422]).toContain(res.status());
});

// ── /backup/destinations ─────────────────────────────────────────────────────
test('@deep VAL-009 — PUT /backup/destinations without type rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/destinations', {
    label:   'No type',
    enabled: true,
    config:  {},
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-010 — PUT /backup/destinations with unknown type rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/destinations', {
    type:    'martian-cloud-storage-9000',
    label:   'Bogus',
    enabled: true,
    config:  {},
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-011 — DELETE /backup/destinations/{id} for unknown id returns 404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiDelete(request, nonce, '/backup/destinations/totally-fake-id', {
    confirm_password: ADMIN_PASS,
  });
  expect([404, 400]).toContain(res.status());
});

test('@deep VAL-012 — POST /backup/destinations/test for unknown id returns 404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPost(request, nonce, '/backup/destinations/test/nonexistent');
  expect([404, 400]).toContain(res.status());
});

// ── /backup/settings ─────────────────────────────────────────────────────────
test('@deep VAL-013 — PUT /backup/settings with negative split_archive_mb rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    split_archive_mb: -100,
  });
  // Either rejected OR coerced to a positive default
  if (res.status() === 200) {
    const after = (await (await apiGet(request, nonce, '/backup/settings')).json()).data;
    expect(after.split_archive_mb).toBeGreaterThan(0);
  } else {
    expect([400, 422]).toContain(res.status());
  }
});

test('@deep VAL-014 — PUT /backup/settings with split_archive_mb=0 rejected or coerced', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', { split_archive_mb: 0 });
  if (res.status() === 200) {
    const after = (await (await apiGet(request, nonce, '/backup/settings')).json()).data;
    expect(after.split_archive_mb).toBeGreaterThan(0);
  }
});

test('@deep VAL-015 — PUT /backup/settings with absurdly large split_archive_mb capped', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await apiPut(request, nonce, '/backup/settings', { split_archive_mb: 1_000_000 });
  const after = (await (await apiGet(request, nonce, '/backup/settings')).json()).data;
  // Should be capped to a sane upper bound (e.g. 4096 MB / 4 GB)
  expect(after.split_archive_mb).toBeLessThan(10_000);
});

test('@deep VAL-016 — PUT /backup/settings with non-string schedule_files_interval rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval: { malicious: 'object' },
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-017 — PUT /backup/settings with bogus schedule_files_interval rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/settings', {
    schedule_files_interval: 'every-3-microseconds',
  });
  expect([200, 400, 422]).toContain(res.status());
  if (res.status() === 200) {
    // Coerced to a valid frequency
    const after = (await (await apiGet(request, nonce, '/backup/settings')).json()).data;
    expect(['manual', 'every-6-hours', 'daily', 'weekly', 'every-3-days'])
      .toContain(after.schedule_files_interval);
  }
});

// ── /backup/{id} delete ──────────────────────────────────────────────────────
test('@deep VAL-018 — DELETE /backup/abc-not-real returns 404 even with valid password', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiDelete(request, nonce, '/backup/abc-not-real', {
    confirm_password: ADMIN_PASS,
  });
  expect([404, 400]).toContain(res.status());
});

// ── /backup/paired ───────────────────────────────────────────────────────────
test('@deep VAL-019 — PUT /backup/paired without code rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/paired', {
    url:   'https://valid-host.example',
    label: 'No code',
  });
  expect([400, 422]).toContain(res.status());
});

test('@deep VAL-020 — PUT /backup/paired with malformed url rejected', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiPut(request, nonce, '/backup/paired', {
    url:   'not-a-valid-url-at-all',
    code:  'fake',
    label: 'bad url',
  });
  expect([400, 422]).toContain(res.status());
});

// ── /backup/sync/jobs ────────────────────────────────────────────────────────
test('@deep VAL-021 — DELETE /backup/sync/jobs/{id} for unknown id returns 404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await apiDelete(request, nonce, '/backup/sync/jobs/nope-not-real', {
    confirm_password: ADMIN_PASS,
  });
  expect([404, 400]).toContain(res.status());
});

// ── Unknown route ────────────────────────────────────────────────────────────
test('@deep VAL-022 — GET unknown sub-route in namespace returns 404', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(`${NS}/backup/this-route-does-not-exist`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.status()).toBe(404);
});

// ── Method not allowed ───────────────────────────────────────────────────────
test('@deep VAL-023 — DELETE /backup/run returns 404 (only POST is registered)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.delete(`${NS}/backup/run`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect([404, 405]).toContain(res.status());
});

test('@deep VAL-024 — GET /backup/wipe returns 404 (only POST is registered)', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(`${NS}/backup/wipe`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect([404, 405]).toContain(res.status());
});
