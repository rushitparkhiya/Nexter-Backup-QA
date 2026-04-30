/**
 * NexterBackup QA — shared helpers
 *
 * All REST calls go through apiFetch() which attaches the WP nonce
 * and the base URL automatically. The nonce is obtained once per
 * test file via getNonce() after the admin session is loaded.
 */
import { APIRequestContext, Page, expect } from '@playwright/test';

export const BASE = process.env.WP_URL ?? 'http://localhost:8889';
export const NS   = `${BASE}/wp-json/nxt-backup/v1`;

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Returns the WP REST nonce for the currently logged-in admin session. */
export async function getNonce(page: Page): Promise<string> {
  const res = await page.evaluate(() =>
    fetch('/wp-admin/admin-ajax.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'action=rest-nonce',
    }).then(r => r.text()),
  );
  return res.trim();
}

/** Builds an Authorization-free fetch with nonce + JSON content-type. */
export function buildHeaders(nonce: string): Record<string, string> {
  return {
    'X-WP-Nonce': nonce,
    'Content-Type': 'application/json',
  };
}

// ── REST wrappers ─────────────────────────────────────────────────────────────

export async function apiGet(
  request: APIRequestContext,
  nonce: string,
  path: string,
  params?: Record<string, string>,
) {
  const url = new URL(`${NS}${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await request.get(url.toString(), {
    headers: { 'X-WP-Nonce': nonce },
  });
  return res;
}

export async function apiPost(
  request: APIRequestContext,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return request.post(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

export async function apiPut(
  request: APIRequestContext,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return request.put(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

export async function apiDelete(
  request: APIRequestContext,
  nonce: string,
  path: string,
  body?: unknown,
) {
  return request.delete(`${NS}${path}`, {
    headers: buildHeaders(nonce),
    data: body ?? {},
  });
}

// ── Backup polling ────────────────────────────────────────────────────────────

export const TERMINAL = new Set(['success', 'failed', 'cancelled']);

/**
 * Polls /backup/run/current until a terminal status.
 * Drives /backup/run/step if cron is disabled (NXT_BACKUP_TESTING=true mode).
 * Returns the final run record.
 */
export async function waitForBackup(
  request: APIRequestContext,
  nonce: string,
  opts: { driveSteps?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (opts.driveSteps) {
      await apiPost(request, nonce, '/backup/run/step');
    }
    const res  = await apiGet(request, nonce, '/backup/run/current');
    const body = await res.json() as { data?: Record<string, unknown> };
    const run  = body.data ?? {};
    if (TERMINAL.has(run.status as string)) return run;
    await sleep(2_000);
  }
  throw new Error('waitForBackup: timed out');
}

/**
 * Polls /backup/restore/run/current until terminal.
 */
export async function waitForRestore(
  request: APIRequestContext,
  nonce: string,
  opts: { driveSteps?: boolean; timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    if (opts.driveSteps) {
      await apiPost(request, nonce, '/backup/restore/run/step');
    }
    const res  = await apiGet(request, nonce, '/backup/restore/run/current');
    const body = await res.json() as { data?: Record<string, unknown> };
    const run  = body.data ?? {};
    if (TERMINAL.has(run.status as string)) return run;
    await sleep(2_000);
  }
  throw new Error('waitForRestore: timed out');
}

// ── Backup list helpers ───────────────────────────────────────────────────────

/** Returns the latest backup entry from /backup/list, or null. */
export async function latestBackup(
  request: APIRequestContext,
  nonce: string,
): Promise<Record<string, unknown> | null> {
  const res  = await apiGet(request, nonce, '/backup/list');
  const body = await res.json() as { data?: Record<string, unknown>[] };
  return body.data?.[0] ?? null;
}

/** Triggers a full backup and waits for completion. Returns the backup record. */
export async function runFullBackup(
  request: APIRequestContext,
  nonce: string,
  extraBody: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const runRes  = await apiPost(request, nonce, '/backup/run', { type: 'full', ...extraBody });
  expect(runRes.status()).toBe(200);
  const run = await waitForBackup(request, nonce, { driveSteps: true });
  expect(run.status).toBe('success');
  const backup = await latestBackup(request, nonce);
  expect(backup).not.toBeNull();
  return backup!;
}

// ── Misc ─────────────────────────────────────────────────────────────────────

export const ADMIN_USER = process.env.WP_ADMIN_USER ?? 'admin';
export const ADMIN_PASS = process.env.WP_ADMIN_PASS ?? 'password';
export const EDITOR_USER = process.env.WP_EDITOR_USER ?? 'editor_test';
export const EDITOR_PASS = process.env.WP_EDITOR_PASS ?? 'editorpass';

export function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
