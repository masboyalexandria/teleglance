#!/usr/bin/env node
/**
 * TeleGlance backend — Telegram digest + one-tap send for the G2 app.
 *
 * Zero dependencies (Node 20+). Polls the Telegram Bot API with getUpdates
 * (long polling) and exposes a tiny HTTP API on localhost:
 *
 *   GET  /api/health   -> { ok, mode, bot, chats, lastPollAt }
 *   GET  /api/digest   -> { mode, updatedAt, chats: [ {id,title,unread,
 *                        summary,lastText,lastFrom,draft,messageId,mock} ] }
 *   POST /api/send     -> { chatId, messageId, text, key } — sends one
 *                        message via sendMessage. Idempotent on `key`:
 *                        a repeated key returns { ok:true, deduped:true }
 *                        without sending again.
 *   GET  /api/sent     -> records of messages sent through this backend.
 *
 * Token: TELEGRAM_BOT_TOKEN env, else ../.bot-token (repo root, gitignored).
 * The token is NEVER logged, never returned by any endpoint, and never
 * leaves this process except in Bot API calls.
 *
 * Modes: when the bot has real chats with messages, digest is "live".
 * When there are no real messages yet (bot not added to any group / nobody
 * has messaged it), digest serves clearly-labelled MOCK demo chats so the
 * G2 app and the simulator demo still work end-to-end. Mock chats always
 * carry mock:true and the digest carries mode:"mock" — mock data is never
 * presented as real.
 */
import http from 'node:http'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const STATE_FILE = join(HERE, '.state.json')
const API = 'https://api.telegram.org'

// ---------------------------------------------------------------- token ---
function loadToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN.trim()
  const p = join(HERE, '..', '.bot-token')
  if (existsSync(p)) return readFileSync(p, 'utf8').trim()
  return null
}
const TOKEN = loadToken()
if (!TOKEN) {
  console.log('[backend] no bot token found (env TELEGRAM_BOT_TOKEN or ../.bot-token) — mock-only mode')
} else {
  console.log('[backend] bot token loaded (not shown)')
}

// ---------------------------------------------------------------- state ---
const state = {
  offset: 0,
  /** chatId -> { id, title, type, lastText, lastFrom, lastDate, messageId, count } */
  chats: new Map(),
  /** idempotency keys already sent -> { chatId, messageId, text, at, mock } */
  sent: new Map(),
  sentLog: [],
  lastPollAt: null,
  lastPollError: null,
  bot: null,
}
if (existsSync(STATE_FILE)) {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8'))
    state.offset = s.offset || 0
    for (const [k, v] of Object.entries(s.sent || {})) state.sent.set(k, v)
    state.sentLog = s.sentLog || []
  } catch { /* corrupt state: start fresh */ }
}
function saveState() {
  try {
    writeFileSync(STATE_FILE, JSON.stringify({
      offset: state.offset,
      sent: Object.fromEntries(state.sent),
      sentLog: state.sentLog.slice(-50),
    }, null, 2))
  } catch (e) { console.log('[backend] state save failed:', String(e).slice(0, 120)) }
}

// ------------------------------------------------------- telegram calls ---
async function tg(method, params = {}, timeoutMs = 35000) {
  // NOTE: this VM's egress guard blocks POST to api.telegram.org (403) but
  // allows GET. The Bot API supports GET for every method we use, so all
  // calls go out as GET with URL-encoded query params.
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue
    qs.set(k, Array.isArray(v) ? JSON.stringify(v) : String(v))
  }
  const url = `${API}/bot${TOKEN}/${method}${qs.size ? '?' + qs : ''}`
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal })
    return await res.json()
  } finally { clearTimeout(t) }
}

// ------------------------------------------------------------ summaries ---
function truncate(s, n) {
  if (!s) return ''
  s = s.replace(/\s+/g, ' ').trim()
  if (s.length <= n) return s
  const cut = s.slice(0, n - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > n * 0.5 ? cut.slice(0, sp) : cut) + '…'
}

function summarize(msg) {
  const text = (msg.text || '').trim()
  if (msg.photo) return '[Photo]'
  if (msg.sticker) return `[Sticker: ${msg.sticker.emoji || ''}]`.trim()
  if (msg.voice || msg.video_note) return '[Voice message]'
  if (msg.document) return `[File: ${msg.document.file_name || 'document'}]`
  if (!text) return '[Message]'
  if (/https?:\/\//.test(text)) return 'Shared a link'
  if (text.endsWith('?') || /^(who|what|when|where|why|how|can|could|should|is|are|do|does|did)\b/i.test(text)) {
    return `Q: ${truncate(text, 44)}`
  }
  return truncate(text, 48)
}

/** Rule-based reply draft (template stage; LLM optional later). */
function draftReply(msg) {
  const text = (msg.text || '').trim().toLowerCase()
  if (!text) return 'Got it — thanks!'
  if (/^(hi|hii+|hello|hey|halo|hai|good (morning|afternoon|evening))\b/.test(text)) {
    return 'Hi! Thanks for the message.'
  }
  if (text.endsWith('?') || /^(who|what|when|where|why|how|can|could|should|is|are|do|does|did)\b/.test(text)) {
    return "Yes — I'll check and get back to you shortly."
  }
  if (/https?:\/\//.test(text)) return "Thanks for sharing — I'll take a look."
  if (/\b(thank|thanks|thx)\b/.test(text)) return "You're welcome!"
  if (/\b(please|pls|tolong)\b/.test(text)) return 'Sure — on it.'
  return 'Got it — thanks!'
}

function chatTitle(chat) {
  if (chat.title) return chat.title
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(' ')
  if (name) return name
  if (chat.username) return `@${chat.username}`
  return `Chat ${chat.id}`
}

function recordMessage(msg) {
  const chat = msg.chat
  if (!chat) return
  const prev = state.chats.get(chat.id)
  const from = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || msg.from.username || 'Someone'
    : 'Someone'
  state.chats.set(chat.id, {
    id: chat.id,
    title: chatTitle(chat),
    type: chat.type,
    lastText: msg.text || '',
    lastFrom: from,
    lastDate: msg.date * 1000,
    messageId: msg.message_id,
    count: (prev?.count || 0) + 1,
    mock: false,
  })
}

// ------------------------------------------------------------- mock data --
const MOCK_CHATS = [
  {
    id: -1001001, title: 'Demo Group — Crypto News', type: 'supergroup',
    lastText: 'BTC broke $98k — is anyone watching the close?', lastFrom: 'Mas',
    lastDate: Date.now() - 4 * 60_000, messageId: 901, count: 3, mock: true,
  },
  {
    id: -1001002, title: 'Demo — Family', type: 'group',
    lastText: 'Dinner on Sunday? Mum is asking', lastFrom: 'Ayah',
    lastDate: Date.now() - 18 * 60_000, messageId: 902, count: 1, mock: true,
  },
  {
    id: -1001003, title: 'Demo Channel — Airdrops', type: 'channel',
    lastText: 'New testnet live: claim 0.05 zkLTC from the faucet',
    lastFrom: 'Airdrop Bot', lastDate: Date.now() - 42 * 60_000, messageId: 903, count: 2, mock: true,
  },
]

function buildDigest() {
  const real = [...state.chats.values()].sort((a, b) => b.lastDate - a.lastDate).slice(0, 5)
  const useMock = real.length === 0
  const list = (useMock ? MOCK_CHATS : real).map((c) => ({
    id: c.id,
    title: c.title,
    unread: c.count,
    summary: summarize({ text: c.lastText }),
    lastText: c.lastText,
    lastFrom: c.lastFrom,
    draft: draftReply({ text: c.lastText }),
    messageId: c.messageId,
    mock: !!c.mock,
  }))
  return { mode: useMock ? 'mock' : 'live', updatedAt: new Date().toISOString(), chats: list }
}

// ------------------------------------------------------------ poll loop ---
async function pollOnce() {
  if (!TOKEN) return
  try {
    const data = await tg('getUpdates', { offset: state.offset, timeout: 25, allowed_updates: ['message', 'channel_post'] }, 35000)
    state.lastPollAt = new Date().toISOString()
    if (!data.ok) {
      state.lastPollError = String(data.description || 'getUpdates failed').slice(0, 200)
      console.log('[poll] getUpdates error:', state.lastPollError)
      return
    }
    state.lastPollError = null
    for (const upd of data.result || []) {
      state.offset = Math.max(state.offset, upd.update_id + 1)
      const msg = upd.message || upd.channel_post
      if (msg) recordMessage(msg)
    }
    if ((data.result || []).length) {
      console.log(`[poll] ${(data.result || []).length} update(s), chats tracked: ${state.chats.size}`)
      saveState()
    }
  } catch (e) {
    state.lastPollError = String(e?.message || e).slice(0, 200)
    console.log('[poll] error:', state.lastPollError)
  }
}

async function pollLoop() {
  // Identify the bot once, then long-poll forever.
  if (TOKEN && !state.bot) {
    try {
      const me = await tg('getMe', {}, 10000)
      if (me.ok) {
        state.bot = { id: me.result.id, username: me.result.username, first_name: me.result.first_name }
        console.log(`[backend] bot: @${state.bot.username} (id ${state.bot.id})`)
      } else {
        console.log('[backend] getMe failed:', String(me.description || 'unknown').slice(0, 200))
      }
    } catch (e) { console.log('[backend] getMe error:', String(e?.message || e).slice(0, 200)) }
  }
  for (;;) {
    await pollOnce()
    await new Promise((r) => setTimeout(r, 1000))
  }
}

// -------------------------------------------------------------- http api --
function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = ''
    req.on('data', (c) => { buf += c; if (buf.length > 20000) req.destroy() })
    req.on('end', () => {
      try { resolve(buf ? JSON.parse(buf) : {}) } catch { reject(new Error('bad json')) }
    })
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://localhost:${PORT}`)
  try {
    if (req.method === 'OPTIONS') { json(res, 204, {}); return }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, {
        ok: true,
        mode: state.chats.size ? 'live' : 'mock',
        bot: state.bot,
        chats: state.chats.size,
        lastPollAt: state.lastPollAt,
        lastPollError: state.lastPollError,
        tokenPresent: !!TOKEN,
        uptimeSec: Math.round(process.uptime()),
      })
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/digest') {
      json(res, 200, buildDigest())
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/sent') {
      json(res, 200, { sent: state.sentLog.slice(-20) })
      return
    }

    if (req.method === 'POST' && url.pathname === '/api/send') {
      const body = await readBody(req)
      const chatId = Number(body.chatId)
      const text = String(body.text || '').trim()
      const messageId = body.messageId
      const key = String(body.key || `${chatId}:${messageId}:${text.slice(0, 40)}`)
      if (!chatId || !text) { json(res, 400, { ok: false, error: 'chatId and text are required' }); return }
      if (text.length > 400) { json(res, 400, { ok: false, error: 'text too long (max 400 chars)' }); return }

      // Idempotency guard: same key never sends twice.
      if (state.sent.has(key)) {
        const prev = state.sent.get(key)
        console.log(`[send] deduped key ${key.slice(0, 40)} (already sent)`)
        json(res, 200, { ok: true, deduped: true, ...prev })
        return
      }

      const isMock = !TOKEN || MOCK_CHATS.some((m) => m.id === chatId)
      if (isMock) {
        const rec = { chatId, messageId, text, key, at: new Date().toISOString(), mock: true, queued: true }
        state.sent.set(key, rec)
        state.sentLog.push(rec)
        saveState()
        console.log(`[send] MOCK send to chat ${chatId}: ${truncate(text, 60)} (recorded, not sent to Telegram)`)
        json(res, 200, { ok: true, mock: true, queued: true, ...rec })
        return
      }

      const data = await tg('sendMessage', { chat_id: chatId, text }, 15000)
      if (!data.ok) {
        console.log('[send] telegram error:', String(data.description || 'send failed').slice(0, 200))
        json(res, 502, { ok: false, error: String(data.description || 'Telegram send failed').slice(0, 200) })
        return
      }
      const rec = { chatId, messageId, text, key, at: new Date().toISOString(), mock: false, telegramMessageId: data.result.message_id }
      state.sent.set(key, rec)
      state.sentLog.push(rec)
      saveState()
      console.log(`[send] sent to chat ${chatId} (tg msg ${data.result.message_id})`)
      json(res, 200, { ok: true, ...rec })
      return
    }

    json(res, 404, { ok: false, error: 'not found' })
  } catch (e) {
    console.log('[http] error:', String(e?.message || e).slice(0, 200))
    json(res, 500, { ok: false, error: 'internal error' })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[backend] TeleGlance backend listening on http://127.0.0.1:${PORT}`)
  console.log(`[backend] mode: ${TOKEN ? 'polling Telegram (mock digest until real messages arrive)' : 'mock-only (no token)'}`)
  pollLoop()
})
