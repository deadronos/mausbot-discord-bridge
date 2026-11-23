#!/bin/bash
# Post a message through the bridge's loopback send API.
# The Discord token stays with the bridge; this only uses a separate send secret.
# Usage:
#   DISCORD_CHANNEL=<channel id> DISCORD_TEXT='hello' bash scripts/discord-send.sh
#   DISCORD_USER=<user id>       DISCORD_TEXT='hello' bash scripts/discord-send.sh
set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
env_file="${ENV_FILE:-${script_dir}/../.env}"
if [ -z "${SEND_API_PORT:-}" ] && [ -f "$env_file" ]; then
  port_from_env="$(grep -E '^SEND_API_PORT=[0-9]+$' "$env_file" | tail -n 1 | cut -d= -f2 || true)"
  if [ -n "$port_from_env" ]; then
    SEND_API_PORT="$port_from_env"
  fi
fi

channel="${DISCORD_CHANNEL:-}"
user="${DISCORD_USER:-}"
text="${DISCORD_TEXT:-}"
reply_to="${DISCORD_REPLY_TO:-}"

if [ -z "$text" ] || { [ -z "$channel" ] && [ -z "$user" ]; }; then
  echo "Need DISCORD_TEXT and either DISCORD_CHANNEL or DISCORD_USER." >&2
  exit 2
fi

secret="$(security find-generic-password -s 'mausbot-discord-bridge' -a 'MAUSBOT_SEND_API_SECRET' -w 2>/dev/null | tr -d '\r\n"')"
if [ -z "$secret" ]; then
  echo "Send API secret is missing from Keychain." >&2
  exit 1
fi

payload="$(DISCORD_CHANNEL="$channel" DISCORD_USER="$user" DISCORD_TEXT="$text" DISCORD_REPLY_TO="$reply_to" python3 -c '
import json, os
data = {"content": os.environ["DISCORD_TEXT"]}
if os.environ["DISCORD_CHANNEL"]: data["channel_id"] = os.environ["DISCORD_CHANNEL"]
if os.environ["DISCORD_USER"]: data["user_id"] = os.environ["DISCORD_USER"]
if os.environ["DISCORD_REPLY_TO"]: data["reply_to"] = os.environ["DISCORD_REPLY_TO"]
print(json.dumps(data))
')"

# Pass the Authorization header via stdin (-K -) so the secret never appears in process argv.
printf 'header = "Authorization: Bearer %s"\n' "$secret" | \
  curl -sS --max-time 20 -K - -X POST "http://127.0.0.1:${SEND_API_PORT:-8812}/send" \
    -H 'Content-Type: application/json' \
    --data-binary "$payload"
