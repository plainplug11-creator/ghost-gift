#!/usr/bin/env bash
# Rebuild Ghost Gift, serve dist over HTTP, expose it with a Cloudflare quick
# tunnel, and re-point @GhostGift_Game's menu button at the new HTTPS URL.
#
# Requires GHOST_GIFT_BOT_TOKEN in the environment. The token is never written
# to files or printed. The trycloudflare.com URL changes on every restart, and
# the tunnel dies if this machine or the process stops.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY_DIR="${ROOT}/.deploy"
PORT="${GHOST_GIFT_PORT:-4180}"
PATH="${HOME}/bin:/usr/local/bin:${PATH}"

mkdir -p "${DEPLOY_DIR}"

if [[ -z "${GHOST_GIFT_BOT_TOKEN:-}" ]]; then
  echo "error: GHOST_GIFT_BOT_TOKEN is not set" >&2
  exit 1
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "error: cloudflared not found (install to ~/bin or /usr/local/bin)" >&2
  exit 1
fi

bot_api() {
  local method="$1"
  shift
  # Token is interpolated only for this curl invocation and is never echoed.
  curl -sS "https://api.telegram.org/bot${GHOST_GIFT_BOT_TOKEN}/${method}" "$@"
}

stop_pidfile() {
  local pidfile="$1"
  if [[ ! -f "${pidfile}" ]]; then
    return 0
  fi
  local pid
  pid="$(cat "${pidfile}" 2>/dev/null || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    kill "${pid}" 2>/dev/null || true
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "${pid}" 2>/dev/null || break
      sleep 0.2
    done
    if kill -0 "${pid}" 2>/dev/null; then
      kill -9 "${pid}" 2>/dev/null || true
    fi
  fi
  rm -f "${pidfile}"
}

echo "Stopping previous server and tunnel (if any)..."
stop_pidfile "${DEPLOY_DIR}/server.pid"
stop_pidfile "${DEPLOY_DIR}/tunnel.pid"
stop_pidfile "${DEPLOY_DIR}/forwarder.pid"

echo "Building production bundle..."
(
  cd "${ROOT}"
  npm run build
)

echo "Starting static server on 127.0.0.1:${PORT}..."
: > "${DEPLOY_DIR}/server.log"
nohup python3 "${ROOT}/scripts/serve-dist.py" --root "${ROOT}/dist" --host 127.0.0.1 --port "${PORT}" \
  >>"${DEPLOY_DIR}/server.log" 2>&1 &
echo $! > "${DEPLOY_DIR}/server.pid"

server_up=0
for i in $(seq 1 50); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/"; then
    server_up=1
    break
  fi
  sleep 0.1
done
if [[ "${server_up}" -ne 1 ]]; then
  echo "error: static server did not start; last log lines:" >&2
  tail -n 40 "${DEPLOY_DIR}/server.log" >&2 || true
  exit 1
fi

# This box's egress is an HTTP CONNECT proxy. cloudflared's data plane uses
# TCP/7844, which fails if we dial the intercepted 198.18.0.1 address directly.
# When the sandbox proxy is present, start a local CONNECT forwarder and run
# cloudflared under bwrap with argotunnel hostnames pointed at 127.0.0.1.
PROXY_ADDR="${SAND_EGRESS_TUNNEL_PROXY_ADDR:-}"
CLOUDFLARED_BIN="$(command -v cloudflared)"
CLOUDFLARED_ARGS=(tunnel --url "http://127.0.0.1:${PORT}" --protocol http2 --no-autoupdate)

if [[ -n "${PROXY_ADDR}" ]]; then
  echo "Starting HTTP CONNECT forwarder for Cloudflare edge :7844 via ${PROXY_ADDR}..."
  : > "${DEPLOY_DIR}/forwarder.log"
  nohup python3 "${ROOT}/scripts/connect-forward.py" --listen 127.0.0.1:7844 --proxy "${PROXY_ADDR}" \
    >>"${DEPLOY_DIR}/forwarder.log" 2>&1 &
  echo $! > "${DEPLOY_DIR}/forwarder.pid"
  fwd_up=0
  for i in $(seq 1 50); do
    if python3 -c 'import socket;s=socket.socket();s.settimeout(0.2);s.connect(("127.0.0.1",7844));s.close()' 2>/dev/null; then
      fwd_up=1
      break
    fi
    sleep 0.1
  done
  if [[ "${fwd_up}" -ne 1 ]]; then
    echo "error: CONNECT forwarder did not start; last log lines:" >&2
    tail -n 40 "${DEPLOY_DIR}/forwarder.log" >&2 || true
    exit 1
  fi
  cat > "${DEPLOY_DIR}/hosts" << EOF
127.0.0.1	localhost
::1	localhost ip6-localhost ip6-loopback
127.0.0.1	region1.v2.argotunnel.com region2.v2.argotunnel.com
127.0.0.1	cftunnel.com h2.cftunnel.com quic.cftunnel.com
127.0.0.1	_v2-origintunneld._tcp.argotunnel.com
EOF
  echo "Starting Cloudflare quick tunnel (http2 via local forwarder)..."
  : > "${DEPLOY_DIR}/tunnel.log"
  nohup bwrap --bind / / --dev /dev --proc /proc --ro-bind "${DEPLOY_DIR}/hosts" /etc/hosts \
    "${CLOUDFLARED_BIN}" "${CLOUDFLARED_ARGS[@]}" \
    >>"${DEPLOY_DIR}/tunnel.log" 2>&1 &
  echo $! > "${DEPLOY_DIR}/tunnel.pid"
else
  echo "Starting Cloudflare quick tunnel..."
  : > "${DEPLOY_DIR}/tunnel.log"
  nohup "${CLOUDFLARED_BIN}" "${CLOUDFLARED_ARGS[@]}" \
    >>"${DEPLOY_DIR}/tunnel.log" 2>&1 &
  echo $! > "${DEPLOY_DIR}/tunnel.pid"
fi

PUBLIC_URL="$(python3 - "${DEPLOY_DIR}/tunnel.log" "${DEPLOY_DIR}/tunnel.pid" << 'PY'
import re, sys, time
from pathlib import Path

log_path = Path(sys.argv[1])
pid_path = Path(sys.argv[2])
ansi = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
url_re = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
ready_re = re.compile(r"Registered tunnel connection", re.I)

def pid_alive() -> bool:
    try:
        pid = int(pid_path.read_text().strip())
    except Exception:
        return False
    try:
        Path(f"/proc/{pid}").stat()
        return True
    except FileNotFoundError:
        return False

deadline = time.time() + 90
url = None
ready = False
while time.time() < deadline:
    text = ansi.sub("", log_path.read_text(errors="replace") if log_path.exists() else "")
    if url is None:
        match = url_re.search(text)
        if match:
            url = match.group(0)
    if ready_re.search(text):
        ready = True
    if url and ready:
        break
    if not pid_alive() and time.time() > deadline - 80:
        break
    time.sleep(0.4)

if not url:
    sys.stderr.write("error: could not parse trycloudflare.com URL from tunnel log\n")
    sys.exit(2)
if not ready:
    sys.stderr.write(f"error: tunnel URL {url} appeared but the data plane never registered\n")
    sys.exit(3)
print(url)
PY
)"
if [[ -z "${PUBLIC_URL}" ]]; then
  echo "error: tunnel URL was empty; last log lines:" >&2
  tail -n 80 "${DEPLOY_DIR}/tunnel.log" >&2 || true
  exit 1
fi
printf '%s\n' "${PUBLIC_URL}" > "${DEPLOY_DIR}/public-url.txt"
echo "Public URL: ${PUBLIC_URL}"

python3 - "${DEPLOY_DIR}" "${PUBLIC_URL}" << 'PY'
import json, sys
from pathlib import Path

deploy = Path(sys.argv[1])
url = sys.argv[2].rstrip("/") + "/"

short = (
    "Ночной неон и осенние огни. Открывай кейсы и крути удачу — выигрывай подарки и звёзды."
)
description = (
    "Ghost Gift — мини-приложение в атмосфере осеннего неонового города. "
    "Открывай кейсы, крути колесо удачи и запускай слоты. Призы — подарки и звёзды. "
    "Это игра на удачу с красивыми анимациями, а не казино."
)
if len(short) > 120:
    raise SystemExit(f"short description too long: {len(short)}")
if len(description) > 512:
    raise SystemExit(f"description too long: {len(description)}")

(deploy / "setChatMenuButton.json").write_text(json.dumps({
    "menu_button": {
        "type": "web_app",
        "text": "Играть",
        "web_app": {"url": url},
    }
}, ensure_ascii=False))
(deploy / "setMyShortDescription.json").write_text(json.dumps({
    "language_code": "ru",
    "short_description": short,
}, ensure_ascii=False))
(deploy / "setMyDescription.json").write_text(json.dumps({
    "language_code": "ru",
    "description": description,
}, ensure_ascii=False))
(deploy / "setMyCommands.json").write_text(json.dumps({
    "commands": [{"command": "start", "description": "Открыть Ghost Gift"}],
    "language_code": "ru",
}, ensure_ascii=False))
PY

ok_json() {
  local name="$1"
  local file="$2"
  python3 - "${name}" "${file}" << 'PY'
import json, sys
name, path = sys.argv[1], sys.argv[2]
try:
    data = json.loads(open(path, encoding="utf-8").read())
except Exception as exc:
    raise SystemExit(f"{name}: invalid JSON ({exc})")
if not data.get("ok"):
    raise SystemExit(f"{name} failed: {data}")
print(f"{name}: ok")
PY
}

echo "Updating Telegram bot menu, description, and commands..."
bot_api getMe > "${DEPLOY_DIR}/getMe.json"
ok_json getMe "${DEPLOY_DIR}/getMe.json"
python3 - "${DEPLOY_DIR}/getMe.json" << 'PY'
import json, sys
data = json.loads(open(sys.argv[1], encoding="utf-8").read())
res = data.get("result") or {}
print(f"bot: @{res.get('username')} (id {res.get('id')})")
PY

bot_api setChatMenuButton -H "Content-Type: application/json" --data-binary @"${DEPLOY_DIR}/setChatMenuButton.json" \
  > "${DEPLOY_DIR}/setChatMenuButton.result.json"
ok_json setChatMenuButton "${DEPLOY_DIR}/setChatMenuButton.result.json"

bot_api setMyShortDescription -H "Content-Type: application/json" --data-binary @"${DEPLOY_DIR}/setMyShortDescription.json" \
  > "${DEPLOY_DIR}/setMyShortDescription.result.json"
ok_json setMyShortDescription "${DEPLOY_DIR}/setMyShortDescription.result.json"

bot_api setMyDescription -H "Content-Type: application/json" --data-binary @"${DEPLOY_DIR}/setMyDescription.json" \
  > "${DEPLOY_DIR}/setMyDescription.result.json"
ok_json setMyDescription "${DEPLOY_DIR}/setMyDescription.result.json"

bot_api setMyCommands -H "Content-Type: application/json" --data-binary @"${DEPLOY_DIR}/setMyCommands.json" \
  > "${DEPLOY_DIR}/setMyCommands.result.json"
ok_json setMyCommands "${DEPLOY_DIR}/setMyCommands.result.json"

python3 - "${DEPLOY_DIR}" "${PUBLIC_URL}" << 'PY'
import json, os, sys, time, urllib.request

deploy, expected = sys.argv[1], sys.argv[2]
token = os.environ["GHOST_GIFT_BOT_TOKEN"]
api = f"https://api.telegram.org/bot{token}/getChatMenuButton"
want = expected.rstrip("/")
last = None
for attempt in range(1, 7):
    with urllib.request.urlopen(api, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    (open(f"{deploy}/getChatMenuButton.json", "w", encoding="utf-8")).write(json.dumps(data))
    if not data.get("ok"):
        raise SystemExit(f"getChatMenuButton failed: {data}")
    button = data.get("result") or {}
    url = ((button.get("web_app") or {}).get("url"))
    last = (button.get("type"), button.get("text"), url)
    print(f"menu button try {attempt}: type={last[0]} text={last[1]} url={url}")
    if last[0] == "web_app" and (url or "").rstrip("/") == want:
        print("menu button confirmed")
        break
    time.sleep(1)
else:
    raise SystemExit(f"menu button URL mismatch: got {last}, expected {expected!r}")
PY

echo
echo "Done. Open https://t.me/GhostGift_Game and tap «Играть»."
echo "Note: this quick tunnel URL changes on every restart of the script,"
echo "and it dies if the box restarts or the server/tunnel process stops."
