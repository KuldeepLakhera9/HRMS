#!/usr/bin/env bash
set -euo pipefail

echo "=========================================================="
echo "HRMS Infrastructure Cross-Tier Firewall Matrix Test Suite"
echo "=========================================================="

PASSED=0
FAILED=0

assert_connection() {
    local SRC_NAME="$1"
    local DST_IP="$2"
    local PORT="$3"
    local EXPECTED="$4" # ALLOW or DROP

    echo -n "[FIREWALL TEST] From $SRC_NAME to $DST_IP:$PORT (Expected: $EXPECTED)... "

    if nc -z -w 2 "$DST_IP" "$PORT" >/dev/null 2>&1; then
        ACTUAL="ALLOW"
    else
        ACTUAL="DROP"
    fi

    if [ "$ACTUAL" == "$EXPECTED" ]; then
        echo "PASS"
        PASSED=$((PASSED + 1))
    else
        echo "FAIL (Got $ACTUAL)"
        FAILED=$((FAILED + 1))
    fi
}

echo "--- 1. DMZ -> App Tier ---"
# DMZ edge nodes can reach App ports 3000
assert_connection "DMZ (edge-01)" "10.10.20.21" "3000" "ALLOW"
assert_connection "DMZ (edge-02)" "10.10.20.22" "3000" "ALLOW"

echo "--- 2. App -> Data Tier (PgBouncer, Valkey) ---"
# App nodes can reach PgBouncer 6432 and Valkey 6379/26379
assert_connection "App (app-01)" "10.10.30.34" "6432" "ALLOW"
assert_connection "App (app-01)" "10.10.30.35" "6379" "ALLOW"
assert_connection "App (app-01)" "10.10.30.35" "26379" "ALLOW"

echo "--- 3. Negative Tests: Direct DMZ -> Data Tier (Must DROP) ---"
# DMZ edge nodes must NOT be able to reach PostgreSQL 5432 directly
assert_connection "DMZ (edge-01)" "10.10.30.31" "5432" "DROP"
assert_connection "DMZ (edge-01)" "10.10.30.31" "6432" "DROP"

echo "--- 4. Negative Tests: Direct App -> Internet Egress (Must DROP) ---"
# App nodes cannot reach public internet directly (e.g. 1.1.1.1:443)
assert_connection "App (app-01)" "1.1.1.1" "443" "DROP"
assert_connection "App (app-01)" "8.8.8.8" "53" "DROP"

echo "--- 5. Positive Tests: App -> Forward Proxy (Must ALLOW) ---"
# App nodes can reach Squid forward proxy on port 3128
assert_connection "App (app-01)" "10.10.50.83" "3128" "ALLOW"

echo "=========================================================="
echo "Summary: $PASSED passed, $FAILED failed."
if [ "$FAILED" -gt 0 ]; then
    echo "ERROR: Firewall matrix verification failed."
    exit 1
fi
echo "ALL FIREWALL RULES PASSED CONFORMANCE."
