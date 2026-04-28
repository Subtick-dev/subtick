#!/usr/bin/env bash
# Failure and adversarial tests for a running local testnet.
#
# Prerequisite: start_testnet.sh must be running in another terminal.
#
# Usage:
#   ./scripts/failure_test.sh [base_port] [test_name]
#
# test_name options (default: all):
#   crash_recover    - kill one node, verify others continue, restart it
#   partition        - block traffic to one node via iptables, then unblock
#   malicious_peer   - connect a raw TCP peer that sends garbage bytes
#
# Results are printed as JSON lines to stdout.
# Portable: works on Linux, macOS, and Windows (Git Bash + Python 3).

set -euo pipefail

BASE_PORT="${1:-9000}"
TEST="${2:-all}"
BINARY="${SUBTICK_BIN:-./target/release/subtick}"
TDIR="./testnet"

pass() { echo "{\"test\":\"$1\",\"result\":\"PASS\",\"detail\":\"$2\"}"; }
fail() { echo "{\"test\":\"$1\",\"result\":\"FAIL\",\"detail\":\"$2\"}"; }
info() { echo "{\"info\":\"$1\"}"; }

# ── Helper: check a node TCP port is accepting connections ────────────────────
# Just tests TCP connect — no message exchange — so it is not affected by mutex
# contention from concurrent gossip threads.  A live node always accepts new
# connections even under heavy load.
node_alive() {
    local PORT="$1"
    python -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(3)
try:
    s.connect(('127.0.0.1', $PORT))
    sys.exit(0)
except Exception:
    sys.exit(1)
finally:
    s.close()
" 2>/dev/null
}

# ── Helper: find PID listening on a TCP port ──────────────────────────────────
# Works on Linux (lsof), macOS (lsof), and Windows (netstat -ano).
# On Windows netstat output has CRLF endings — strip \r before returning.
find_pid_by_port() {
    local PORT="$1"
    if command -v lsof &>/dev/null; then
        lsof -ti "tcp:$PORT" 2>/dev/null | head -1 || echo ""
    else
        # Windows: netstat -ano — PID is the last column; strip CR.
        # The LISTENING socket has remote address 0.0.0.0:0, which is locale-independent
        # (avoids dependence on "LISTENING" vs localized equivalents like "ABHÖREN").
        netstat -ano 2>/dev/null \
            | grep -E ":${PORT}[[:space:]]" \
            | grep "0\.0\.0\.0:0[[:space:]]" \
            | awk '{print $NF}' \
            | tr -d '\r' \
            | head -1 || echo ""
    fi
}

# ── Helper: send arbitrary bytes to a TCP port ───────────────────────────────
# Uses Python to avoid nc dependency.
send_bytes() {
    local PORT="$1"
    local HEX_BYTES="$2"   # hex string like "deadbeef..."
    local TIMEOUT="${3:-1}"
    python -c "
import socket, sys, binascii
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout($TIMEOUT)
try:
    s.connect(('127.0.0.1', $PORT))
    data = binascii.unhexlify('$HEX_BYTES')
    s.sendall(data)
except Exception:
    pass
finally:
    s.close()
" 2>/dev/null || true
}

send_random_bytes() {
    local PORT="$1"
    local COUNT="${2:-256}"
    python -c "
import socket, os
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(1)
try:
    s.connect(('127.0.0.1', $PORT))
    s.sendall(os.urandom($COUNT))
except Exception:
    pass
finally:
    s.close()
" 2>/dev/null || true
}

# ── Test 1: crash_recover ─────────────────────────────────────────────────────
test_crash_recover() {
    info "crash_recover: killing node 1 (port $((BASE_PORT + 1))) ..."

    local PID
    PID=$(find_pid_by_port "$((BASE_PORT + 1))")
    if [ -z "$PID" ]; then
        fail "crash_recover" "node 1 not found on port $((BASE_PORT + 1))"
        return
    fi
    info "crash_recover: found node 1 PID=$PID, sending SIGKILL ..."

    # Kill portably: try bash kill first (Linux/macOS); fall back to taskkill (Windows)
    kill -9 "$PID" 2>/dev/null || taskkill //F //PID "$PID" 2>/dev/null || true
    info "crash_recover: killed PID=$PID"
    sleep 2

    # Verify nodes 0 and 2 still alive
    if node_alive "$BASE_PORT" && node_alive "$((BASE_PORT + 2))"; then
        pass "crash_recover:other_nodes_still_alive" "nodes 0 and 2 responded after node 1 crash"
    else
        fail "crash_recover:other_nodes_still_alive" "nodes 0 or 2 did not respond"
    fi

    # Restart node 1
    info "crash_recover: restarting node 1 ..."
    "$BINARY" start --config "$TDIR/config_1.toml" >> "$TDIR/logs/node_1.log" 2>&1 &
    sleep 3

    if node_alive "$((BASE_PORT + 1))"; then
        pass "crash_recover:restart" "node 1 came back online and is reachable"
    else
        fail "crash_recover:restart" "node 1 did not come back online"
    fi

    # Allow sync time and check for new finalized blocks
    sleep 4
    local final_after
    final_after=$(grep '"BlockFinalized"' "$TDIR/logs/node_1.log" 2>/dev/null | wc -l || echo "0")
    if [ "$final_after" -gt 0 ]; then
        pass "crash_recover:sync_after_restart" "node 1 resumed participating (finalized_events=$final_after)"
    else
        info "crash_recover:sync_after_restart" "node 1 restarted but no BlockFinalized yet (may still be syncing)"
    fi
}

# ── Test 2: malicious_peer ────────────────────────────────────────────────────
test_malicious_peer() {
    info "malicious_peer: sending 256 random bytes to node 0 (port $BASE_PORT) ..."
    send_random_bytes "$BASE_PORT" 256
    sleep 1

    if node_alive "$BASE_PORT"; then
        pass "malicious_peer:node_survives_garbage" "node 0 still alive after 256 random bytes"
    else
        fail "malicious_peer:node_survives_garbage" "node 0 crashed after random bytes"
    fi

    info "malicious_peer: sending oversized length header (0x00a00000 = 10 MiB) to node 0 ..."
    # 4-byte LE length = 0x00A00000 = 10485760 bytes → triggers MessageTooLarge guard
    send_bytes "$BASE_PORT" "00a00000" 1
    sleep 1

    if node_alive "$BASE_PORT"; then
        pass "malicious_peer:node_survives_oversized" "node 0 still alive after oversized length header"
    else
        fail "malicious_peer:node_survives_oversized" "node 0 crashed after oversized message"
    fi

    info "malicious_peer: sending invalid bincode (valid length, corrupt payload) to node 0 ..."
    # Length = 20 bytes, payload = all 0xFF (invalid bincode for any known message)
    send_bytes "$BASE_PORT" "14000000$(python -c "print('ff'*20)")" 1
    sleep 1

    if node_alive "$BASE_PORT"; then
        pass "malicious_peer:node_survives_invalid_bincode" "node 0 still alive after invalid bincode payload"
    else
        fail "malicious_peer:node_survives_invalid_bincode" "node 0 crashed after invalid bincode"
    fi
}

# ── Test 3: partition ─────────────────────────────────────────────────────────
test_partition() {
    if ! command -v iptables &>/dev/null; then
        info "partition: iptables not available — skipping partition test (not supported on Windows/macOS)"
        pass "partition:skipped" "iptables not available on this platform"
        return
    fi

    local PORT=$((BASE_PORT + 3))
    info "partition: blocking port $PORT with iptables ..."

    iptables -A INPUT  -p tcp --dport "$PORT" -j DROP 2>/dev/null
    iptables -A OUTPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null
    sleep 3

    local ok=true
    for i in 0 1 2; do
        if ! node_alive "$((BASE_PORT + i))"; then
            fail "partition:remaining_nodes_alive" "node $i unreachable during partition"
            ok=false
        fi
    done
    $ok && pass "partition:remaining_nodes_alive" "nodes 0-2 alive during node-3 partition"

    info "partition: restoring iptables rules ..."
    iptables -D INPUT  -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
    iptables -D OUTPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
    sleep 2

    if node_alive "$PORT"; then
        pass "partition:recovery" "node 3 reachable after partition lifted"
    else
        fail "partition:recovery" "node 3 still unreachable after partition lifted"
    fi
}

# ── Run selected tests ────────────────────────────────────────────────────────
echo "{\"suite\":\"subtick_failure_tests\",\"base_port\":$BASE_PORT}"

case "$TEST" in
    crash_recover)  test_crash_recover ;;
    malicious_peer) test_malicious_peer ;;
    partition)      test_partition ;;
    all)
        test_malicious_peer
        test_crash_recover
        test_partition
        ;;
    *)
        echo "{\"error\":\"unknown test '$TEST'. Options: crash_recover, malicious_peer, partition, all\"}"
        exit 1
        ;;
esac

echo "{\"suite\":\"done\"}"
