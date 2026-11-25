import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'
import { fetchDigest, sendReply, type DigestChat, type DigestResponse } from './api'

// TeleGlance — glanceable Telegram digest + one-tap approved reply.
//
// Read flow: on start (and after every action) the app fetches the digest
// from the local backend (GET /api/digest) and renders up to 5 chats, one
// line each, plus the selected chat's summary and its draft reply.
// Write flow: a single tap sends the selected chat's draft via the backend
// (POST /api/send — idempotent on chatId:messageId). A double-tap
// dismisses the selected chat without sending. When no chats remain, a
// double-tap exits the app. Chats handled on the glasses are tracked
// locally (handledIds) so a sent/dismissed chat stops showing.
//
// Navigation (touchpad swipe / ring up-down, SCROLL_TOP / SCROLL_BOTTOM):
//   • Digest: swipe moves the selection between chats. Swiping past either
//     end opens the selected chat's full message (the only way to reach the
//     message screen — tap and double-tap are already taken by send and
//     dismiss). This also means the message screen is reachable even with
//     a single chat.
//   • Message screen: swipe moves between chats' messages, tap sends the
//     shown chat's draft, double-tap goes back to the digest.
//   • In both views the selection defaults to the first (top) chat, so a
//     tap with no prior swipe still sends the top chat's draft, exactly
//     as before.
//
// The backend (backend/server.js, port 3000) is the only thing that talks
// to Telegram. If it is not running, the app says so plainly instead of
// showing stale or fake data. In mock mode the backend labels its demo
// chats mock:true and the app shows a "[DEMO]" tag — mock data is never
// presented as real. The app manifest (app.json) declares the network
// permission for the backend origin; without it the fetch is blocked on
// real G2 hardware.
//
// Rendering limits: the glasses font is ASCII-only (a non-ASCII glyph can
// blank the whole container), and the text container caps at 999 bytes, so
// every line is truncated and the final content is sliced as a safety net.

const bridge = await waitForEvenAppBridge()

const mainText = new TextContainerProperty({
  xPosition: 0,
  yPosition: 0,
  width: 576,
  height: 288,
  borderWidth: 0,
  borderColor: 5,
  paddingLength: 4,
  containerID: 1,
  containerName: 'main',
  content: 'TeleGlance\nLoading digest...',
  isEventCapture: 1,
})

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 1,
    textObject: [mainText],
  }),
)

console.log('Page created:', result === 0 ? 'success' : `failed (${result})`)

const MAX_CHATS = 5
const MAX_BYTES = 990

let digest: DigestResponse | null = null
let backendDown = false
/** messageIds already sent or dismissed on the glasses this session. */
const handledIds = new Set<number>()
let lastAction = ''
let sending = false
/** Index into visibleChats(); 0 = top chat. */
let selectedIndex = 0
let view: 'digest' | 'message' = 'digest'

function visibleChats(): DigestChat[] {
  if (!digest) return []
  return digest.chats.filter((c) => !handledIds.has(c.messageId)).slice(0, MAX_CHATS)
}

/** Clamp the selection into range; call after every digest refresh. */
function clampSelection() {
  const n = visibleChats().length
  if (selectedIndex > n - 1) selectedIndex = Math.max(0, n - 1)
  if (selectedIndex < 0) selectedIndex = 0
}

function trunc(s: string, n: number): string {
  const t = (s || '').replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

/** Wrap text to lines of at most `width` chars, at most `maxLines` lines. */
function wrapText(s: string, width: number, maxLines: number): string[] {
  const words = (s || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w
    if (next.length > width && cur) {
      lines.push(cur)
      cur = w
      if (lines.length === maxLines) break
    } else {
      cur = next
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  return lines
}

function renderDigest(chats: DigestChat[], tag: string): string {
  const lines = chats.map((c, i) => {
    const mark = i === selectedIndex ? '>' : ' '
    const n = c.unread > 1 ? ` (${c.unread})` : ''
    return `${mark} ${i + 1}. ${trunc(c.title, 26)}${n}`
  })
  const top = chats[selectedIndex]
  const body =
    `TeleGlance${tag} - ${chats.length} unread\n` +
    lines.join('\n') +
    `\n${top.lastFrom}: ${trunc(top.summary, 52)}` +
    `\nReply: "${trunc(top.draft, 52)}"` +
    `\nTap: send - Dbl: dismiss - Swipe: move, past edge: open`
  return body
}

function renderMessage(chat: DigestChat, tag: string): string {
  const msgLines = wrapText(chat.lastText || chat.summary, 48, 6)
  if ((chat.lastText || '').replace(/\s+/g, ' ').trim().length > msgLines.join(' ').length) {
    msgLines[msgLines.length - 1] += ' ...'
  }
  return (
    `TeleGlance${tag} - ${trunc(chat.title, 30)}\n` +
    `From: ${trunc(chat.lastFrom, 40)}\n` +
    msgLines.join('\n') +
    `\nReply: "${trunc(chat.draft, 52)}"` +
    `\nTap: send - Dbl: back - Swipe: prev/next msg`
  )
}

function render() {
  let content: string
  if (backendDown) {
    content =
      'TeleGlance\nBackend offline.\nStart it: cd backend && npm start\nDouble-tap to exit.'
  } else if (!digest) {
    content = 'TeleGlance\nLoading digest...'
  } else {
    const chats = visibleChats()
    const tag = digest.mode === 'mock' ? ' [DEMO]' : ''
    if (chats.length === 0) {
      view = 'digest'
      content = `TeleGlance${tag}\nAll caught up - no unread chats.\nDouble-tap to exit.`
    } else if (view === 'message') {
      content = renderMessage(chats[selectedIndex], tag)
    } else {
      content = renderDigest(chats, tag)
    }
  }
  if (lastAction) content += `\n${lastAction}`
  // Glasses firmware font is ASCII-only: strip anything outside ASCII so a
  // single fancy glyph can never blank the whole container.
  content = content.replace(/[^\x00-\x7F]/g, '')
  // Text container byte cap (999): slice as a safety net after truncation.
  if (content.length > MAX_BYTES) content = content.slice(0, MAX_BYTES)
  void bridge
    .textContainerUpgrade(
      new TextContainerUpgrade({
        containerID: 1,
        containerName: 'main',
        content,
      }),
    )
    .then((ok) => console.log('[render] upgrade ok=', ok, 'len=', content.length))
}

async function refreshDigest() {
  try {
    digest = await fetchDigest()
    backendDown = false
  } catch (e) {
    console.log('Digest fetch failed:', String(e).slice(0, 120))
    backendDown = true
  }
  clampSelection()
  if (view === 'message' && visibleChats().length === 0) view = 'digest'
  render()
}

async function sendDraft(chat: DigestChat) {
  if (sending) return
  sending = true
  try {
    const data = await sendReply(chat.id, chat.messageId, chat.draft)
    if (!data.ok) throw new Error(data.error || 'send failed')
    handledIds.add(chat.messageId)
    lastAction = data.deduped ? 'Already sent.' : 'Reply sent.'
  } catch (e) {
    lastAction = `Send failed: ${String(e).slice(0, 60)}`
  } finally {
    sending = false
  }
  view = 'digest'
  await refreshDigest()
}

function dismissSelected() {
  const chats = visibleChats()
  if (chats.length === 0) {
    bridge.shutDownPageContainer(1)
    return
  }
  handledIds.add(chats[selectedIndex].messageId)
  lastAction = 'Dismissed.'
  clampSelection()
  render()
}

function openMessage() {
  const chats = visibleChats()
  if (chats.length === 0) return
  view = 'message'
  render()
}

/** Swipe down: next chat; past the last chat, open the message screen. */
function swipeDown() {
  const chats = visibleChats()
  if (chats.length === 0 || backendDown) return
  if (view === 'message') {
    if (selectedIndex < chats.length - 1) selectedIndex++
    render()
    return
  }
  if (selectedIndex < chats.length - 1) {
    selectedIndex++
    render()
  } else {
    openMessage()
  }
}

/** Swipe up: previous chat; past the first chat, open the message screen. */
function swipeUp() {
  const chats = visibleChats()
  if (chats.length === 0 || backendDown) return
  if (view === 'message') {
    if (selectedIndex > 0) selectedIndex--
    render()
    return
  }
  if (selectedIndex > 0) {
    selectedIndex--
    render()
  } else {
    openMessage()
  }
}

// Reads the event type out of one envelope.
//
// CLICK_EVENT is 0, and protobuf omits zero-value fields on the wire, so a
// single tap arrives as an envelope whose `eventType` is `undefined`. The
// default has to be resolved INSIDE the envelope check. Writing
// `event.sysEvent?.eventType ?? OsEventTypeList.CLICK_EVENT` instead would
// read CLICK on events that carry no `sysEvent` at all, so every scroll,
// exit and audio frame would fire the tap handler.
function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
  if (!envelope) return null
  return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
}

// Event routing, critical details:
//   • Taps/double-taps/lifecycle come through `event.sysEvent`.
//     Scroll gestures come through `event.textEvent`. Never mix them.
//   • Double-tap → dismiss (or exit when nothing is left) is a root-level
//     check: it must fire no matter which envelope the event arrives in.
//   • Check DOUBLE_CLICK_EVENT before CLICK_EVENT.
const unsubscribe = bridge.onEvenHubEvent((event) => {
  const sysType = eventTypeOf(event.sysEvent)
  const textType = eventTypeOf(event.textEvent)

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    if (view === 'message') {
      view = 'digest'
      render()
    } else {
      dismissSelected()
    }
    return
  }

  if (sysType === OsEventTypeList.SCROLL_BOTTOM_EVENT || textType === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
    swipeDown()
    return
  }

  if (sysType === OsEventTypeList.SCROLL_TOP_EVENT || textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    swipeUp()
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    const chats = visibleChats()
    if (chats.length > 0 && !backendDown) {
      void sendDraft(chats[selectedIndex])
    }
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    unsubscribe()
  }
})

// First paint: load the digest, then keep it fresh while the app is open.
void refreshDigest()
setInterval(() => void refreshDigest(), 30_000)
