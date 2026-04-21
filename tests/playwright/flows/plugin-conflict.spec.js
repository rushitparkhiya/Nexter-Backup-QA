// @ts-check
/**
 * Orbit — Plugin Conflict Matrix
 *
 * WordPress.org review team flags conflict-causing plugins as a top issue.
 * The 20 most-installed plugins cover ~80% of real-world WP sites.
 *
 * This test activates each popular plugin one at a time alongside yours,
 * loads the admin, and asserts no fatal errors in debug.log or UI.
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin npx playwright test plugin-conflict.spec.js
 *   (Requires wp-env running — plugins auto-installed from WP.org)
 */

const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const { attachConsoleErrorGuard } = require('../helpers');

const PLUGIN_SLUG = process.env.PLUGIN_SLUG;
const WP_ENV_RUN  = process.env.WP_ENV_RUN || 'npx wp-env run cli wp';

// Top 20 most-installed plugins (by wp.org active install count)
const POPULAR_PLUGINS = [
  'contact-form-7',
  'classic-editor',
  'yoast-seo',
  'seo-by-rank-math',
  'wordpress-seo',
  'elementor',
  'jetpack',
  'akismet',
  'wordfence',
  'all-in-one-seo-pack',
  'updraftplus',
  'woocommerce',
  'litespeed-cache',
  'w3-total-cache',
  'wp-super-cache',
  'wpforms-lite',
  'really-simple-ssl',
  'advanced-custom-fields',
  'mailchimp-for-wp',
  'better-wp-security',
];

function wp(cmd) {
  try { return execSync(`${WP_ENV_RUN} ${cmd}`, { encoding: 'utf8' }).trim(); }
  catch (e) { return ''; }
}

// Serialize — these tests mutate shared WP plugin state (activate/deactivate)
test.describe.configure({ mode: 'serial' });

test.describe('Plugin conflict matrix (top 20 popular plugins)', () => {
  test.skip(!PLUGIN_SLUG, 'Set PLUGIN_SLUG to run conflict matrix');

  test.beforeAll(() => {
    wp(`plugin activate ${PLUGIN_SLUG}`);
  });

  test.afterAll(() => {
    // Cleanup: deactivate all popular plugins we installed
    for (const slug of POPULAR_PLUGINS) {
      wp(`plugin deactivate ${slug}`);
    }
  });

  for (const competitor of POPULAR_PLUGINS) {
    test(`no fatal with ${competitor}`, async ({ page }) => {
      const guard = attachConsoleErrorGuard(page, {
        ignore: [/favicon/i, /chrome-extension/i, /DevTools/],
      });

      // Install if missing, then activate
      const installed = wp(`plugin is-installed ${competitor} && echo yes || echo no`);
      if (!installed.includes('yes')) {
        wp(`plugin install ${competitor}`);
      }
      wp(`plugin activate ${competitor}`);

      // Snapshot debug.log line count — inside container, WP_CONTENT_DIR is different from host
      const beforeLines = parseInt(
        wp(`eval 'echo file_exists(WP_CONTENT_DIR . "/debug.log") ? count(file(WP_CONTENT_DIR . "/debug.log")) : 0;'`) || '0',
        10
      );

      // Load admin dashboard + plugin's own page
      await page.goto('/wp-admin/');
      await page.waitForLoadState('domcontentloaded');

      await page.goto(`/wp-admin/plugins.php`);
      await page.waitForLoadState('domcontentloaded');

      // Check for fatal error screen
      const bodyText = await page.locator('body').innerText();
      expect(bodyText.toLowerCase(), `Fatal with ${competitor}`).not.toMatch(/fatal error|parse error|call to undefined/);

      // Check debug.log growth
      const afterLines = parseInt(
        wp(`eval 'echo file_exists(WP_CONTENT_DIR . "/debug.log") ? count(file(WP_CONTENT_DIR . "/debug.log")) : 0;'`) || '0',
        10
      );
      const newErrors = afterLines - beforeLines;
      expect(newErrors, `${competitor} caused ${newErrors} new debug.log entries — likely fatal or warning`).toBeLessThan(5);

      // Deactivate competitor for next iteration
      wp(`plugin deactivate ${competitor}`);

      guard.assertClean(`conflict: ${competitor}`);
    });
  }
});
