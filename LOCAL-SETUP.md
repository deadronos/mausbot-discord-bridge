# Local setup — Discord ↔ MausBot bridge

Runs on this Mac. No OpenClaw component, no public port: the bridge holds an outbound Discord Gateway socket and calls MausBot's local Bot API.

## 1. Discord app

In the Discord Developer Portal, for the bot whose token you already have:

- **Message Content Intent = ON** (required to read @mentions in servers).
- Invite scopes: `bot` + `applications.commands`.
- Permissions: View Channels, Send Messages, Read Message History (Embed Links and Add Reactions optional).
- Invite the bot to guild `1421572009024028895`, channel `1466587026097836271` (`#openclawbot`).

The allowlists are already filled in `.env`: the author allowlist contains you (`278962007577722880`) plus the two peer bots — Clawson / OpenClaw (`1466579180970971188`) and Nova / Hermes (`1470132281137041438`). Only those three can trigger the bridge, in DMs or in that channel. A message must @mention the bot to wake it; ordinary posts are ignored so bots cannot loop. There is **no bridge-side ping budget** — loop control is behavioural in MausBot (Lance): if a peer is only bouncing mentions, it replies without repeating the mention. `DISCORD_MENTION_ALLOWLIST` only decides which raw `<@id>` tokens may become real pings.

## 2. MausBot Bot API

In MausBot's settings, open **Bot API → Let apps talk to this bot**, mint a key, and copy the **full messages URL** it shows (form `http://127.0.0.1:8800/hooks/api/bots/<botId>/messages`). Paste that URL as `MAUSBOT_API_BASE` in `.env`.

Also mark the key as **acting for you** ("Acts as me"). If this install will not allow that, the bridge still works but Discord requests are text-only — you approve tool actions in MausBot. The bridge never approves anything itself.

## 3. Keychain

Add the secrets. These commands prompt for the value, so nothing lands in shell history or chat:

```bash
security add-generic-password -a DISCORD_BOT_TOKEN -s mausbot-discord-bridge -w
security add-generic-password -a MAUSBOT_API_KEY -s mausbot-discord-bridge -w
security add-generic-password -a MAUSBOT_SEND_API_SECRET -s mausbot-discord-bridge -w  # optional; enables the send API
```

Verify the bridge can read them without printing them:

```bash
cd ~/mausbot-discord-bridge && bash test/keychain.test.sh
```

## 4. Install and start the login agent

```bash
cp ~/mausbot-discord-bridge/deploy/com.mausbot.discord-bridge.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mausbot.discord-bridge.plist
launchctl enable gui/$(id -u)/com.mausbot.discord-bridge
```

If you upgrade Node, update the `PATH` in the plist to include the new node `bin` directory, then bootout and bootstrap again.

### 4b. Loopback send API (optional)

The bridge keeps owning the Discord token. When `MAUSBOT_SEND_API_SECRET` is in Keychain it also starts a small HTTP listener on `127.0.0.1` (`SEND_API_PORT`, default 8812) so the local MausBot can ask it to post a message. It is not reachable from outside this Mac. Callers need the separate send secret, and targets are restricted to `DISCORD_CHANNEL_ALLOWLIST` for channels or `DISCORD_DM_ALLOWLIST` for DMs; every other target is refused. Mentions in sent text are scoped to `DISCORD_MENTION_ALLOWLIST` and `@everyone`/roles are blocked.

Use the helper so the secret never appears in chat or logs:

```bash
DISCORD_CHANNEL=1466587026097836271 DISCORD_TEXT='hello' bash ~/mausbot-discord-bridge/scripts/discord-send.sh
DISCORD_USER=278962007577722880       DISCORD_TEXT='hello dm' bash ~/mausbot-discord-bridge/scripts/discord-send.sh
```

If the secret is absent, the endpoint is simply not started and the rest of the bridge behaves as before.

## 5. Smoke tests

1. `launchctl print gui/$(id -u)/com.mausbot.discord-bridge` shows the job running.
2. The bot appears online in Discord.
3. DM you → a MausBot reply comes back in the DM.
4. `@YourBot hello` in the allowed channel → a reply comes back there.
5. A message from another account, or in another channel, gets no reply.
6. A long reply arrives split into several messages.
7. A long-running turn keeps the "is typing…" indicator alive (refreshed every `TYPING_PULSE_MS`, default 5 s). When it stops with a plain reply the turn finished.
8. If a turn outlasts the foreground wait window, the bridge posts "Still working — I'll post the result here when it arrives." and keeps polling that thread in the background for up to `MAUSBOT_LATE_REPLY_MS` (default 15 min). The real reply is posted back to the same channel when it arrives; there is no need to check MausBot manually.
9. `bridge.err.log` contains no token or key.

## 6. Stop, restart, logs

```bash
launchctl bootout gui/$(id -u)/com.mausbot.discord-bridge     # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mausbot.discord-bridge.plist  # start
tail -f ~/mausbot-discord-bridge/bridge.log
```

Logs: `bridge.log` (stdout) and `bridge.err.log` (stderr) in the project folder. Thread-to-conversation mapping is kept in `threads.json` (mode 0600) so a DM or channel continues the same MausBot conversation across restarts.
