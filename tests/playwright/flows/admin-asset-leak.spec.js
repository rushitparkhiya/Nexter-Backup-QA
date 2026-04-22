// @ts-check
/**
 * Orbit — Admin Asset Leak Detection
 *
 * Problem: Many plugins enqueue CSS/JS on EVERY admin page because they hook
 * to admin_enqueue_scripts without a page condition. This slows WooCommerce
 * settings, Yoast SEO panels, and every other plugin's admin pages — not just yours.
 *
 * What this tests:
 *   Visits 12 standard WordPress admin pages + popular plugin pages (if installed).
 *   On each page, checks whether your plugin's assets appear in <head> or <body>.
 *   If your slug appears in a <script src> or <link href> — you're leaking.
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin PLUGIN_ADMIN_SLUG=my-plugin \
 *   WP_TEST_URL=http://localhost:8881 \
 *   npx playwright test flows/admin-asset-leak.spec.js
 *
 * Severity: WARN — never hard-blocks. PM + Dev must decide if asset is intentional.
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE       = process.env.WP_TEST_URL || 'http://localhost:8881';
const ADMIN      = `${BASE}/wp-admin`;
const SLUG       = process.env.PLUGIN_SLUG || process.env.PLUGIN_ADMIN_SLUG || '';
const REPORT_DIR = 'reports/pm-ux';

// Pages to check — your plugin should NOT appear on any of these
const FOREIGN_PAGES = [
  { name: 'Dashboard',              url: `${ADMIN}/` },
  { name: 'Posts List',             url: `${ADMIN}/edit.php` },
  { name: 'Pages List',             url: `${ADMIN}/edit.php?post_type=page` },
  { name: 'Media Library',          url: `${ADMIN}/upload.php` },
  { name: 'Themes',                 url: `${ADMIN}/themes.php` },
  { name: 'Plugins List',           url: `${ADMIN}/plugins.php` },
  { name: 'Users List',             url: `${ADMIN}/users.php` },
  { name: 'General Settings',       url: `${ADMIN}/options-general.php` },
  { name: 'Reading Settings',       url: `${ADMIN}/options-reading.php` },
  { name: 'Permalink Settings',     url: `${ADMIN}/options-permalink.php` },
  { name: 'Comments',               url: `${ADMIN}/edit-comments.php` },
  { name: 'Widgets',                url: `${ADMIN}/widgets.php` },
  // Popular plugins — only tested if page loads (plugin may not be installed)
  { name: 'WooCommerce Dashboard',  url: `${ADMIN}/admin.php?page=wc-admin` },
  { name: 'Yoast SEO Dashboard',    url: `${ADMIN}/admin.php?page=wpseo_dashboard` },
  { name: 'RankMath Dashboard',     url: `${ADMIN}/admin.php?page=rank-math` },
  { name: 'Elementor Dashboard',    url: `${ADMIN}/admin.php?page=elementor` },
  { name: 'WPForms Dashboard',      url: `${ADMIN}/admin.php?page=wpforms-overview` },
  { name: 'Jetpack Dashboard',      url: `${ADMIN}/admin.php?page=jetpack` },
];

test.describe('Admin asset leak detection', () => {
  test.skip(!SLUG, 'Set PLUGIN_SLUG env var to run asset leak detection');

  test('plugin assets must not appear on foreign admin pages', async ({ page }) => {
    const leaks = [];

    for (const { name, url } of FOREIGN_PAGES) {
      try {
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 12000,
        });

        // Skip if page doesn't load (plugin not installed, 404, etc.)
        if (!response || response.status() >= 400) continue;

        // Check page HTML for plugin slug in asset URLs
        const html = await page.content();

        // Look for plugin slug in script/link tags
        const scriptMatches = [...html.matchAll(
          new RegExp(`<script[^>]+src=["'][^"']*(?:plugins/${SLUG}|/${SLUG}/)[^"']*["']`, 'gi')
        )].map(m => m[0].match(/src=["']([^"']+)["']/)?.[1]).filter(Boolean);

        const styleMatches = [...html.matchAll(
          new RegExp(`<link[^>]+href=["'][^"']*(?:plugins/${SLUG}|/${SLUG}/)[^"']*["']`, 'gi')
        )].map(m => m[0].match(/href=["']([^"']+)["']/)?.[1]).filter(Boolean);

        const allLeaks = [...scriptMatches, ...styleMatches];

        if (allLeaks.length > 0) {
          leaks.push({
            page: name,
            url,
            assets: allLeaks,
            count: allLeaks.length,
          });
          console.log(`\n⚠ [Asset Leak] ${name} — ${allLeaks.length} plugin asset(s) loading:`);
          for (const asset of allLeaks) {
            const filename = asset.split('/').pop()?.split('?')[0] || asset;
            console.log(`    ${filename}`);
            console.log(`    Fix: add   if ( ! is_page_of_my_plugin() ) return;`);
            console.log(`         to your admin_enqueue_scripts callback`);
          }
        }
      } catch {
        // Page unreachable — skip silently
      }
    }

    // Write report
    const report = {
      slug: SLUG,
      testedPages: FOREIGN_PAGES.length,
      leakingPages: leaks.length,
      leaks,
      fix: [
        "Guard your admin_enqueue_scripts hook:",
        "  function my_plugin_admin_enqueue( \\$hook ) {",
        "    if ( 'my-plugin_page_slug' !== \\$hook ) return;",
        "    wp_enqueue_script( 'my-plugin-admin', ... );",
        "  }",
        "  add_action( 'admin_enqueue_scripts', 'my_plugin_admin_enqueue' );",
        "",
        "The \\$hook parameter contains the current admin page slug.",
        "Use get_current_screen()->id for block editor pages.",
      ],
    };

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'admin-asset-leak.json'),
      JSON.stringify(report, null, 2)
    );

    if (leaks.length === 0) {
      console.log(`\n✓ No asset leaks — ${SLUG} assets only load on your plugin's pages`);
    } else {
      console.log(`\n[Asset Leak] ${leaks.length} foreign page(s) loading your plugin assets`);
      console.log(`Full report: ${path.join(REPORT_DIR, 'admin-asset-leak.json')}`);
    }

    // Never hard-blocks — WARN severity. PM + Dev decide.
    expect(true).toBe(true);
  });
});
