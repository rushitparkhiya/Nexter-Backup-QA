# Changelog

All notable changes to Orbit follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

---

## [Unreleased]

---

## [2.1.0] — 2026-04-20

### Fixed (Critical — brand content in public repo)
- `setup/playground-blueprint.json` — replaced "POSIMYTH QA Test Site" with "Orbit QA Test Site" (C-01)
- `checklists/pre-release-checklist.md` — removed product-specific brand names; checklist is now generic for any WordPress plugin (C-02)
- `checklists/ui-ux-checklist.md` — removed "TPA" and "NexterWP" section headings; sections are now generic Elementor / Gutenberg (C-02)
- `scripts/gauntlet.sh` — removed hardcoded `NEXTER-VS-RANKMATH-UAT.html` reference; output now globs any `uat-report-*.html` (C-04)

### Fixed (High priority)
- `scripts/generate-uat-report.py` — `FLOW_DATA`, `RICE`, and `FEATURES` are now empty by default; all plugin-specific PM data must be supplied via the new `--flow-data <file.json>` argument (C-03 / H)
- `package.json` — replaced macOS-only `open` in `npm run uat` with cross-platform `npx open-cli` (H-01)
- `scripts/generate-uat-report.py` — `scan_pairs()` regex fixed from `(?:-\w+)?` to `(?:-[\w-]+)?` so extras with hyphens (e.g. `pair-01-dashboard-a-scroll-down.png`) are matched correctly (H-03)
- `tests/playwright/helpers.js` — `gotoAdmin()` now uses `waitForLoadState('networkidle')` + 800ms buffer instead of a fixed 2500ms `waitForTimeout` (H-04)
- `tests/playwright/helpers.js` — moved `require('path')` and `require('fs')` from mid-file to the top of the module (H-07)

### Removed
- `scripts/generate-uat-report.sh` — redundant shell wrapper around the Python script; use `python3 scripts/generate-uat-report.py` directly or `npm run uat` (H-06)

### Added
- `qa.config.example.json` — documented config schema with comments; copy to `qa.config.json` (gitignored) and fill in your plugin details (H-02)
- `setup/plugins/plugin-example.setup.json` — template for per-plugin setup files used by `setup/plugin-setup.js`
- `scripts/generate-uat-report.py --flow-data` — new CLI argument pointing to a JSON file containing `FLOW_DATA`, `RICE`, `FEATURES`, and `IA_RECS` for a specific plugin comparison

---

## [2.0.0] — 2026-04-19

### Added
- **PAIR-NN-slug-a/b naming convention** — screenshots and videos are now named `pair-NN-{slug}-{a|b}[-extra].{ext}`. The slug is the pairing key, not the index. Eliminates the index-mismatch bug where Social was shown beside Titles in the UAT report.
- `snapPair(page, pairNum, slug, side, snapDir, extra)` helper in `helpers.js` — enforces the naming contract at capture time.
- `scan_pairs()` in `generate-uat-report.py` — pairs screenshots/videos by slug instead of sequential index. Replaces the old `grp()` function.
- `afterEach` video auto-renaming hook in `tests/playwright/templates/seo-plugin/core.spec.js` — parses test title format `"PAIR-N | slug | a|b | Description"` and copies Playwright's auto-generated video to the correct `pair-NN-slug-a/b.webm` name.
- `--label-a` / `--label-b` CLI args for `generate-uat-report.py` — plugin display names are now configurable from the command line.
- `scripts/gauntlet.sh` Step 6b — auto-detects `tests/playwright/flows/*.spec.js` and runs them with `--project=video`, then calls `generate-uat-report.py`.
- `npm run uat` and `npm run uat:ci` scripts in `package.json`.
- Deep PM HTML report (`generate-uat-report.py`) with per-flow analysis, RICE backlog, IA navigation recommendations, and feature comparison table.

### Changed
- `generate-uat-report.py` rewritten to use `scan_pairs()` slug-based matching.
- `core.spec.js` template rewritten with full PAIR structure and video auto-renaming.

---

## [1.0.0] — 2026-04-17

### Added
- Initial Orbit framework: `gauntlet.sh`, Playwright setup, `helpers.js`, checklists, report generator.
