# Orbit — Role-by-Role Onboarding Guide

> **What this is**: A spoon-feed guide for every person on your plugin team. Find your role. Follow your section. You'll be fully operational in under 20 minutes.

---

## The One Thing Everyone Needs to Know First

Orbit is a **command-line tool**. You run scripts, they do the work, you read the reports. You don't need to understand every script — you need to know which command to run and what the output means.

The core command is:

```bash
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin-name
```

That one command runs **12 automated checks** and writes all results to a `reports/` folder. Everything else in this guide is built on top of that.

---

## One-Time Setup (Everyone Does This Once)

```bash
# 1. Clone Orbit
git clone https://github.com/adityaarsharma/orbit
cd orbit

# 2. Run the setup wizard (takes ~5 min, asks 9 questions about your plugin)
bash setup/init.sh
```

`init.sh` creates a file called `qa.config.json` in the orbit folder. That file is the brain — it remembers your plugin path, type, admin slug, and competitors so you never have to repeat them.

After setup, install all tools:

```bash
bash scripts/install-power-tools.sh
```

If Docker Desktop is not installed: download it from docker.com/products/docker-desktop — it's required for the test site.

---

## 🧑‍💻 ROLE 1: Developer

**Your job in Orbit**: Catch bugs before QA sees them. Code quality, security, static analysis, PHP compatibility.

### Your Daily Command

```bash
# Quick mode — fast iteration during development (skips DB + Lighthouse, ~2 min)
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin --mode quick
```

### Your Pre-Release Command

```bash
# Full mode — run before every release tag (~10-15 min)
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin --mode full
```

### What Each Step Means for You

| Step | What It Runs | What It Catches | Blocks Release? |
|------|-------------|----------------|----------------|
| Step 1 | `php -l` on every file | Fatal syntax errors | Yes |
| Step 1a | Header metadata check | Missing version, bad license, readme.txt mismatch | Yes |
| Step 1b | Zip hygiene | `eval()`, debug files, `error_log()` left in | Yes |
| Step 2 | PHPCS (WPCS + VIP) | Missing nonces, unescaped output, raw SQL, bad hooks | Yes |
| Step 3 | PHPStan level 5 | Undefined variables, type mismatches, dead code | Yes |
| Step 4 | Asset weight | JS/CSS bundle size — catches accidental 2MB imports | Warn |
| Step 5 | i18n / POT | Untranslated strings, wrong text-domain | Yes |

### Reading Your Output

After the gauntlet runs, open:

```bash
cat reports/qa-report-*.md
```

Look for lines starting with `✗` or `✗ FAIL`. Those block release. Lines with `⚠` are warnings — review them, don't ignore them.

### Targeted Commands (When You Don't Want the Full Gauntlet)

```bash
# Only PHP lint — fast syntax check
find ~/plugins/your-plugin -name "*.php" -exec php -l {} \; 2>&1 | grep -v "No syntax errors"

# Only PHPCS — coding standards
phpcs --standard=config/phpcs.xml ~/plugins/your-plugin

# Only PHPStan — static analysis
phpstan analyse ~/plugins/your-plugin --configuration=config/phpstan.neon

# Run DB profiling separately (needs test site running)
bash scripts/db-profile.sh
```

### Security Deep-Dive (AI-Assisted)

```bash
# Full OWASP audit via Claude Code skill
claude "/wordpress-penetration-testing Audit ~/plugins/your-plugin for all OWASP vulnerabilities. Report by severity: critical, high, medium, low."

# Check if a specific file has injection risks
claude "/wordpress-penetration-testing Check ~/plugins/your-plugin/includes/ajax-handlers.php for SQL injection and CSRF vulnerabilities"
```

### Version Comparison (Before Publishing)

```bash
# Compare what changed between two zips — security + bundle regressions
bash scripts/compare-versions.sh \
  --old ~/downloads/your-plugin-v1.3.zip \
  --new ~/downloads/your-plugin-v1.4.zip
```

### Changelog → Test Map

When you write your changelog, Orbit auto-generates what needs to be tested:

```bash
bash scripts/changelog-test.sh --changelog ~/plugins/your-plugin/CHANGELOG.md
```

Output example:
```
[NEW] Added bulk export feature
  → Test: Export button appears in admin list table
  → Test: CSV downloads with correct headers and data
  → Test: Export with 1000+ items completes without timeout

[SECURITY] Added nonce to AJAX export handler
  → Run: /wordpress-penetration-testing on includes/ajax-export.php
```

### Your Sign-Off Checklist

Before tagging a release, open:

```bash
open checklists/pre-release-checklist.md
```

You're responsible for the **Developer** section items.

---

## 🧪 ROLE 2: QA Tester

**Your job in Orbit**: Real browser. Real flows. Catch what code analysis misses — broken UI, wrong behavior, visual regressions, accessibility failures.

### Your Setup (One-Time)

You need a test WordPress site running. Create it with:

```bash
# Creates a fresh WP site in Docker with your plugin active
bash scripts/create-test-site.sh --plugin ~/plugins/your-plugin --port 8881

# Save admin login (do this once, cookies last until you destroy the site)
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/auth.setup.js --project=setup
```

Site is at: `http://localhost:8881`
Admin is at: `http://localhost:8881/wp-admin` — login: `admin` / `password`

### Your Daily Commands

```bash
# Run all Playwright tests for your plugin
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/your-plugin/

# Run with UI Mode — see exactly what the browser does (best for debugging)
npx playwright test tests/playwright/your-plugin/ --ui

# Run only one test file
npx playwright test tests/playwright/your-plugin/core.spec.js
```

### Watching Tests Run — 4 Modes

**UI Mode** (use this 90% of the time):
```bash
npx playwright test --ui
```
Opens a window with all tests listed, DOM snapshots at each step, time-travel debugger. Click any test to rerun just that one.

**Headed mode** (watch the browser):
```bash
npx playwright test --headed --slowMo=500
```
Opens a real Chrome window. `--slowMo=500` slows it down so you can follow along.

**Debug mode** (step line by line):
```bash
npx playwright test --debug
```
Opens the Playwright Inspector. Set breakpoints, step over, pick locators.

**Trace viewer** (forensic replay of a failure):
```bash
npx playwright show-trace test-results/your-test/trace.zip
```
Full replay: DOM snapshot at every action, network waterfall, console logs, screenshots.

### Reading Your Results

After a run:
```bash
# Open the visual HTML report
npx playwright show-report reports/playwright-html
```

Every failed test shows:
- Screenshot of the failure
- Video of the full run up to failure
- Trace file for step-by-step replay

### What Tests Are Already Included

| File | What It Tests |
|------|--------------|
| `tests/playwright/templates/generic-plugin/core.spec.js` | Admin page loads, no PHP errors, no JS errors, no broken images, a11y scan |
| `tests/playwright/templates/elementor-addon/` | Elementor editor loads, widget appears in panel, widget renders on page |
| `tests/playwright/templates/gutenberg-block/` | Block appears in inserter, block renders, no console errors |
| `tests/playwright/templates/seo-plugin/core.spec.js` | Side-by-side UAT comparison of two plugins |
| `tests/playwright/pm/spell-check.spec.js` | All UI text spell-checked (60 common WP typos) |
| `tests/playwright/pm/guided-ux.spec.js` | Onboarding quality score 0-10 vs competitors |
| `tests/playwright/pm/label-audit.spec.js` | Labels/buttons compared to WooCommerce, Yoast, RankMath standards |

### Adding a New Test

1. Copy the template closest to your plugin type:
   ```bash
   cp tests/playwright/templates/generic-plugin/core.spec.js \
      tests/playwright/your-plugin/core.spec.js
   ```

2. Edit the file — change the admin URL and the CSS selectors for your plugin's elements.

3. First run creates the **visual baseline** (screenshots). Every run after compares against it:
   ```bash
   # First run — creates baseline screenshots
   WP_TEST_URL=http://localhost:8881 \
   npx playwright test tests/playwright/your-plugin/ --update-snapshots

   # Subsequent runs — diffs against baseline
   WP_TEST_URL=http://localhost:8881 \
   npx playwright test tests/playwright/your-plugin/
   ```

### Responsive Testing

```bash
# Test on mobile, tablet, and desktop in parallel
npx playwright test tests/playwright/your-plugin/ \
  --project=chromium \
  --project=mobile-chrome \
  --project=tablet
```

### Your Sign-Off Checklist

```bash
open checklists/pre-release-checklist.md
```

You're responsible for the **QA** section: all Playwright tests pass, visual diffs approved, a11y score ≥ 85, no console errors.

---

## 📊 ROLE 3: Product Manager

**Your job in Orbit**: You don't run commands. You read reports and make release decisions. Orbit generates everything you need.

### What You Read After Every Release Candidate

**1. The main gauntlet report** (asks the dev or QA to run it, then opens this):
```
reports/qa-report-TIMESTAMP.md
```
Tells you: what passed, what failed, what's a warning. You decide if warnings block the release.

**2. The PM UX report** (auto-generated, opens in browser):
```bash
open reports/pm-ux/pm-ux-report-*.html
```

Contains three sections:

- **Spell-Check** — every typo in every label, button, tooltip, and notice across all plugin admin pages. Each typo shows: where it was found, what it says, what it should say.
- **Guided Experience Score** — your product scored 0–10 for how well it guides new users. Compared against Yoast SEO, RankMath, WooCommerce, WPForms, Gravity Forms, Jetpack, AIOSEO. Missing signals listed with what to add and how much score it would add.
- **Label Audit** — every label/button/option that uses non-standard terminology. Each flag shows: what the plugin says, what the industry standard is, which competitor uses the correct term.

### Asking the Team to Run the PM Checks

```bash
# They run this — you just read the HTML output
bash scripts/pm-ux-audit.sh --url http://localhost:8881 --slug your-plugin-slug
```

### Competitor Analysis Report

```bash
# Someone on the team runs this, you read the output
bash scripts/competitor-compare.sh
cat reports/competitor-*.md
```

Shows: your plugin vs each competitor on bundle size, PHPCS errors, security patterns, active installs, last updated, rating.

### Flow Map + Click-Depth Scoring

Orbit measures how many clicks it takes to reach key features (lower is better):
```
Yoast SEO: 2 clicks to main settings
Your plugin: 4 clicks to equivalent settings
```
This is in the `reports/uat-report-*.html` — look for the "Click Depth" column.

### Pre-Release Sign-Off (Your Checklist)

```bash
open checklists/pre-release-checklist.md   # PM section
open checklists/ui-ux-checklist.md         # 40-point design quality check
```

**PM rule**: if the PM UX report shows a guidance score below competitor average (currently ~8/10), it's a flag. Your call whether it blocks release or goes to backlog.

### What You Prioritize From Reports

| Report Section | PM Action |
|----------------|-----------|
| Any `✗ FAIL` line | Must be fixed before release |
| Typos found | Fix before release (1-star review risk) |
| Guidance score < 6 | Add to immediate backlog — users will churn |
| Guidance score 6–7 | Add to next sprint |
| High-severity label issues | Fix before release |
| Medium label issues | Add to backlog |
| Competitor gaps | Use for roadmap planning |

---

## 📈 ROLE 4: Product Analyst (PA)

**Your job in Orbit**: Verify analytics events fire correctly, measure performance metrics, compare data across versions and competitors.

### Verify Analytics Events Are Firing

Orbit captures every network request during Playwright runs. After a test run:

```bash
# Run tests with network capture
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/your-plugin/ --reporter=json \
  --output=reports/network-events.json
```

In your test files, you can intercept and verify specific events:

```js
// In any Playwright spec — verify an analytics event fires
const analyticsRequests = [];
page.on('request', req => {
  if (req.url().includes('analytics') || req.url().includes('tracking')) {
    analyticsRequests.push(req.url());
  }
});

await page.click('.your-feature-button');
expect(analyticsRequests.length).toBeGreaterThan(0);
```

### Performance Metrics Across Versions

```bash
# Lighthouse performance score
lighthouse http://localhost:8881 \
  --output=json \
  --output-path=reports/lighthouse/report.json \
  --chrome-flags="--headless"

# Quick score readout
lighthouse http://localhost:8881 --output=json --quiet \
  | python3 -c "import json,sys; d=json.load(sys.stdin); \
    print('Performance:', int(d['categories']['performance']['score']*100), \
    '| A11y:', int(d['categories']['accessibility']['score']*100), \
    '| SEO:', int(d['categories']['seo']['score']*100))"
```

Run this before and after a release candidate — you now have a performance delta.

### DB Query Count (Per Page)

```bash
bash scripts/db-profile.sh
cat reports/db-profile-*.txt
```

Shows: query count per URL, slow queries (>100ms), N+1 patterns. Track this number across releases — if it goes up, investigate before shipping.

### Competitor Benchmarking Data

```bash
bash scripts/competitor-compare.sh --competitors "rankmath,yoast,aioseo"
cat reports/competitor-*.md
```

Gives you structured data: version, installs, rating, bundle size, update frequency, PHPCS score. Put this in a spreadsheet and track quarterly.

### Editor Performance Data

```bash
bash scripts/editor-perf.sh
cat reports/editor-perf-*.json
```

Measures: editor ready time, widget panel load, widget-insert-to-render time, memory growth after 20 widgets. Your baseline numbers for before/after comparisons.

### Version Delta Report

```bash
bash scripts/compare-versions.sh \
  --old ~/downloads/your-plugin-v1.3.zip \
  --new ~/downloads/your-plugin-v1.4.zip
```

Side-by-side: PHPCS error count, JS bundle size (KB), CSS bundle size (KB). Charts a regression or improvement.

---

## 🎨 ROLE 5: Designer

**Your job in Orbit**: Catch visual regressions, UI quality issues, responsive breaks, accessibility failures — before users do.

### Your Setup

Same as QA — you need the test site running:

```bash
bash scripts/create-test-site.sh --plugin ~/plugins/your-plugin --port 8881
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/auth.setup.js --project=setup
```

### Your Core Command: Visual Regression

Playwright takes pixel-perfect screenshots and diffs them between runs.

```bash
# First run — creates the baseline (golden screenshots)
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/your-plugin/ --update-snapshots

# Every run after — diffs against baseline
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/your-plugin/

# View what changed (visual diff viewer)
npx playwright show-report reports/playwright-html
```

In the HTML report, failed visual tests show a **side-by-side diff**: left = baseline, middle = diff highlight (red = changed), right = current.

### What Orbit Already Checks Visually

- Every admin settings page at desktop viewport
- Every settings page at mobile (375px) — looks for horizontal scroll, stacked layouts
- Elementor editor panel (if using elementor template)
- Frontend page at desktop + mobile

### Adding a New Screenshot Baseline

In any Playwright spec file, add:

```js
// Takes a screenshot and compares on every subsequent run
await expect(page).toHaveScreenshot('my-screen-name.png', {
  maxDiffPixelRatio: 0.02  // allows 2% pixel variation (anti-aliasing etc)
});

// Screenshot of just one element (e.g. a widget in the editor)
await expect(page.locator('.elementor-widget-my-widget')).toHaveScreenshot('my-widget.png');
```

### UI Quality Audit (Beyond Pixels)

```bash
# AI-powered UI polish audit — 44px hit areas, spacing, visual weight, etc.
claude "/antigravity-design-expert Review the admin UI in ~/plugins/your-plugin/admin/ for visual polish issues. Check: hit area sizes, label alignment, spacing consistency, icon quality, empty states."

# Accessibility audit
claude "/accessibility-compliance-accessibility-audit Audit ~/plugins/your-plugin admin pages for WCAG 2.1 AA. Check: color contrast, keyboard nav, focus indicators, ARIA labels, form accessibility."
```

### Responsive Check

```bash
# Run tests at all viewports simultaneously
npx playwright test tests/playwright/your-plugin/ \
  --project=chromium \
  --project=mobile-chrome \
  --project=tablet

# What it checks at mobile (375px):
# → No horizontal scroll
# → All interactive elements ≥ 44×44px
# → No text truncation
# → No overlapping elements
```

### The UI/UX Checklist (40 Points)

```bash
open checklists/ui-ux-checklist.md
```

40-point checklist based on `make-interfaces-feel-better` principles. Goes through: spacing, typography, form design, empty states, loading states, error states, color, iconography, touch targets.

### What to Look at in the PM UX HTML Report

The label audit section is directly relevant to design:

```bash
open reports/pm-ux/pm-ux-report-*.html
```

- **Spell-check findings** — typos in the UI you designed
- **Label issues** → `all_caps_abuse`, `truncated_label`, `ambiguous_toggle` — visual design problems
- **Option ordering** — selects and radio groups with illogical order

---

## 👤 ROLE 6: End-User Tester (Beta / UAT)

**Your job in Orbit**: Walk through real user flows as if you're a first-time user. No terminal required — someone on the dev team runs the commands, you watch and give feedback.

### What You Do During a UAT Session

The team runs:
```bash
# Records videos of every user flow
WP_TEST_URL=http://localhost:8881 \
npx playwright test tests/playwright/your-plugin/ --headed --video=on
```

You watch those videos and answer: "Did the flow make sense? Did I know what to do next? Did anything feel broken or confusing?"

### What to Watch for When Reviewing Videos

1. **First-time setup** — is there a wizard, a welcome screen, any guidance? Or does the plugin dump you into a settings page with no explanation?
2. **Key task completion** — can you find the main feature without searching? How many clicks?
3. **Error messages** — if something goes wrong, does the error message tell you how to fix it?
4. **Labels** — do button names match what they actually do? Is "Submit" doing a save? Is "Config" the settings page?
5. **Option groups** — do dropdowns make sense in their current order?

### UAT Flow Report

The team generates this, you read it:

```bash
open reports/uat-report-*.html
```

Shows: side-by-side screenshots of your plugin vs a competitor doing the same task. PM analysis column explains what's better, what's worse, what to fix.

### Feedback Format (Tell the Team)

When you find something, describe it as:

```
Screen: [which admin page or flow]
What I did: [clicked X, tried to do Y]
What happened: [what the plugin showed]
What I expected: [what I thought would happen]
Severity: [confused me / annoyed me / completely blocked me]
```

---

## 📋 Full Command Reference Card

Save this. Share it. Print it.

### Setup
```bash
git clone https://github.com/adityaarsharma/orbit && cd orbit
bash setup/init.sh                          # first-time config wizard
bash scripts/install-power-tools.sh         # installs all tools
bash scripts/create-test-site.sh --plugin ~/plugins/your-plugin --port 8881
```

### Gauntlet (Full Pipeline)
```bash
bash scripts/gauntlet.sh                                      # uses qa.config.json
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin       # explicit path
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin --mode quick   # fast, skips DB+Lighthouse
bash scripts/gauntlet.sh --plugin ~/plugins/your-plugin --mode full    # everything, inc Step 12
```

### Playwright
```bash
# Save cookies (run once)
WP_TEST_URL=http://localhost:8881 npx playwright test tests/playwright/auth.setup.js --project=setup

# Run tests
WP_TEST_URL=http://localhost:8881 npx playwright test tests/playwright/your-plugin/

# Modes
npx playwright test --ui                       # interactive UI
npx playwright test --headed --slowMo=500      # watch browser
npx playwright test --debug                    # step-through debugger
npx playwright show-report reports/playwright-html   # HTML report

# Update visual baselines
WP_TEST_URL=http://localhost:8881 npx playwright test --update-snapshots
```

### PM UX Checks
```bash
bash scripts/pm-ux-audit.sh --url http://localhost:8881 --slug your-plugin-slug
open reports/pm-ux/pm-ux-report-*.html
```

### Specific Checks
```bash
bash scripts/db-profile.sh                      # DB query profiling
bash scripts/editor-perf.sh                     # Elementor/Gutenberg editor perf
bash scripts/competitor-compare.sh              # competitor analysis
bash scripts/changelog-test.sh --changelog ~/plugins/your-plugin/CHANGELOG.md
bash scripts/compare-versions.sh --old v1.3.zip --new v1.4.zip
bash scripts/scaffold-tests.sh ~/plugins/your-plugin   # auto-generate test scaffolding
```

### Claude Skill Audits
```bash
claude "/wordpress-penetration-testing Audit ~/plugins/your-plugin"
claude "/performance-engineer Find all N+1 queries in ~/plugins/your-plugin/includes/"
claude "/antigravity-design-expert Review admin UI in ~/plugins/your-plugin/admin/"
claude "/accessibility-compliance-accessibility-audit Audit ~/plugins/your-plugin"
```

### Reports
```bash
cat reports/qa-report-*.md                          # main gauntlet report
open reports/pm-ux/pm-ux-report-*.html             # PM UX report
npx playwright show-report reports/playwright-html  # Playwright HTML report
open reports/uat-report-*.html                      # UAT comparison report
cat reports/db-profile-*.txt                        # DB profiling results
cat reports/competitor-*.md                         # competitor analysis
```

### Checklists
```bash
open checklists/pre-release-checklist.md   # full sign-off (dev + QA + PM)
open checklists/ui-ux-checklist.md         # 40-point design quality
open checklists/security-checklist.md      # XSS, CSRF, SQLi, auth
open checklists/performance-checklist.md   # Core Web Vitals, assets, DB
```

---

## Who Signs Off on What — Release Gate

Before any release goes out, these three people read these three things:

| Role | Reads | Signs Off When |
|------|-------|---------------|
| **Developer** | `reports/qa-report-*.md` | Zero `✗ FAIL` lines in Steps 1–5 |
| **QA Tester** | `reports/playwright-html/index.html` | All tests pass, visual diffs approved |
| **Product Manager** | `reports/pm-ux/pm-ux-report-*.html` + `checklists/pre-release-checklist.md` | UX issues triaged, release risk acceptable |

All three sign off → ship.

---

*Orbit v2.4.0 · [github.com/adityaarsharma/orbit](https://github.com/adityaarsharma/orbit)*
