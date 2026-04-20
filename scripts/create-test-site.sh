#!/usr/bin/env bash
# PlugOrbit — Smart test site creator
# Auto-picks the right backend based on what the user is doing:
#
#   --mode quick    → wp-now    (10s startup, SQLite, ideal for rapid smoke tests)
#   --mode full     → wp-env    (45s startup, real MariaDB, required for DB profiling + Lighthouse + scale)
#   --mode auto     → decides by presence of Docker + gauntlet intent (DEFAULT)
#
# Usage:
#   bash scripts/create-test-site.sh                          # auto-detect
#   bash scripts/create-test-site.sh --plugin /path --port 8881
#   bash scripts/create-test-site.sh --mode full --plugin /path
#   bash scripts/create-test-site.sh --mode quick --plugin /path

set -e

PLUGIN_PATH=""
PORT="8881"
MODE="auto"
SITE_NAME="default"

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --plugin) PLUGIN_PATH="$2"; shift ;;
    --port)   PORT="$2";        shift ;;
    --mode)   MODE="$2";        shift ;;
    --site)   SITE_NAME="$2";   shift ;;
  esac
  shift
done

if [ -z "$PLUGIN_PATH" ] && [ -f "qa.config.json" ]; then
  PLUGIN_PATH=$(python3 -c "import json; print(json.load(open('qa.config.json'))['plugin']['path'])")
fi

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

[ -z "$PLUGIN_PATH" ] || [ ! -d "$PLUGIN_PATH" ] && {
  echo -e "${RED}Plugin path not found: $PLUGIN_PATH${NC}"
  exit 1
}

# ── Auto-detect mode ──────────────────────────────────────────────────────────
if [ "$MODE" = "auto" ]; then
  if command -v docker &>/dev/null && docker info &>/dev/null 2>&1; then
    MODE="full"
    echo -e "${CYAN}Auto: Docker detected → using wp-env (real MariaDB + full gauntlet support)${NC}"
  else
    MODE="quick"
    echo -e "${YELLOW}Auto: Docker not running → using wp-now (quick mode, SQLite)${NC}"
    echo -e "${YELLOW}For full DB profiling + Lighthouse at scale, install Docker and re-run.${NC}"
  fi
  echo ""
fi

# ── wp-now path (quick mode) ──────────────────────────────────────────────────
if [ "$MODE" = "quick" ]; then
  command -v wp-now &>/dev/null || {
    echo "Installing wp-now (one-time)..."
    npm install -g @wp-now/wp-now
  }
  echo -e "${BOLD}Quick mode — wp-now${NC}"
  echo "  Plugin: $PLUGIN_PATH | Port: $PORT"
  cd "$PLUGIN_PATH"
  echo -e "${GREEN}Starting (Ctrl+C to stop)...${NC}"
  wp-now start --port="$PORT" --php=8.2 --wp=latest
  exit 0
fi

# ── wp-env path (full mode — real DB, real PHP) ──────────────────────────────
if [ "$MODE" = "full" ]; then
  command -v wp-env &>/dev/null || {
    echo "Installing wp-env (one-time)..."
    npm install -g @wordpress/env
  }

  if ! docker info &>/dev/null 2>&1; then
    echo -e "${RED}Docker Desktop not running. Start it, then re-run this script.${NC}"
    exit 1
  fi

  SITE_DIR=".wp-env-site/$SITE_NAME"
  mkdir -p "$SITE_DIR"
  cd "$SITE_DIR"

  cat > .wp-env.json <<EOF
{
  "core": "WordPress/WordPress#trunk",
  "plugins": [
    "$PLUGIN_PATH",
    "https://downloads.wordpress.org/plugin/query-monitor.zip"
  ],
  "port": $PORT,
  "testsPort": $((PORT + 100)),
  "config": {
    "WP_DEBUG": true,
    "WP_DEBUG_LOG": true,
    "WP_DEBUG_DISPLAY": false,
    "SAVEQUERIES": true,
    "SCRIPT_DEBUG": true
  }
}
EOF

  echo -e "${BOLD}Full mode — wp-env (Docker + MariaDB)${NC}"
  echo "  Plugin: $PLUGIN_PATH | Port: $PORT | Site: $SITE_NAME"
  echo ""
  wp-env start

  echo ""
  echo -e "${GREEN}✓ Site:${NC}   http://localhost:$PORT"
  echo -e "${GREEN}✓ Admin:${NC}  http://localhost:$PORT/wp-admin  (admin / password)"
  echo -e "${GREEN}✓ MySQL:${NC}  cd $SITE_DIR && wp-env run cli wp db cli"
  echo ""
  echo "Lifecycle (from $SITE_DIR):"
  echo "  wp-env stop | start | destroy | clean all"
  exit 0
fi

echo -e "${RED}Unknown mode: $MODE${NC}"
exit 1
