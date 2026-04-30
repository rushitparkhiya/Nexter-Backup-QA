/**
 * 80-sync-jobs.spec.ts
 * TC308 — WP-CLI: wp nexter-backup run
 */
import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { getNonce, apiGet, BASE } from './_helpers';

// ── TC308 — WP-CLI commands ───────────────────────────────────────────────────
// NOTE: WP-CLI must be in PATH and the WP install must be at /var/www/html
// (adjust WP_PATH env var as needed).

const WP_PATH = process.env.WP_CLI_PATH ?? '/var/www/html';
const WP_CLI  = process.env.WP_CLI_BIN  ?? 'wp';

function wpCli(cmd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(
      `${WP_CLI} --path="${WP_PATH}" --allow-root ${cmd}`,
      { encoding: 'utf8', timeout: 120_000 },
    );
    return { stdout, stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      code:   err.status ?? 1,
    };
  }
}

test('@P3 TC308 — wp nexter-backup run --type=full exits 0', async ({ page }) => {
  test.skip(!process.env.WP_CLI_AVAILABLE, 'Set WP_CLI_AVAILABLE=1 when WP-CLI is installed');

  const result = wpCli('nexter-backup run --type=full');
  expect(result.code).toBe(0);
  expect(result.stdout).toMatch(/success|complete/i);
});

test('@P3 TC308 — wp nexter-backup list shows the backup just run', async ({ page, request }) => {
  test.skip(!process.env.WP_CLI_AVAILABLE, 'Set WP_CLI_AVAILABLE=1');

  const result = wpCli('nexter-backup list --format=json');
  expect(result.code).toBe(0);

  const list = JSON.parse(result.stdout) as { status: string }[];
  expect(Array.isArray(list)).toBe(true);
  expect(list.length).toBeGreaterThan(0);
  expect(list[0].status).toBe('success');
});

test('@P3 TC308 — wp nexter-backup run --type=database exits 0', async () => {
  test.skip(!process.env.WP_CLI_AVAILABLE, 'Set WP_CLI_AVAILABLE=1');

  const result = wpCli('nexter-backup run --type=database');
  expect(result.code).toBe(0);
});

test('@P3 TC308 — wp nexter-backup destinations list exits 0', async () => {
  test.skip(!process.env.WP_CLI_AVAILABLE, 'Set WP_CLI_AVAILABLE=1');

  const result = wpCli('nexter-backup destinations list --format=json');
  expect(result.code).toBe(0);
  const list = JSON.parse(result.stdout);
  expect(Array.isArray(list)).toBe(true);
});

test('@P3 TC308 — WP-CLI command is nexter-backup not nxt-backup', async () => {
  test.skip(!process.env.WP_CLI_AVAILABLE, 'Set WP_CLI_AVAILABLE=1');

  // Confirm the correct command name (the dossier abbrev. is wrong)
  const rightCmd  = wpCli('nexter-backup --info');
  const wrongCmd  = wpCli('nxt-backup --info');

  expect(rightCmd.code).toBe(0);
  expect(wrongCmd.code).not.toBe(0); // nxt-backup command should not exist
});
