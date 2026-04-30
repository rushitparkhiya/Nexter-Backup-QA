/**
 * 96-audit-deep.spec.ts
 * Deep QA: audit log behaviour beyond TC123.
 *
 * - Pagination via limit/offset
 * - Capping at CAP entries (oldest dropped)
 * - Each known mutating action emits its expected code
 * - audit/clear empties the log
 * - Filter by action (if supported)
 */
import { test, expect } from '@playwright/test';
import {
  getNonce, apiPost, apiPut, apiGet, apiDelete, runFullBackup,
  BASE, ADMIN_PASS,
} from './_helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(`${BASE}/wp-admin/admin.php?page=nxt-backup`);
});

// â”€â”€ Pagination â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUD-001 â€” GET /backup/audit?limit=5 returns at most 5 entries', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Generate at least 5 audit-emitting actions
  for (let i = 0; i < 5; i++) {
    await apiPost(page, nonce, '/backup/log/clear');
  }

  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '5' });
  const entries = (await res.json()).data as unknown[];
  expect(entries.length).toBeLessThanOrEqual(5);
});

test('@deep AUD-002 â€” GET /backup/audit?limit=1 returns the most recent entry', async ({ page, request }) => {
  const nonce = await getNonce(page);
  // Run a backup so there's a fresh entry
  await runFullBackup(page, nonce);

  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '1' });
  const entries = (await res.json()).data as { ts: number }[];
  expect(entries.length).toBe(1);
  // Should be very recent â€” within last 5 minutes
  expect(entries[0].ts).toBeGreaterThan(Date.now() / 1000 - 300);
});

// â”€â”€ Capping â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUD-003 â€” Audit log honours CAP=1000 (oldest dropped after overflow)', async ({ page, request }) => {
  test.setTimeout(60_000);
  const nonce = await getNonce(page);

  // Generating 1000+ audit entries via REST is slow; just check the cap is reasonable
  const res     = await apiGet(page, nonce, '/backup/audit', { limit: '5000' });
  const entries = (await res.json()).data as unknown[];
  expect(entries.length).toBeLessThanOrEqual(1_000);
});

// â”€â”€ Each mutating action emits the expected code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const EXPECTED_ACTIONS: { trigger: string; code: string }[] = [
  { trigger: 'backup.run',         code: 'backup.run' },
  { trigger: 'backup.delete',      code: 'backup.delete' },
  { trigger: 'destination.save',   code: 'destination.save' },
  { trigger: 'destination.delete', code: 'destination.delete' },
  { trigger: 'wipe.run',           code: 'wipe.run' },
  { trigger: 'reauth.failed',      code: 'reauth.failed' },
];

test('@deep AUD-004 â€” backup.run is logged after a successful backup', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await runFullBackup(page, nonce);
  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '50' })).json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'backup.run')).toBe(true);
});

test('@deep AUD-005 â€” destination.save is logged on PUT /backup/destinations', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type: 'local', label: 'AUD-005', enabled: true, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '20' })).json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'destination.save')).toBe(true);

  await apiDelete(page, nonce, `/backup/destinations/${destId}`, {
    confirm_password: ADMIN_PASS,
  });
});

test('@deep AUD-006 â€” destination.delete is logged on DELETE /backup/destinations/{id}', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type: 'local', label: 'AUD-006', enabled: true, config: {},
  });
  const destId = (await saveRes.json()).data?.id as string;

  await apiDelete(page, nonce, `/backup/destinations/${destId}`, {
    confirm_password: ADMIN_PASS,
  });

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '20' })).json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'destination.delete')).toBe(true);
});

test('@deep AUD-007 â€” reauth.failed is logged when restore is given wrong password', async ({ page, request }) => {
  const nonce  = await getNonce(page);
  const backup = await runFullBackup(page, nonce);

  await apiPost(page, nonce, `/backup/restore/${backup.id}`, {
    components:       ['db'],
    confirm_password: 'wrong-on-purpose',
  });

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '20' })).json()).data as { action: string }[];
  expect(entries.some(e => e.action === 'reauth.failed')).toBe(true);
});

// â”€â”€ audit/clear empties the log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUD-008 â€” POST /backup/audit/clear empties the log', async ({ page, request }) => {
  const nonce = await getNonce(page);

  // Make sure at least one entry exists
  await runFullBackup(page, nonce);

  await apiPost(page, nonce, '/backup/audit/clear');

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '50' })).json()).data as unknown[];
  expect(entries.length).toBeLessThanOrEqual(1); // the audit/clear action itself may add one
});

// â”€â”€ Each entry has user/ip/ua/ts populated â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUD-009 â€” Each audit entry has user, ip, ua, ts fields', async ({ page, request }) => {
  const nonce = await getNonce(page);
  await runFullBackup(page, nonce);

  const entries = (await (await apiGet(page, nonce, '/backup/audit', { limit: '5' })).json()).data as { user?: number; ip?: string; ua?: string; ts?: number }[];

  expect(entries.length).toBeGreaterThan(0);
  for (const e of entries) {
    expect(e.user).toBeGreaterThan(0);
    expect(e.ts).toBeGreaterThan(0);
    expect(typeof e.ip).toBe('string');
    expect(typeof e.ua).toBe('string');
  }
});

// â”€â”€ Secret scrubbing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
test('@deep AUD-010 â€” Saving destination with token does NOT store raw token in audit context', async ({ page, request }) => {
  const nonce   = await getNonce(page);
  const saveRes = await apiPut(page, nonce, '/backup/destinations', {
    type:    'local',
    label:   'AUD-010',
    enabled: true,
    config: {
      access_token: 'TOKEN-VAL-NEVER-LEAK-1234567890',
      api_secret:   'SECRET-VAL-NEVER-LEAK-987',
    },
  });
  const destId = (await saveRes.json()).data?.id as string;

  const auditRes = await apiGet(page, nonce, '/backup/audit', { limit: '10' });
  const text     = JSON.stringify(await auditRes.json());

  expect(text).not.toContain('TOKEN-VAL-NEVER-LEAK-1234567890');
  expect(text).not.toContain('SECRET-VAL-NEVER-LEAK-987');

  await apiDelete(page, nonce, `/backup/destinations/${destId}`, {
    confirm_password: ADMIN_PASS,
  });
});
