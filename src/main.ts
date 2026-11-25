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
// from the local backend (GET /api/digest) and renders up to 3 chats, one
// line each, with the draft reply for the top chat.
// Write flow: a single tap sends the top chat's draft via the backend
// (POST /api/send — idempotent on chatId:messageId). A double-tap
// dismisses the top chat without sending. When no chats remain, a
// double-tap exits the app. Chats handled on the glasses are tracked
// locally (handledIds) so a sent/dismissed chat stops showing.
//
// The backend (backend/server.js, port 3000) is the only thing that talks
// to Telegram. If it is not running, the app says so plainly instead of
// showing stale or fake data. In mock mode the backend labels its demo
// chats mock:true and the app shows a "[DEMO]" tag — mock data is never
// presented as real. The app manifest (app.json) declares the network
// permission for the backend origin; without it the fetch is blocked on
// real G2 hardware.

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

let digest: DigestResponse | null = null
let backendDown = false
/** messageIds already sent or dismissed on the glasses this session. */
const handledIds = new Set<number>()
let lastAction = ''
let sending = false

function visibleChats(): DigestChat[] {
  if (!digest) return []
  return digest.chats.filter((c) => !handledIds.has(c.messageId)).slice(0, 3)
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
      content = `TeleGlance${tag}\nAll caught up - no unread chats.\nDouble-tap to exit.`
    } else {
      const lines = chats.map((c, i) => {
        const n = c.unread > 1 ? ` (${c.unread})` : ''
        return `${i + 1}. ${c.title}${n}\n   ${c.lastFrom}: ${c.summary}`
      })
      const top = chats[0]
      content =
        `TeleGlance${tag} - ${chats.length} unread\n` +
        lines.join('\n') +
        `\nReply #1: "${top.draft}"\nTap: send - Double-tap: dismiss`
    }
  }
  if (lastAction) content += `\n${lastAction}`
  // Glasses firmware font is ASCII-only: strip anything outside ASCII so a
  // single fancy glyph can never blank the whole container.
  content = content.replace(/[^\x00-\x7F]/g, '')
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
  await refreshDigest()
}

function dismissTop() {
  const chats = visibleChats()
  if (chats.length === 0) {
    bridge.shutDownPageContainer(1)
    return
  }
  handledIds.add(chats[0].messageId)
  lastAction = 'Dismissed.'
  render()
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
    dismissTop()
    return
  }

  if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
    const chats = visibleChats()
    if (chats.length > 0 && !backendDown) {
      void sendDraft(chats[0])
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
