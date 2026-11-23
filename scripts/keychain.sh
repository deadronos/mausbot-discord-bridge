#!/bin/bash
# Load the bridge's two secrets from macOS Keychain into the environment.
# Values are never echoed, logged, or written to disk by this script.
read_secret() {
  security find-generic-password -s 'mausbot-discord-bridge' -a "$1" -w 2>/dev/null | tr -d '\n'
}

DISCORD_BOT_TOKEN="$(read_secret DISCORD_BOT_TOKEN)"
export DISCORD_BOT_TOKEN
MAUSBOT_API_KEY="$(read_secret MAUSBOT_API_KEY)"
export MAUSBOT_API_KEY
# Optional: secret for the loopback send API. Missing means the endpoint stays off.
MAUSBOT_SEND_API_SECRET="$(read_secret MAUSBOT_SEND_API_SECRET)"
export MAUSBOT_SEND_API_SECRET

if [ -z "$DISCORD_BOT_TOKEN" ] || [ -z "$MAUSBOT_API_KEY" ]; then
  echo "Bridge secrets are missing from the Keychain." >&2
  exit 1
fi
