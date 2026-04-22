// @ts-check
/**
 * Orbit — Cookie & GDPR Consent Flow Testing
 *
 * What this tests:
 *   1. Cookie audit — what cookies does your plugin set? Are they documented?
 *   2. Consent-before-tracking — does the plugin fire analytics/tracking
 *      before the user has given consent?
 *   3. Third-party script loading — does the plugin load third-party JS
 *      (Google, Meta, Stripe, etc.) before consent?
 *   4. Cookie persistence — are cookies set with appropriate expiry?
 *   5. Opt-out respected — after opting out, do cookies disappear?
 *
 * Usage:
 *   PLUGIN_SLUG=my-plugin \
 *   PLUGIN_ANALYTICS_ENDPOINTS="google-analytics.com,mixpanel.com" \
 *   PLUGIN_OPT_OUT_SELECTOR=".my-plugin-opt-out-btn" \
 *   WP_TEST_URL=http://localhost:8881 \
 *   npx playwright test flows/cookie-consent.spec.js
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE         = process.env.WP_TEST_URL || 'http://localhost:8881';
const SLUG         = process.env.PLUGIN_SLUG || '';
const OPT_OUT_SEL  = process.env.PLUGIN_OPT_OUT_SELECTOR || '';
const REPORT_DIR   = 'reports/pm-ux';

// Third-party domains that are tracking/analytics — must not fire before consent
const TRACKING_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'analytics.google.com',
  'facebook.com/tr',
  'connect.facebook.net',
  'mixpanel.com',
  'hotjar.com',
  'segment.com',
  'amplitude.com',
  'posthog.com',
  'clarity.ms',
  ...( process.env.PLUGIN_ANALYTICS_ENDPOINTS || '').split(',').filter(Boolean),
];

// Known necessary cookies (no consent needed for these)
const NECESSARY_COOKIE_PATTERNS = [
  /^wordpress_/,
  /^wordpress_logged_in/,
  /^wp-settings/,
  /^woocommerce_/,
  /^PHPSESSID$/,
  /^_GRECAPTCHA$/,
];

function isNecessaryCookie(name) {
  return NECESSARY_COOKIE_PATTERNS.some(r => r.test(name));
}

test.describe('Cookie & GDPR consent', () => {
  test.skip(!SLUG, 'Set PLUGIN_SLUG to run cookie consent tests');

  test('audit all cookies set by plugin on fresh page load', async ({ page, context }) => {
    // Clear all cookies — simulate a first-time visitor
    await context.clearCookies();

    const trackingRequests = [];
    page.on('request', req => {
      const url = req.url();
      const matchedDomain = TRACKING_DOMAINS.find(d => url.includes(d));
      if (matchedDomain) {
        trackingRequests.push({ url, domain: matchedDomain, timing: Date.now() });
      }
    });

    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });

    // Get all cookies after page load (no consent given yet)
    const cookies = await context.cookies();
    const pluginCookies = cookies.filter(c =>
      c.name.toLowerCase().includes(SLUG.replace(/-/g, '_')) ||
      c.name.toLowerCase().includes(SLUG.replace(/_/g, '-'))
    );
    const nonNecessaryCookies = cookies.filter(c => !isNecessaryCookie(c.name));

    const report = {
      slug: SLUG,
      url: BASE,
      totalCookies: cookies.length,
      pluginCookies: pluginCookies.map(c => ({
        name: c.name,
        domain: c.domain,
        expiry: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session',
        secure: c.secure,
        httpOnly: c.httpOnly,
        sameSite: c.sameSite,
        necessary: isNecessaryCookie(c.name),
      })),
      nonNecessaryCookiesBeforeConsent: nonNecessaryCookies.map(c => c.name),
      trackingRequestsBeforeConsent: trackingRequests,
      issues: [],
    };

    // Check: tracking fired before consent?
    if (trackingRequests.length > 0) {
      report.issues.push({
        severity: 'high',
        issue: 'Tracking requests fired before user consent',
        detail: `${trackingRequests.length} request(s) to tracking domains: ${[...new Set(trackingRequests.map(r => r.domain))].join(', ')}`,
        gdprArticle: 'GDPR Article 6(1)(a) — consent required before processing',
        fix: 'Only fire analytics/tracking after user has given explicit consent via consent management platform',
      });
    }

    // Check: non-necessary cookies before consent?
    const nonNecessaryPluginCookies = pluginCookies.filter(c => !isNecessaryCookie(c.name));
    if (nonNecessaryPluginCookies.length > 0) {
      report.issues.push({
        severity: 'high',
        issue: 'Non-necessary cookies set before user consent',
        cookies: nonNecessaryPluginCookies.map(c => c.name),
        gdprArticle: 'GDPR Article 6 + ePrivacy Directive — consent required for non-essential cookies',
        fix: 'Defer cookie setting until after explicit user consent',
      });
    }

    // Check: cookies missing Secure flag?
    const insecureCookies = pluginCookies.filter(c => !c.secure && !c.name.startsWith('wp_'));
    if (insecureCookies.length > 0) {
      report.issues.push({
        severity: 'medium',
        issue: 'Plugin cookies missing Secure flag',
        cookies: insecureCookies.map(c => c.name),
        fix: 'Add Secure; SameSite=Strict flags when setting cookies',
      });
    }

    // Check: cookies missing SameSite?
    const missingSameSite = pluginCookies.filter(c => !c.sameSite || c.sameSite === 'None');
    if (missingSameSite.length > 0) {
      report.issues.push({
        severity: 'low',
        issue: 'Plugin cookies missing SameSite attribute',
        cookies: missingSameSite.map(c => c.name),
        fix: 'Set SameSite=Strict or SameSite=Lax on all plugin cookies',
      });
    }

    // Log results
    console.log(`\n[Cookie Audit] ${BASE}`);
    console.log(`  Total cookies: ${cookies.length}`);
    console.log(`  Plugin cookies: ${pluginCookies.length}`);
    console.log(`  Tracking requests before consent: ${trackingRequests.length}`);
    if (report.issues.length > 0) {
      console.log(`\n  Issues found: ${report.issues.length}`);
      report.issues.forEach(issue => {
        console.log(`\n  [${issue.severity.toUpperCase()}] ${issue.issue}`);
        if (issue.detail) console.log(`    ${issue.detail}`);
        console.log(`    Fix: ${issue.fix}`);
      });
    } else {
      console.log(`  ✓ No consent violations detected`);
    }

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(REPORT_DIR, 'cookie-consent.json'),
      JSON.stringify(report, null, 2)
    );
  });

  test('opt-out removes tracking cookies and stops tracking requests', async ({ page, context }) => {
    test.skip(!OPT_OUT_SEL, 'Set PLUGIN_OPT_OUT_SELECTOR to test opt-out flow');

    await context.clearCookies();
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 20000 });

    const preOptOutCookies = (await context.cookies()).map(c => c.name);

    // Click opt-out
    const optOutBtn = page.locator(OPT_OUT_SEL);
    if (await optOutBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await optOutBtn.click();
      await page.waitForLoadState('networkidle');
    }

    const postOptOutCookies = (await context.cookies()).map(c => c.name);
    const trackingAfterOptOut = [];

    page.on('request', req => {
      const url = req.url();
      if (TRACKING_DOMAINS.some(d => url.includes(d))) {
        trackingAfterOptOut.push(url);
      }
    });

    // Reload — no tracking should fire now
    await page.reload({ waitUntil: 'networkidle' });

    console.log(`\n[Opt-out Test]`);
    console.log(`  Cookies before opt-out: ${preOptOutCookies.length}`);
    console.log(`  Cookies after opt-out: ${postOptOutCookies.length}`);
    console.log(`  Tracking requests after opt-out: ${trackingAfterOptOut.length}`);

    expect(
      trackingAfterOptOut.length,
      'Tracking requests should stop after user opts out'
    ).toBe(0);
  });
});
