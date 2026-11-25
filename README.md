# TeleGlance — Telegram digest + one-tap AI reply approval on Even Realities G2

**Demo video:** https://www.youtube.com/watch?v=_AXfKqqsB3M (unlisted, 65 s, with English voiceover; silent version: `demo/teleglance-demo.mp4`, narration script: `demo/narration-script.md`).

**Hackathon:** Heads Up: Even Realities (DoraHacks), build week 23–29 Nov 2026.
**Tracks:** 01 Messaging & News + Special Prize: Best Telegram integration.
**Team:** solo — masboyalexandria.

## What it is

TeleGlance shows a glanceable Telegram digest on G2 smart glasses and lets the
wearer act on it hands-free: open a chat, read the latest message, and approve
an AI-drafted reply with a single tap (or ring press) — no typing, no phone.

- **Read:** up to 5 chats with unread messages, one summary line per chat.
- **Write:** draft reply shown on the glasses; one tap sends it via the
  Telegram Bot API through a small backend. Double-tap dismisses.
  The draft is rule-based for the demo (template stage; an LLM draft is
  optional later) — it is shown to the wearer before anything is sent.
- **Privacy:** demo uses only a demo group/channel owned by the developer.

## Status — Day 3 (Wed 25 Nov 2026)

- Day 1 (Mon 23 Nov): scaffold from the official Even Hub `minimal`
  template + "Hello from G2!" proven in the official simulator.
- Day 2 (Tue 24 Nov): Telegram bot created — **@teleglance_mas_bot**,
  token verified live via `getMe`, stored in `.bot-token` (chmod 600,
  gitignored, never in the repo).
- Day 3 (Wed 25 Nov): **backend + read/write flows done and verified.**
  Backend (`backend/server.js`, zero dependencies, Node 20+) polls the
  Bot API with `getUpdates` and serves `GET /api/digest`,
  `POST /api/send` (idempotent per chat+message), `GET /api/sent` and
  `GET /api/health` on `http://127.0.0.1:3000`. The glasses app
  (`src/main.ts`, via the typed client in `src/api.ts`) renders the
  digest, sends the top chat's draft on a single tap, and dismisses on
  a double-tap. Verified end-to-end in the official simulator under
  Xvfb: digest renders on the glasses display, a tap sends the draft
  (mock send recorded, deduped on repeat), the display advances to the
  next chat with "Reply sent.", and a double-tap dismisses the last
  chat. `app.json` declares the `network` permission for
  `http://localhost:3000` (required on real G2 hardware).
- No bot token is in this repo — the token lives only in the backend
  environment, never committed.
- Day 3 polish (Wed 25 Nov, same day): digest now shows **up to 5 chats**
  with swipe navigation (touchpad/ring up-down = `SCROLL_TOP` /
  `SCROLL_BOTTOM`) and a separate **message screen** — swipe past either
  end of the digest opens the selected chat's full last message (wrapped,
  ASCII-only); on that screen a tap sends the draft, a double-tap goes
  back, and swipes move between chats' messages. Tap-to-send,
  double-tap-to-dismiss, backend-down and empty states, and the
  idempotent send (never double-sends) all still work. Verified in the
  simulator against a mock backend with 5 demo chats (screenshots
  `sim-polish-*.png`) and against the live backend with 1 real chat.
  Dev override: load the app with `?backend=http://localhost:3001` to
  point it at a different backend; default is `http://localhost:3000`.

## Run it (simulator)

Requires Node.js 20 LTS or 22+.

```bash
npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
npm install
cd backend && npm start   # http://127.0.0.1:3000 — start FIRST
cd .. && npm run dev      # http://localhost:5173
evenhub-simulator http://localhost:5173
```

The glasses app shows "Backend offline." instead of stale data if the
backend is not running. When no real Telegram messages exist yet, the backend
serves clearly-labelled `[DEMO]` mock chats so the flow can be demoed
end-to-end; mock data is never presented as real. With real messages present
(verified 25 Nov 2026 with a live DM chat) it serves live data instead.

Simulator quirk (v0.7.3): `GET /api/screenshot/glasses` returns a solid
green frame in this build — verify the display through the simulator
window (or an X11 screenshot of it) instead; the app itself renders
fine there. Drive taps headlessly via the automation API:
`POST /api/input {"action":"click" | "double_click"}` on
`--automation-port 9898`, and read `GET /api/console` for app logs.

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
| `app.json` | Even Hub manifest (`com.masboyalexandria.teleglance`), incl. the `network` permission for the backend origin. |
| `src/main.ts` | App entry: digest rendering + tap-to-send / double-tap-to-dismiss event routing. |
| `src/api.ts` | Typed backend client (`fetchDigest`, `sendReply`); the token never enters this bundle. |
| `backend/server.js` | Backend: Telegram polling, digest + idempotent send endpoints (port 3000, zero deps). |
| `backend/package.json` | Backend package (`npm start` → `node server.js`). |
| `index.html` | WebView host. |
| `vite.config.ts` | Dev server on port 5173. |

## Money safety

TeleGlance never touches money: no payments, no trading, no wallet access.
Demo data is read-only messages from a demo chat; sending is limited to
plain text replies the user explicitly approves.
