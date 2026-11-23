#!/bin/bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

cat > "$TMP/security" <<'STUB'
#!/bin/bash
account=""
while [ $# -gt 0 ]; do
  case "$1" in -a) account="$2"; shift 2;; *) shift;; esac
done
case "$account" in
  DISCORD_BOT_TOKEN) printf '%s' "${STUB_TOKEN-stub-token-value}";;
  MAUSBOT_API_KEY) printf '%s' "stub-key-value";;
  *) printf '';;
esac
STUB
chmod +x "$TMP/security"

out=$(PATH="$TMP:$PATH" bash -c "source '$ROOT/scripts/keychain.sh'; printf '%s|%s' \"\$DISCORD_BOT_TOKEN\" \"\$MAUSBOT_API_KEY\"" 2>/dev/null)
if [ "$out" != "stub-token-value|stub-key-value" ]; then
  echo "FAIL exports both secrets (got: $out)"; exit 1
fi
echo "PASS exports both secrets"

PATH="$TMP:$PATH" STUB_TOKEN="" bash -c "source '$ROOT/scripts/keychain.sh'" >/dev/null 2>&1
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "FAIL fails closed on missing token"; exit 1
fi
echo "PASS fails closed on missing token"
