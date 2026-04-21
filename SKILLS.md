# Orbit — Skill Reference

> **Hard rule**: Orbit never runs surface-level analysis. Every audit, test, or
> review MUST invoke the skills defined here. See `AGENTS.md` for the
> enforcement rules Claude follows automatically.

---

## The Six Core Skills (Always Run)

These are mandatory for every Orbit audit. Run in parallel via the gauntlet.

| Skill | When | What it covers |
|-------|------|----------------|
| `/wordpress-plugin-development` | Every audit | WP coding standards, hooks, escaping, nonces, capability checks, i18n, REST API patterns |
| `/wordpress-penetration-testing` | Every audit | OWASP Top 10 for WP — XSS, CSRF, SQLi, auth bypass, path traversal, privilege escalation |
| `/performance-engineer` | Every audit | Hook weight, N+1 DB calls, blocking assets, expensive loops, autoload bloat |
| `/database-optimizer` | Every audit | Prepared statements, missing indexes, transient patterns, raw SQL, query count |
| `/accessibility-compliance-accessibility-audit` | Every audit | WCAG 2.2 AA — admin UI, block output, frontend markup, keyboard nav, color contrast |
| `/code-review-excellence` | Every audit | Code quality — dead code, complexity, error handling, type safety, readability |

---

## Add-on Skills (by Plugin Type)

Run these on top of the core 6 based on what the plugin does.

| Plugin type | Skill | What it adds |
|-------------|-------|--------------|
| UI-heavy / Elementor addon | `/antigravity-design-expert` | 44px hit areas, concentric radius, GSAP motion quality, spacing, visual polish |
| Theme / FSE plugin | `/wordpress-theme-development` | Template hierarchy, FSE, theme.json, block templates, customizer |
| WooCommerce plugin | `/wordpress-woocommerce-development` | WC hooks, gateway security, template overrides, cart/checkout safety |
| REST API / headless | `/api-security-testing` | Endpoint auth, input validation, rate limiting, CORS |
| Complex PHP / OOP | `/php-pro` | PHP 8.x patterns, typed properties, modern idioms, strict types |

---

## Output Rules

All skill output — whether from Playwright, gauntlet, or a direct skill call —
must be written to a file. Never output only to terminal.

| Skill type | Output format | Location |
|-----------|--------------|----------|
| Code audits (all 6 core) | Markdown with severity table | `reports/skill-audits/<skill>.md` |
| Playwright test run | HTML report (auto-generated) | `reports/playwright-html/index.html` |
| Playwright test run | Terminal summary | stdout (line reporter) |
| Gauntlet full run | Markdown report | `reports/qa-report-<timestamp>.md` |
| UAT flow run | HTML report with screenshots + videos | `reports/uat-report-<timestamp>.html` |
| Lighthouse | JSON + summary | `reports/lighthouse/lh-<timestamp>.json` |
| DB profile | Text | `reports/db-profile-<timestamp>.txt` |

View reports after any run:

```bash
# HTML test report
npx playwright show-report reports/playwright-html

# UAT HTML report (screenshots + videos)
open reports/uat-report-*.html

# Skill audit markdown reports
open reports/skill-audits/
```

---

## How to Install Skills

```bash
# Recommended — Antigravity CLI installer (installs to ~/.claude/skills/)
npx antigravity-awesome-skills

# Manual — clone and symlink
git clone https://github.com/VoltAgent/awesome-agent-skills ~/Claude/awesome-agent-skills
ln -sf ~/Claude/awesome-agent-skills/skills/* ~/.claude/skills/
```

Verify a skill is installed:

```bash
ls ~/.claude/skills/wordpress-plugin-development
ls ~/.claude/skills/wordpress-penetration-testing
ls ~/.claude/skills/performance-engineer
ls ~/.claude/skills/database-optimizer
ls ~/.claude/skills/accessibility-compliance-accessibility-audit
ls ~/.claude/skills/code-review-excellence
```

---

## Deduplication: Which Skill Wins

Multiple similar skills exist in the ecosystem. Use only these:

| Task | Use | Skip |
|------|-----|------|
| DB review | `/database-optimizer` | `/database`, `/database-admin`, `/database-architect` |
| Security | `/wordpress-penetration-testing` | `/security-audit`, `/security-scanning-security-sast` |
| Performance | `/performance-engineer` | `/performance-optimizer`, `/performance-profiling` |
| Code review | `/code-review-excellence` | `/code-review-ai-ai-review`, `/code-reviewer`, `/code-review-checklist` |
| E2E testing | `/playwright-skill` | `/e2e-testing`, `/playwright-java` |
| WP plugin | `/wordpress-plugin-development` | `/wordpress` (too generic) |
| Accessibility | `/accessibility-compliance-accessibility-audit` | `/accessibility-review`, `/wcag-audit-patterns` |

---

## Running Skills

### Full gauntlet (recommended)

```bash
bash scripts/gauntlet.sh --plugin /path/to/plugin --mode full
```

Runs all 6 core skills in parallel + Playwright + Lighthouse + DB profile.
Output goes to `reports/` automatically.

### Single skill

```bash
claude "/wordpress-penetration-testing Security audit /path/to/plugin — rate every finding Critical/High/Medium/Low. Output full markdown report."
```

### All 6 in parallel (manual)

```bash
P=/path/to/plugin
claude "/wordpress-plugin-development Audit $P — WP standards. Output markdown." > reports/skill-audits/wp-standards.md &
claude "/wordpress-penetration-testing Security audit $P — OWASP Top 10. Output markdown." > reports/skill-audits/security.md &
claude "/performance-engineer Analyze $P — hooks, N+1, assets. Output markdown." > reports/skill-audits/performance.md &
claude "/database-optimizer Review $P — queries, indexes, autoload. Output markdown." > reports/skill-audits/database.md &
claude "/accessibility-compliance-accessibility-audit Audit $P admin UI + frontend. Output markdown." > reports/skill-audits/a11y.md &
claude "/code-review-excellence Review $P — quality, complexity, patterns. Output markdown." > reports/skill-audits/code-quality.md &
wait
echo "All audits complete. Reports in reports/skill-audits/"
```

---

## Severity Triage

Apply this to all skill output before releasing:

| Level | Action before release |
|-------|--------------------|
| **Critical** | Block release. Fix immediately. |
| **High** | Block release. Fix in this PR. |
| **Medium** | Fix if under 30 min. Otherwise log and defer. |
| **Low / Info** | Log in tech debt. Defer. |
