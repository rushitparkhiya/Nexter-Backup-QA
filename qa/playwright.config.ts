import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,          // backup tests share WP state — run serially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,              // long for backup/restore flows
  expect: { timeout: 10_000 },

  reporter: [
    ['list'],
    ['html', { outputFolder: '../reports/playwright', open: 'never' }],
  ],

  globalSetup: './tests/global.setup.ts',

  use: {
    baseURL: process.env.WP_URL ?? 'http://localhost:8889',
    storageState: '.auth/admin.json',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    extraHTTPHeaders: {
      'X-WP-Nonce': '',          // filled per-test via helpers
    },
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],

  webServer: process.env.CI
    ? {
        command: 'docker compose up --wait',
        url: 'http://localhost:8889/wp-admin/install.php',
        timeout: 120_000,
        reuseExistingServer: false,
      }
    : undefined,
});
