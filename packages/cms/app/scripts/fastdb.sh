#!/usr/bin/env bash
# Start the local FastDB service this app uses (FASTDB_URL in .env), with its data in storage/fastdb.
# The first start creates the database and its token; the token is copied into .env as FASTDB_TOKEN.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "No .env yet: run \`pnpm sync\` first." >&2; exit 1; }
mkdir -p storage/fastdb
binary="${FASTDB_BIN:-${COSSACK_TEST_FASTDB_BIN:-fastdb}}"
command -v "$binary" >/dev/null 2>&1 || [ -x "$binary" ] || { echo "FastDB binary not found: set FASTDB_BIN to a fastdb 2.8+ executable." >&2; exit 1; }
port=$(sed -n 's|^FASTDB_URL=http://[^:]*:\([0-9]*\).*|\1|p' .env | head -1)
port="${port:-4322}"
create=()
[ -e storage/fastdb/app.fastdb ] || create=(--create)
"$binary" serve storage/fastdb/app.fastdb "${create[@]}" --port "$port" --token-file storage/fastdb/token &
server=$!
trap 'kill "$server" 2>/dev/null' INT TERM
for _ in $(seq 1 50); do [ -s storage/fastdb/token ] && break; sleep 0.2; done
if [ -s storage/fastdb/token ]; then
  token=$(tr -d '\n' < storage/fastdb/token)
  sed -i "s|^FASTDB_TOKEN=.*|FASTDB_TOKEN=$token|" .env
fi
wait "$server"
