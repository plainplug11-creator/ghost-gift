#!/usr/bin/env bash
# Operator tool for Ghost Gift bot admin access (remote D1 via wrangler; needs `wrangler login`).
#
#   scripts/promote-admin.sh list            # pending /admin requests (tg id, username, name, time)
#   scripts/promote-admin.sh list-all        # all requests incl. promoted/dismissed
#   scripts/promote-admin.sh current         # who is admin now
#   scripts/promote-admin.sh promote <tg_id> # make that Telegram user the bot admin (replaces the current one)
#   scripts/promote-admin.sh dismiss <tg_id> # mark a request as dismissed
#
# Users create a request by sending /admin to the bot (reply: "Запрос отправлен").
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${GG_D1_NAME:-ghost-gift}"
d1() { npx wrangler d1 execute "$DB" --remote --command "$1" "${@:2}"; }
COLS="tg_id, username, first_name, attempts, status, datetime(requested_at / 1000, 'unixepoch', '+2 hours') AS requested_kyiv"

case "${1:-list}" in
  list)     d1 "SELECT $COLS FROM admin_requests WHERE status = 'pending' ORDER BY requested_at DESC LIMIT 50;" ;;
  list-all) d1 "SELECT $COLS FROM admin_requests ORDER BY requested_at DESC LIMIT 100;" ;;
  current)  d1 "SELECT value AS admin_tg_id FROM settings WHERE key = 'admin_id';" ;;
  promote|dismiss)
    id="${2:-}"
    [[ "$id" =~ ^[0-9]{3,20}$ ]] || { echo "usage: $0 $1 <numeric tg_id>" >&2; exit 2; }
    found=$(d1 "SELECT COUNT(*) AS n FROM admin_requests WHERE tg_id = '$id';" --json 2>/dev/null | grep -o '"n": *[0-9]*' | grep -o '[0-9]*$' || true)
    if [[ "${found:-0}" == "0" ]]; then echo "no /admin request from $id — ask them to send /admin to the bot first" >&2; exit 1; fi
    if [[ "$1" == promote ]]; then
      d1 "INSERT INTO settings (key, value) VALUES ('admin_id', '$id') ON CONFLICT(key) DO UPDATE SET value = excluded.value; UPDATE admin_requests SET status = 'promoted' WHERE tg_id = '$id'; SELECT value AS admin_tg_id FROM settings WHERE key = 'admin_id';"
      echo "✅ $id is now the bot admin. They can send /admin to the bot to see the commands."
    else
      d1 "UPDATE admin_requests SET status = 'dismissed' WHERE tg_id = '$id';"
    fi ;;
  *) sed -n '2,10p' "$0"; exit 2 ;;
esac
