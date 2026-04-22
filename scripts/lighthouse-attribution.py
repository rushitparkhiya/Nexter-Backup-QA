#!/usr/bin/env python3
"""
Orbit — Lighthouse Attribution
Parses a Lighthouse JSON report and maps slow resources back to your plugin's files.

Why this matters:
  Lighthouse tells you "this page has 2.3s of render-blocking scripts" but not
  which plugin caused it. This script finds resources whose URLs contain your
  plugin slug and shows their exact contribution to each Lighthouse metric.

Usage:
  python3 scripts/lighthouse-attribution.py \
    --report reports/lighthouse/lh-20240115-120000.json \
    --slug my-plugin \
    [--threshold 50]    # only show resources contributing > 50ms (default: 0)
    [--out reports/lighthouse/attribution.md]

Output:
  - Console: table of plugin resources with metric contributions
  - Markdown file: full attribution report with fix suggestions
"""

import json
import sys
import os
import argparse
import datetime
import re
from pathlib import Path

# ── Argument parsing ──────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description='Map Lighthouse findings to plugin files')
parser.add_argument('--report', required=False, help='Path to Lighthouse JSON report')
parser.add_argument('--slug', required=False, help='Plugin slug to filter resources')
parser.add_argument('--threshold', type=int, default=0, help='Min ms to include in output')
parser.add_argument('--out', required=False, help='Output markdown file path')
parser.add_argument('--plugin', required=False, help='Plugin path (to find slug if not set)')
args = parser.parse_args()

# Auto-detect from qa.config.json if args not provided
if not args.slug and os.path.exists('qa.config.json'):
    try:
        cfg = json.load(open('qa.config.json'))
        args.slug = os.path.basename(cfg.get('plugin', {}).get('path', ''))
    except Exception:
        pass

if not args.slug and args.plugin:
    args.slug = os.path.basename(args.plugin)

if not args.slug:
    print("Error: --slug required (or set plugin.path in qa.config.json)", file=sys.stderr)
    sys.exit(1)

# Auto-find latest Lighthouse report if not specified
if not args.report:
    lh_dir = Path('reports/lighthouse')
    if lh_dir.exists():
        reports = sorted(lh_dir.glob('lh-*.json'), key=lambda p: p.stat().st_mtime)
        if reports:
            args.report = str(reports[-1])
            print(f"  Using latest report: {args.report}")

if not args.report or not os.path.exists(args.report):
    print(f"Error: Lighthouse report not found. Run gauntlet first or specify --report", file=sys.stderr)
    sys.exit(1)

if not args.out:
    ts = datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
    args.out = f'reports/lighthouse/attribution-{ts}.md'

# ── Load report ───────────────────────────────────────────────────────────────

with open(args.report) as f:
    lh = json.load(f)

SLUG = args.slug
SLUG_VARIANTS = [
    SLUG,
    SLUG.replace('-', '_'),
    SLUG.replace('_', '-'),
]

def is_plugin_resource(url):
    """Returns True if the URL appears to be from this plugin."""
    url_lower = url.lower()
    return any(
        f'/plugins/{v}/' in url_lower or
        f'/plugins/{v.replace("-","_")}/' in url_lower or
        f'/{v}/' in url_lower
        for v in SLUG_VARIANTS
    )

def format_ms(ms):
    if ms is None:
        return '—'
    if ms >= 1000:
        return f'{ms/1000:.1f}s'
    return f'{int(ms)}ms'

def severity(ms):
    if ms is None:
        return 'info'
    if ms >= 1000:
        return 'high'
    if ms >= 300:
        return 'medium'
    return 'low'

# ── Parse Lighthouse audits for resource data ─────────────────────────────────

findings = []

# Core performance scores
perf_score = None
try:
    perf_score = int(lh['categories']['performance']['score'] * 100)
except Exception:
    pass

core_web_vitals = {}
for metric in ['first-contentful-paint', 'largest-contentful-paint',
               'total-blocking-time', 'cumulative-layout-shift',
               'speed-index', 'interactive']:
    try:
        audit = lh['audits'].get(metric, {})
        core_web_vitals[metric] = {
            'displayValue': audit.get('displayValue', '—'),
            'score': audit.get('score'),
            'numericValue': audit.get('numericValue'),
        }
    except Exception:
        pass

# 1. Render-blocking resources
audit = lh['audits'].get('render-blocking-resources', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        url = item.get('url', '')
        if is_plugin_resource(url):
            wasted_ms = item.get('wastedMs', 0)
            findings.append({
                'audit': 'render-blocking-resources',
                'metric': 'TBT / FCP',
                'url': url,
                'file': url.split('/')[-1].split('?')[0],
                'wasted_ms': wasted_ms,
                'severity': severity(wasted_ms),
                'fix': 'Add defer or async attribute, or move to footer. Use wp_enqueue_script() with $in_footer=true.',
            })

# 2. Unused JavaScript
audit = lh['audits'].get('unused-javascript', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        url = item.get('url', '')
        if is_plugin_resource(url):
            wasted_bytes = item.get('wastedBytes', 0)
            wasted_ms = item.get('wastedMs', wasted_bytes / 1000)  # rough estimate
            findings.append({
                'audit': 'unused-javascript',
                'metric': 'TBT / LCP',
                'url': url,
                'file': url.split('/')[-1].split('?')[0],
                'wasted_ms': wasted_ms,
                'wasted_bytes': wasted_bytes,
                'severity': severity(wasted_ms),
                'fix': f'Conditionally enqueue only on pages where plugin has output. Wasted: {wasted_bytes//1024}KB. Use wp_enqueue_script() inside is_singular() / has_block() check.',
            })

# 3. Unused CSS
audit = lh['audits'].get('unused-css-rules', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        url = item.get('url', '')
        if is_plugin_resource(url):
            wasted_bytes = item.get('wastedBytes', 0)
            wasted_ms = item.get('wastedMs', wasted_bytes / 2000)
            findings.append({
                'audit': 'unused-css-rules',
                'metric': 'FCP / LCP',
                'url': url,
                'file': url.split('/')[-1].split('?')[0],
                'wasted_ms': wasted_ms,
                'wasted_bytes': wasted_bytes,
                'severity': severity(wasted_ms),
                'fix': f'Remove unused CSS rules or conditionally load stylesheet. Wasted: {wasted_bytes//1024}KB.',
            })

# 4. Large network payloads
audit = lh['audits'].get('uses-optimized-images', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        url = item.get('url', '')
        if is_plugin_resource(url):
            wasted_bytes = item.get('wastedBytes', 0)
            findings.append({
                'audit': 'uses-optimized-images',
                'metric': 'LCP',
                'url': url,
                'file': url.split('/')[-1].split('?')[0],
                'wasted_ms': wasted_bytes / 2000,
                'wasted_bytes': wasted_bytes,
                'severity': 'medium' if wasted_bytes > 50000 else 'low',
                'fix': f'Compress image. Wasted: {wasted_bytes//1024}KB. Use WebP format.',
            })

# 5. Long main-thread tasks (script evaluation)
audit = lh['audits'].get('main-thread-tasks', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        duration = item.get('duration', 0)
        url = item.get('url', '')
        if url and is_plugin_resource(url) and duration > 50:
            findings.append({
                'audit': 'main-thread-tasks',
                'metric': 'TBT / INP',
                'url': url,
                'file': url.split('/')[-1].split('?')[0],
                'wasted_ms': duration,
                'severity': severity(duration),
                'fix': 'Break long JS tasks into smaller chunks using setTimeout / requestIdleCallback.',
            })

# 6. Third-party resources from plugin
audit = lh['audits'].get('third-party-summary', {})
if audit.get('details', {}).get('items'):
    for item in audit['details']['items']:
        entity = item.get('entity', '')
        urls = item.get('subItems', {}).get('items', [])
        for sub in urls:
            url = sub.get('url', '') if isinstance(sub, dict) else ''
            if url and is_plugin_resource(url):
                blocking = item.get('blockingTime', 0)
                findings.append({
                    'audit': 'third-party-summary',
                    'metric': 'TBT',
                    'url': url,
                    'file': url.split('//')[-1].split('/')[0],
                    'wasted_ms': blocking,
                    'severity': severity(blocking),
                    'fix': f'Third-party resource from {entity} — load after user consent or defer.',
                })

# Filter by threshold
findings = [f for f in findings if f.get('wasted_ms', 0) >= args.threshold]
findings.sort(key=lambda x: x.get('wasted_ms', 0), reverse=True)

# ── Console output ─────────────────────────────────────────────────────────────

COLORS = {
    'high':   '\033[0;31m',  # red
    'medium': '\033[1;33m',  # yellow
    'low':    '\033[0;32m',  # green
    'info':   '\033[0;36m',  # cyan
    'bold':   '\033[1m',
    'nc':     '\033[0m',
}

print(f"\n{COLORS['bold']}[ Lighthouse Attribution — {SLUG} ]{COLORS['nc']}")
print(f"  Report: {args.report}")
if perf_score is not None:
    score_color = COLORS['low'] if perf_score >= 80 else COLORS['medium'] if perf_score >= 50 else COLORS['high']
    print(f"  Performance score: {score_color}{perf_score}/100{COLORS['nc']}")

print(f"\n  Core Web Vitals:")
for metric, data in core_web_vitals.items():
    score = data.get('score')
    color = COLORS['low'] if score and score >= 0.9 else COLORS['medium'] if score and score >= 0.5 else COLORS['high']
    print(f"    {metric.replace('-', ' ').title()}: {color}{data['displayValue']}{COLORS['nc']}")

print(f"\n  Plugin resources contributing to slowness: {len(findings)}")
print()

if not findings:
    print(f"  {COLORS['low']}✓ No {SLUG} resources found in slow Lighthouse audits{COLORS['nc']}")
else:
    for f in findings:
        color = COLORS[f['severity']]
        ms_str = format_ms(f.get('wasted_ms'))
        print(f"  {color}[{f['severity'].upper()}]{COLORS['nc']} {f['file']}")
        print(f"           Audit: {f['audit']} | Metric: {f['metric']} | Impact: {ms_str}")
        print(f"           Fix:   {f['fix'][:100]}")
        if len(f['fix']) > 100:
            print(f"                  {f['fix'][100:]}")
        print()

# ── Write markdown report ──────────────────────────────────────────────────────

os.makedirs(os.path.dirname(args.out), exist_ok=True)

with open(args.out, 'w') as out:
    out.write(f"# Lighthouse Attribution Report\n")
    out.write(f"**Plugin**: {SLUG}  \n")
    out.write(f"**Generated**: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M')}  \n")
    out.write(f"**Source report**: `{args.report}`  \n\n")
    out.write("---\n\n")

    out.write("## Performance Score\n\n")
    if perf_score is not None:
        out.write(f"**Overall**: {perf_score}/100\n\n")

    out.write("## Core Web Vitals\n\n")
    out.write("| Metric | Value | Score |\n")
    out.write("|---|---|---|\n")
    for metric, data in core_web_vitals.items():
        score_label = '✓ Good' if data.get('score', 0) >= 0.9 else '⚠ Needs improvement' if data.get('score', 0) >= 0.5 else '✗ Poor'
        out.write(f"| {metric.replace('-', ' ').title()} | {data['displayValue']} | {score_label} |\n")
    out.write("\n---\n\n")

    if not findings:
        out.write(f"## Plugin Resource Attribution\n\n")
        out.write(f"✓ No `{SLUG}` resources found in Lighthouse slow audits.  \n")
        out.write("Plugin does not appear to be contributing to performance issues on this page.\n")
    else:
        out.write(f"## Plugin Resource Attribution ({len(findings)} issue(s))\n\n")
        out.write("| File | Audit | Metric | Impact | Severity |\n")
        out.write("|---|---|---|---|---|\n")
        for f in findings:
            ms_str = format_ms(f.get('wasted_ms'))
            out.write(f"| `{f['file']}` | {f['audit']} | {f['metric']} | {ms_str} | {f['severity'].upper()} |\n")

        out.write("\n---\n\n")
        out.write("## Fix Recommendations\n\n")

        for i, f in enumerate(findings, 1):
            out.write(f"### {i}. {f['file']}\n\n")
            out.write(f"- **Audit**: `{f['audit']}`\n")
            out.write(f"- **Affected metrics**: {f['metric']}\n")
            out.write(f"- **Estimated impact**: {format_ms(f.get('wasted_ms'))}\n")
            out.write(f"- **URL**: `{f['url']}`\n")
            out.write(f"- **Fix**: {f['fix']}\n\n")

    out.write("---\n")
    out.write("*Generated by Orbit — WordPress Plugin QA Framework*\n")

print(f"  Report written: {args.out}")

# Exit with non-zero if high severity findings exist
high_count = sum(1 for f in findings if f['severity'] == 'high')
if high_count > 0:
    sys.exit(2)
sys.exit(0)
