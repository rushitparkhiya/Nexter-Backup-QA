#!/usr/bin/env bash
# PlugOrbit — Batch parallel testing
# Runs gauntlet on N plugins simultaneously, CPU-throttled, streaming output.
# Each plugin gets its own wp-env site on a separate port.
#
# Usage:
#   bash scripts/batch-test.sh --plugins "plugin-a,plugin-b,plugin-c"
#   bash scripts/batch-test.sh --plugins-dir ~/plugins         # all subdirs
#   bash scripts/batch-test.sh --concurrency 3                 # cap parallel sites

set -e

PLUGINS=""
PLUGINS_DIR=""
CONCURRENCY=""
BASE_PORT=8881

while [[ "$#" -gt 0 ]]; do
  case $1 in
    --plugins)     PLUGINS="$2";       shift ;;
    --plugins-dir) PLUGINS_DIR="$2";   shift ;;
    --concurrency) CONCURRENCY="$2";   shift ;;
    --base-port)   BASE_PORT="$2";     shift ;;
  esac
  shift
done

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# Auto-scale concurrency to half the CPU cores (avoids burning the Mac)
if [ -z "$CONCURRENCY" ]; then
  CORES=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
  CONCURRENCY=$((CORES / 2))
  [ "$CONCURRENCY" -lt 1 ] && CONCURRENCY=1
  [ "$CONCURRENCY" -gt 4 ] && CONCURRENCY=4  # cap at 4 — 4 × (WP+DB containers) is the sweet spot
fi

# Build plugin list
PLUGIN_LIST=()
if [ -n "$PLUGINS" ]; then
  IFS=',' read -ra PLUGIN_LIST <<< "$PLUGINS"
elif [ -n "$PLUGINS_DIR" ] && [ -d "$PLUGINS_DIR" ]; then
  for d in "$PLUGINS_DIR"/*/; do
    [ -d "$d" ] && PLUGIN_LIST+=("${d%/}")
  done
else
  echo -e "${RED}Provide --plugins 'a,b,c' or --plugins-dir /path/to/plugins${NC}"
  exit 1
fi

TOTAL=${#PLUGIN_LIST[@]}
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BATCH_REPORT="reports/batch-$TIMESTAMP.md"
mkdir -p reports reports/batch-logs

echo ""
echo -e "${BOLD}PlugOrbit Batch Gauntlet${NC}"
echo "  Plugins:      $TOTAL"
echo "  Concurrency:  $CONCURRENCY  (auto-scaled to half CPU cores, capped at 4)"
echo "  Base port:    $BASE_PORT"
echo "  Report:       $BATCH_REPORT"
echo "================================================="

cat > "$BATCH_REPORT" <<EOF
# PlugOrbit Batch Report
**Date**: $(date)
**Plugins**: $TOTAL
**Concurrency**: $CONCURRENCY

| Plugin | Status | Pass | Warn | Fail | Log |
|---|---|---|---|---|---|
EOF

# Worker — runs gauntlet for one plugin on a dedicated port
run_one() {
  local PLUGIN_PATH="$1"
  local PORT="$2"
  local NAME="$(basename "$PLUGIN_PATH")"
  local LOG="reports/batch-logs/${NAME}-${TIMESTAMP}.log"
  local SITE="batch-$NAME"

  echo -e "${CYAN}[$NAME]${NC} starting on port $PORT..."

  {
    echo "=== $NAME on $PORT ==="
    bash scripts/create-test-site.sh --plugin "$PLUGIN_PATH" --port "$PORT" --site "$SITE" --mode full
    WP_TEST_URL="http://localhost:$PORT" bash scripts/gauntlet.sh --plugin "$PLUGIN_PATH"
    local EXIT=$?
    # Cleanup container to free resources
    (cd ".wp-env-site/$SITE" 2>/dev/null && wp-env stop) || true
    exit $EXIT
  } > "$LOG" 2>&1

  local STATUS=$?
  local PASS=$(grep -oP '\d+(?= passed)' "$LOG" | tail -1 || echo "?")
  local WARN=$(grep -oP '\d+(?= warning)' "$LOG" | tail -1 || echo "?")
  local FAIL=$(grep -oP '\d+(?= failed)' "$LOG" | tail -1 || echo "?")
  local STATE="✓"
  [ "$STATUS" -ne 0 ] && STATE="✗"

  echo "| $NAME | $STATE | $PASS | $WARN | $FAIL | [$NAME]($LOG) |" >> "$BATCH_REPORT"
  echo -e "[$NAME] ${STATE} done (exit $STATUS) — $LOG"
}

export -f run_one
export TIMESTAMP BATCH_REPORT

# Parallel execution with concurrency cap
INDEX=0
for PLUGIN in "${PLUGIN_LIST[@]}"; do
  PORT=$((BASE_PORT + INDEX * 10))
  run_one "$PLUGIN" "$PORT" &

  INDEX=$((INDEX + 1))
  # Throttle: wait once we hit the concurrency cap
  if (( INDEX % CONCURRENCY == 0 )); then
    wait
    echo -e "${YELLOW}--- batch checkpoint ($INDEX/$TOTAL done) ---${NC}"
  fi
done

wait   # final flush

echo ""
echo "================================================="
echo -e "${GREEN}Batch complete.${NC}"
echo "Summary: $BATCH_REPORT"
echo ""
echo "Teardown all batch sites:"
echo "  rm -rf .wp-env-site/batch-*"
echo "  docker system prune -f   # reclaim Docker disk"
