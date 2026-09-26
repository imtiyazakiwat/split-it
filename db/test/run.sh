#!/usr/bin/env bash
# Spin up a throwaway PostgreSQL cluster, apply the migrations, run the negative
# tests, and report which expected failures actually fired.
#
# Nothing touches a real database: the cluster lives in a temp dir on a private
# socket and is destroyed on exit.
#
# Usage:  db/test/run.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/splitit-pg.XXXXXX")"
PGDATA="$WORK/data"
SOCK="$WORK/sock"
PGPORT="${PGPORT:-55987}"
DB=splitit_test
LOG="$WORK/server.log"

cleanup() {
  pg_ctl -D "$PGDATA" -m immediate stop >/dev/null 2>&1
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "==> initdb ($(postgres --version))"
mkdir -p "$SOCK"
initdb -D "$PGDATA" -U postgres --no-sync -E UTF8 >/dev/null || { echo "initdb failed"; exit 1; }

echo "==> start"
pg_ctl -D "$PGDATA" -l "$LOG" -o "-k '$SOCK' -p $PGPORT -c listen_addresses='' -c fsync=off" -w start \
  >/dev/null || { echo "start failed:"; cat "$LOG"; exit 1; }

export PGHOST="$SOCK" PGPORT PGUSER=postgres
createdb "$DB" || exit 1

echo "==> apply migrations"
for f in "$ROOT"/db/migrations/*.sql; do
  printf '    %s ... ' "$(basename "$f")"
  if out=$(psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" 2>&1); then
    echo "ok"
  else
    echo "FAILED"; echo "$out"; exit 1
  fi
done

echo "==> run negative tests"
RESULTS="$WORK/results.txt"
psql -d "$DB" -f "$ROOT/db/test/invariants.sql" >"$RESULTS" 2>&1

# Each block is annotated with its expectation; count what actually happened.
# psql prefixes diagnostics with "psql:<file>:<line>: ", so anchoring on ^ERROR
# would match nothing.
errors=$(grep -c 'ERROR:' "$RESULTS" || true)
expected=$(grep -c 'EXPECT: ERROR' "$ROOT/db/test/invariants.sql" || true)

echo
echo "------------------------------------------------------------------"
grep -E '^(--- TEST|--- setup|psql:.*ERROR:|HINT:|NOTICE:)| orphaned' "$RESULTS" \
  | sed -e 's/^--- /\n/' \
        -e 's/^psql:.*ERROR:  /    rejected: /' \
        -e 's/^HINT:  /              hint: /'
echo "------------------------------------------------------------------"
echo
echo "rejections fired : $errors"
echo "rejections wanted: $expected"

if [ "$errors" -eq "$expected" ]; then
  echo "RESULT: PASS — every invariant rejected exactly what it should"
  status=0
else
  echo "RESULT: FAIL — mismatch between expected and actual rejections"
  echo
  echo "Full transcript:"
  cat "$RESULTS"
  status=1
fi

exit $status
