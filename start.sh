#!/bin/bash
# Load secrets from Keychain, then start the bridge.
cd "$(dirname "$0")" || exit 1
source ./scripts/keychain.sh || exit 1
exec node src/index.js
