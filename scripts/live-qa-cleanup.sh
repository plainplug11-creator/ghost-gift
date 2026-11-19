#!/usr/bin/env bash
# Remove every trace of the live-E2E QA user from remote D1 and return its net bank effect.
# usage: scripts/live-qa-cleanup.sh <qaUserId> <bankDelta>   (bankDelta = bank change caused by the QA run)
set -euo pipefail
U=${1:?qa user id}; D=${2:-0}
cd "$(dirname "$0")/../worker"
SQL="UPDATE bank SET balance = balance - ($D) WHERE id = 1;"
for t in inventory ledger idempotency fairness_log spin_times fingerprints withdrawals payments plays invoices deliveries; do SQL+="DELETE FROM $t WHERE user_id = '$U';"; done
SQL+="DELETE FROM ref_rewards WHERE referrer = '$U' OR referee = '$U'; DELETE FROM rate WHERE key LIKE '%$U%'; DELETE FROM tg_updates WHERE update_id BETWEEN 990000000 AND 990000999; DELETE FROM users WHERE id = '$U';"
npx wrangler d1 execute ghost-gift --remote --command "$SQL" >/dev/null
npx wrangler d1 execute ghost-gift --remote --json --command "SELECT (SELECT balance FROM bank) bank, (SELECT count(*) FROM users) users, (SELECT count(*) FROM plays WHERE user_id='$U') qa_plays" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['results'])"
