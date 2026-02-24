#!/usr/bin/env bash
# Run all test suites locally and report results.
# Usage: ./scripts/run-tests.sh [--backend] [--frontend] [--e2e] [--all]
# No flags = --all

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

RESULTS=()
OVERALL=0
FAIL_FILE="$ROOT_DIR/failed_tests.txt"
LOG_FILE="$ROOT_DIR/test_log.txt"
> "$FAIL_FILE"  # Truncate on each run
> "$LOG_FILE"   # Truncate on each run

run_backend=false
run_frontend=false
run_e2e=false

# Parse args
if [[ $# -eq 0 ]]; then
  run_backend=true
  run_frontend=true
  run_e2e=true
else
  for arg in "$@"; do
    case "$arg" in
      --backend)  run_backend=true ;;
      --frontend) run_frontend=true ;;
      --e2e)      run_e2e=true ;;
      --all)      run_backend=true; run_frontend=true; run_e2e=true ;;
      -h|--help)
        echo "Usage: $0 [--backend] [--frontend] [--e2e] [--all]"
        echo "  --backend   Run backend Jest tests (SQLite in-memory)"
        echo "  --frontend  Run frontend Angular unit tests (Chrome headless)"
        echo "  --e2e       Run Playwright E2E tests (requires backend + Postgres)"
        echo "  --all       Run all suites (default when no flags given)"
        exit 0
        ;;
      *) echo "Unknown flag: $arg"; exit 1 ;;
    esac
  done
fi

print_header() {
  local msg=""
  msg+=$'\n'"════════════════════════════════════════"$'\n'
  msg+="  $1"$'\n'
  msg+="════════════════════════════════════════"$'\n'
  echo -e "${CYAN}${BOLD}${msg}${NC}"
  echo "$msg" >> "$LOG_FILE"
}

record_result() {
  local suite="$1"
  local exit_code="$2"
  local output_file="${3:-}"
  if [[ $exit_code -eq 0 ]]; then
    RESULTS+=("${GREEN}PASS${NC}  $suite")
  else
    RESULTS+=("${RED}FAIL${NC}  $suite")
    OVERALL=1
    if [[ -n "$output_file" && -f "$output_file" ]]; then
      extract_failures "$suite" "$output_file"
    fi
  fi
}

extract_failures() {
  local suite="$1"
  local output_file="$2"
  {
    echo "================================================================================"
    echo "FAILED: $suite"
    echo "Date: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "================================================================================"
    echo ""
    sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$output_file"
    echo ""
    echo ""
  } >> "$FAIL_FILE"
}

# ── Backend Tests ──────────────────────────────────────────────
if $run_backend; then
  print_header "Backend Tests (Jest)"
  backend_out=$(mktemp)
  pushd "$BACKEND_DIR" > /dev/null
  set +e
  npm test 2>&1 | tee "$backend_out" >(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' >> "$LOG_FILE")
  backend_rc=${PIPESTATUS[0]}
  set -e
  popd > /dev/null
  record_result "Backend (Jest)" $backend_rc "$backend_out"
  rm -f "$backend_out"
fi

# ── Frontend Unit Tests ────────────────────────────────────────
if $run_frontend; then
  print_header "Frontend Unit Tests (Karma)"
  # Clear Angular cache if it has stale root-owned files (from Docker builds)
  if [[ -d "$FRONTEND_DIR/.angular/cache" ]] && ! touch "$FRONTEND_DIR/.angular/cache/.test_write" 2>/dev/null; then
    echo "Clearing stale Angular cache (permission mismatch)..."
    sudo rm -rf "$FRONTEND_DIR/.angular/cache"
  else
    rm -f "$FRONTEND_DIR/.angular/cache/.test_write" 2>/dev/null
  fi
  frontend_out=$(mktemp)
  pushd "$FRONTEND_DIR" > /dev/null
  set +e
  npx ng test --watch=false 2>&1 | tee "$frontend_out" >(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' >> "$LOG_FILE")
  frontend_rc=${PIPESTATUS[0]}
  set -e
  popd > /dev/null
  record_result "Frontend (Karma)" $frontend_rc "$frontend_out"
  rm -f "$frontend_out"
fi

# ── E2E Tests ──────────────────────────────────────────────────
if $run_e2e; then
  print_header "E2E Tests (Playwright)"

  # Check if backend is running
  if ! curl -so /dev/null "http://localhost:3000/api/auth/user/checkToken" 2>/dev/null; then
    echo -e "${YELLOW}WARNING: Backend not reachable at localhost:3000${NC}"
    echo "  E2E tests require a running backend with a Postgres database."
    echo "  Start the Docker dev environment first, then re-run."
    echo ""
    echo "WARNING: Backend not reachable at localhost:3000" >> "$LOG_FILE"
    record_result "E2E (Playwright)" 1
  else
    e2e_out=$(mktemp)
    pushd "$FRONTEND_DIR" > /dev/null
    set +e
    npx playwright test 2>&1 | tee "$e2e_out" >(sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' >> "$LOG_FILE")
    e2e_rc=${PIPESTATUS[0]}
    set -e
    popd > /dev/null
    record_result "E2E (Playwright)" $e2e_rc "$e2e_out"
    rm -f "$e2e_out"
  fi
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}  Test Results Summary${NC}"
echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
echo ""
{
  echo ""
  echo "════════════════════════════════════════"
  echo "  Test Results Summary"
  echo "════════════════════════════════════════"
  echo ""
} >> "$LOG_FILE"

for result in "${RESULTS[@]}"; do
  echo -e "  $result"
  # Strip ANSI codes for log file
  echo "  $(echo -e "$result" | sed 's/\x1b\[[0-9;]*m//g')" >> "$LOG_FILE"
done
echo ""

if [[ $OVERALL -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}All suites passed.${NC}"
  echo "  All suites passed." >> "$LOG_FILE"
  rm -f "$FAIL_FILE"  # Clean up empty file when all pass
else
  echo -e "  ${RED}${BOLD}Some suites failed.${NC}"
  echo -e "  Failure details saved to: ${YELLOW}failed_tests.txt${NC}"
  echo "  Some suites failed." >> "$LOG_FILE"
fi
echo ""

exit $OVERALL
