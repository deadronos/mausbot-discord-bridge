# Local setup — Discord ↔ MausBot bridge

Runs on this Mac. No OpenClaw component, no public port: the bridge holds an outbound Discord Gateway socket and calls MausBot's local Bot API.

## 1. Discord app

In the Discord Developer Portal, for the bot whose token you already have:

- **Message Content Intent = ON** (required to read @mentions in servers).
- Invite scopes: `bot` + `applications.commands`.
- Permissions: View Channels, Send Messages, Read Message History (Embed Links and Add Reactions optional).
- Invite the bot to guild `1421572009024028895`, channel `1452349461811691581`.

The allowlists are already filled in `.env`: only user `278962007577722880` (you) can trigger the bot, in DMs or in that channel.

## 2. MausBot Bot API

In MausBot's settings, open **Bot API → Let apps talk to this bot**, mint a key, and copy the **full messages URL** it shows (form `http://127.0.0.1:8800/hooks/api/bots/<botId>/messages`). Paste that URL as `MAUSBOT_API_BASE` in `.env`.

Also mark the key as **acting for you** ("Acts as me"). If this install will not allow that, the bridge still works but Discord requests are text-only — you approve tool actions in MausBot. The bridge never approves anything itself.

## 3. Keychain

Add the two secrets. These commands prompt for the value, so nothing lands in shell history or chat:

```bash
security add-generic-password -a DISCORD_BOT_TOKEN -s mausbot-discord-bridge -w
security add-generic-password -a MAUSBOT_API_KEY -s mausbot-discord-bridge -w
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

## 5. Smoke tests

1. `launchctl print gui/$(id -u)/com.mausbot.discord-bridge` shows the job running.
2. The bot appears online in Discord.
3. DM you → a MausBot reply comes back in the DM.
4. `@YourBot hello` in the allowed channel → a reply comes back there.
5. A message from another account, or in another channel, gets no reply.
6. A long reply arrives split into several messages.
7. `bridge.err.log` contains no token or key.

## 6. Stop, restart, logs

```bash
launchctl bootout gui/$(id -u)/com.mausbot.discord-bridge     # stop
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mausbot.discord-bridge.plist  # start
tail -f ~/mausbot-discord-bridge/bridge.log
```

Logs: `bridge.log` (stdout) and `bridge.err.log` (stderr) in the project folder. Thread-to-conversation mapping is kept in `threads.json` (mode 0600) so a DM or channel continues the same MausBot conversation across restarts.
