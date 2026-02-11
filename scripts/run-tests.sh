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
  echo ""
  echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
  echo -e "${CYAN}${BOLD}  $1${NC}"
  echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
  echo ""
}

record_result() {
  local suite="$1"
  local exit_code="$2"
  if [[ $exit_code -eq 0 ]]; then
    RESULTS+=("${GREEN}PASS${NC}  $suite")
  else
    RESULTS+=("${RED}FAIL${NC}  $suite")
    OVERALL=1
  fi
}

# ── Backend Tests ──────────────────────────────────────────────
if $run_backend; then
  print_header "Backend Tests (Jest)"
  pushd "$BACKEND_DIR" > /dev/null
  set +e
  npm test 2>&1
  backend_rc=$?
  set -e
  popd > /dev/null
  record_result "Backend (Jest)" $backend_rc
fi

# ── Frontend Unit Tests ────────────────────────────────────────
if $run_frontend; then
  print_header "Frontend Unit Tests (Karma)"
  pushd "$FRONTEND_DIR" > /dev/null
  set +e
  npx ng test --watch=false 2>&1
  frontend_rc=$?
  set -e
  popd > /dev/null
  record_result "Frontend (Karma)" $frontend_rc
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
    record_result "E2E (Playwright)" 1
  else
    pushd "$FRONTEND_DIR" > /dev/null
    set +e
    npx playwright test 2>&1
    e2e_rc=$?
    set -e
    popd > /dev/null
    record_result "E2E (Playwright)" $e2e_rc
  fi
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
echo -e "${CYAN}${BOLD}  Test Results Summary${NC}"
echo -e "${CYAN}${BOLD}════════════════════════════════════════${NC}"
echo ""
for result in "${RESULTS[@]}"; do
  echo -e "  $result"
done
echo ""

if [[ $OVERALL -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}All suites passed.${NC}"
else
  echo -e "  ${RED}${BOLD}Some suites failed.${NC}"
fi
echo ""

exit $OVERALL
