# Orbit — Agent Instructions

> This file is read automatically by Claude Code. It defines which skills to
> always invoke, in what order, and under what conditions for every Orbit QA run.
> Never skip these. Surface-level or skill-free audits are not useful.

---

## Hard Rule: Always Use These Skills

When asked to run any audit, review, test, or analysis on a WordPress plugin
via Orbit — **always invoke the skills below**. Do not skip them, do not
summarize without running them, do not give surface-level output without them.

### The Six Core Orbit Skills

These six are mandatory for every full audit. Run them in parallel.

| # | Skill | What it checks |
|---|-------|----------------|
| 1 | `/wordpress-plugin-development` | WP coding standards — hooks, escaping, nonces, capability checks, i18n, naming |
| 2 | `/wordpress-penetration-testing` | OWASP Top 10 for WP — XSS, CSRF, SQLi, auth bypass, path traversal |
| 3 | `/performance-engineer` | Hook weight, N+1 DB calls, blocking assets, expensive loops |
| 4 | `/database-optimizer` | Prepared statements, autoload bloat, missing indexes, transient patterns |
| 5 | `/accessibility-compliance-accessibility-audit` | WCAG 2.2 AA — admin UI, block editor, frontend output |
| 6 | `/code-review-excellence` | Code quality — dead code, complexity, error handling, readability |

### How to Invoke

```bash
# Full audit — all 6 in parallel
claude "/wordpress-plugin-development Audit /path/to/plugin — WP standards"
claude "/wordpress-penetration-testing Security audit /path/to/plugin — OWASP Top 10"
claude "/performance-engineer Analyze /path/to/plugin — hook weight, N+1, assets"
claude "/database-optimizer Review /path/to/plugin — queries, indexes, autoload"
claude "/accessibility-compliance-accessibility-audit Check /path/to/plugin admin UI + frontend"
claude "/code-review-excellence Review /path/to/plugin — quality, complexity, patterns"
```

Or use the gauntlet (runs all 6 automatically in parallel):

```bash
bash scripts/gauntlet.sh --plugin /path/to/plugin --mode full
```

---

## Skill Selection by Plugin Type

Add these on top of the core 6 based on what the plugin is:

| Plugin type | Extra skills to add |
|-------------|-------------------|
| Elementor addon / UI-heavy | `/antigravity-design-expert` — 44px hit areas, spacing, motion |
| Theme or FSE | `/wordpress-theme-development` — template hierarchy, FSE, theme.json |
| WooCommerce plugin | `/wordpress-woocommerce-development` — WC hooks, gateway security, templates |
| REST API / headless | `/api-security-testing` — endpoint security, auth, rate limiting |
| PHP-heavy / complex logic | `/php-pro` — PHP 8.x patterns, type safety, modern idioms |

---

## Skill Deduplication Reference

When multiple skills overlap, use these and only these:

| Task | Use this | NOT these |
|------|----------|-----------|
| DB review | `/database-optimizer` | ~~`/database`~~, ~~`/database-admin`~~, ~~`/database-architect`~~ |
| Security audit | `/wordpress-penetration-testing` + `/security-auditor` | ~~`/security-audit`~~, ~~`/security-scanning-security-sast`~~ |
| Performance | `/performance-engineer` | ~~`/performance-optimizer`~~, ~~`/performance-profiling`~~ |
| Code review | `/code-review-excellence` | ~~`/code-review-ai-ai-review`~~, ~~`/code-reviewer`~~, ~~`/code-review-checklist`~~ |
| E2E tests | `/playwright-skill` + `/e2e-testing-patterns` | ~~`/e2e-testing`~~, ~~`/playwright-java`~~ |
| WP plugin | `/wordpress-plugin-development` | ~~`/wordpress`~~ (too generic) |

---

## What Never Goes in This Repo

- Plugin brand names (rankready, nexterwp, tpa, posimyth, nexter)
- Plugin-specific test configs, setup JSONs, .wp-env.json per plugin
- reports/, .auth/, test-results/ directories
- Any file referencing a live staging URL or internal credential

Plugin workspaces live locally (`~/Claude/wordpress-qa-master/<plugin-name>/`)
and are excluded from git via `.gitignore`.

---

## Severity Triage (apply to all skill output)

| Level | Action |
|-------|--------|
| Critical | Block release. Fix now. |
| High | Block release. Fix now. |
| Medium | Fix in this release if < 30 min. Otherwise log in tech debt. |
| Low / Info | Log. Defer. |
