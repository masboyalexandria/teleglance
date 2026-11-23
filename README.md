# TeleGlance — Telegram digest + one-tap AI reply approval on Even Realities G2

**Hackathon:** Heads Up: Even Realities (DoraHacks), build week 23–29 Nov 2026.
**Tracks:** 01 Messaging & News + Special Prize: Best Telegram integration.
**Team:** solo — masboyalexandria.

## What it is

TeleGlance shows a glanceable Telegram digest on G2 smart glasses and lets the
wearer act on it hands-free: open a chat, read the latest message, and approve
an AI-drafted reply with a single tap (or ring press) — no typing, no phone.

- **Read:** up to 5 chats with unread messages, one summary line per chat.
- **Write:** AI-drafted reply shown on the glasses; one tap sends it via the
  Telegram Bot API through a small backend. Double-tap dismisses.
- **Privacy:** demo uses only a demo group/channel owned by the developer.

## Status — Day 1 (Mon 23 Nov 2026)

Scaffold from the official Even Hub `minimal` template + "Hello from G2!" proven
in the official simulator (tap counter increments via the simulator automation
API). Telegram backend (Bot API polling, digest + send endpoints) and the
read/write flows land Tue–Wed 24–25 Nov. No bot token is in this repo — the
token lives only in the backend environment, never committed.

## Run it (simulator)

Requires Node.js 20 LTS or 22+.

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
npm install
npm run dev            # http://localhost:5173
evenhub-simulator http://localhost:5173
```

Headless/CI note: the simulator is a GUI app. On a headless Linux VM it runs
under Xvfb (`Xvfb :99`, `DISPLAY=:99`), and input/screenshots are available
through its automation API (`--automation-port 9898`, `POST /api/input`,
`GET /api/screenshot/glasses`). Screen recording via `ffmpeg -f x11grab -i :99`.

## What existed before 23 Nov 2026 (per hackathon rules)

- The official Even Hub `minimal` template
  (`even-realities/evenhub-templates`), including its hello-world `src/main.ts`.
- The Even Hub SDK (`@evenrealities/even_hub_sdk`), CLI and simulator
  (open-source tooling from Even Realities).
- Third-party APIs used as-is: Telegram Bot API (from 24 Nov onward).
- Everything else in this repo was written during build week, 23–29 Nov 2026.

## Project layout

| File | Purpose |
|---|---|
| `app.json` | Even Hub manifest (`com.masboyalexandria.teleglance`). |
| `src/main.ts` | App entry: startup page container + event routing. |
| `index.html` | WebView host. |
| `vite.config.ts` | Dev server on port 5173. |

## Money safety

TeleGlance never touches money: no payments, no trading, no wallet access.
Demo data is read-only messages from a demo chat; sending is limited to
plain text replies the user explicitly approves.
