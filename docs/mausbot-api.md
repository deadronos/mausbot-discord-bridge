# MausBot Bot API — observed contract (2026-11-23)

Source: the installed app bundle at `/Applications/OpenMausBot.app/Contents/Resources/server/server/bot-api-host.js` and `shared/bot-api.js`. No guesswork — these are the server's own definitions.

## Endpoint and auth

- `POST <MAUSBOT_API_BASE>` — the full "messages" URL shown in MausBot's Bot API settings, of the form `http://127.0.0.1:8800/hooks/api/bots/<botId>/messages` (the default webhook port is the app port + 1; 8799 + 1 = 8800). Copy the exact URL from the app rather than constructing it.
- Headers: `Authorization: Bearer <MAUSBOT_API_KEY>`, `Content-Type: application/json`.
- Key format begins `bak_`. It is shown once when enabled and hashed on disk.

## Request body (POST)

```json
{ "message": "text from Discord", "thread": "optional-existing-thread-id", "wait": 45 }
```

- `message`: 1–20,000 chars.
- `thread`: optional, `/^[\w-]{1,128}$/`. If omitted, MausBot **creates** a new thread and returns its id. The bridge must persist that id per DM/channel and send it on later messages.
- `wait`: optional seconds, 0–300. MausBot holds the connection this long for a reply, then answers `202` with the thread id.

## Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{ "reply": "...", "thread": "..." }` | reply ready |
| 202 | `{ "thread": "...", "status": "working" }` | still running — poll |
| 202 | `{ "thread": "...", "status": "needs_approval" }` | approval card is waiting in MausBot |
| 401 | `{ "error": "Invalid key" }` | bad key |
| 403 | `{ "error": "..." }` | API off for this bot / plan not included / AI can't take calls / key can't act as owner |
| 409 / 429 / 502 / 415 / 400 | `{ "error": "..." }` | busy / rate limited / could not answer / wrong content type / bad body |

Polling: `GET <MAUSBOT_API_BASE>?thread=<threadId>` with the same bearer key. Returns 200 with `{ reply, thread }` when done, 202 with `{ thread, status }` while working. GET does **not** consume the 10-calls-per-minute rate limit.

## Limits and safety

- 10 POST calls/minute per key; 20,000-char message cap; 50 pending calls per bot.
- Reply text is assembled from the bot's text lines in that thread, joined with blank lines, and redacted by the server.
- "Acts as me" is a property of the key (`actsAsOwner`), toggled in the app and allowed by the server. A key without it opens a fenced "ask" thread: tools may raise approval cards, which surface as `needs_approval`. The bridge never approves; the owner does that in MausBot.
- A thread opened as owner work stays owner-only while the key is marked; if the mark is removed, that thread returns 403 and a new thread is needed.
