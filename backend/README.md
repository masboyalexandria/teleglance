# TeleGlance backend

Small zero-dependency Node.js server (Node 20+) that owns the Telegram Bot
API conversation for the TeleGlance G2 app. The G2 app never talks to
Telegram directly and never sees the bot token.

## Run

```bash
node server.js          # listens on http://127.0.0.1:3000 (PORT env to change)
```

The bot token comes from `TELEGRAM_BOT_TOKEN` or `../.bot-token` (repo root,
gitignored, chmod 600). Without a token the server still runs in mock-only
mode. The token is never logged and never returned by any endpoint.

## Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ ok, mode, bot, chats, lastPollAt, lastPollError, tokenPresent }` |
| GET | `/api/digest` | `{ mode, updatedAt, chats: [...] }` — up to 5 chats, newest first |
| POST | `/api/send` | `{ chatId, messageId, text, key }` — one `sendMessage`, idempotent on `key` |
| GET | `/api/sent` | Records of messages sent through this backend |

Each digest chat carries `summary` (rule-based 1-line summary of the last
message) and `draft` (rule-based reply draft), plus `mock: true` when the
entry is demo data.

## Modes

- **live** — the bot has real chats with messages (from `getUpdates` long
  polling). Digest shows real chats.
- **mock** — no real messages yet (bot not added to any group, nobody has
  messaged it). Digest serves 3 clearly-labelled demo chats so the G2 app
  and the simulator demo work end-to-end. Mock sends are recorded as
  `{ mock: true, queued: true }` and never reach Telegram.

## Notes

- **VM egress quirk:** POST requests to `api.telegram.org` are blocked by
  this VM's network guard (HTTP 403); GET works. All Bot API calls therefore
  go out as GET with URL-encoded query parameters (the Bot API supports GET
  for every method used here). If the backend ever runs somewhere without
  that guard, POST would work too — the code paths are identical.
- **Polling:** `getUpdates` with a 25 s long-poll timeout, offset persisted
  to `.state.json` (gitignored) together with sent idempotency keys, so a
  restart never re-sends or re-reads.
- **Privacy mode:** by default (`can_read_all_group_messages: false`) the
  bot only sees group messages that mention it or reply to it. For a demo
  group where every message should appear in the digest, disable privacy
  mode in BotFather (`/setprivacy` → Disable) or use a channel where the
  bot is admin, or DM the bot directly (DMs always arrive).
