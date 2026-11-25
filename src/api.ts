/**
 * TeleGlance backend client (G2 app side).
 *
 * The app talks ONLY to our own backend (http://localhost:3000 in dev).
 * The Telegram bot token never enters this bundle.
 */

export const BACKEND_URL = 'http://localhost:3000'

export interface DigestChat {
  id: number
  title: string
  unread: number
  summary: string
  lastText: string
  lastFrom: string
  draft: string
  messageId: number
  mock: boolean
}

export interface DigestResponse {
  mode: 'live' | 'mock'
  updatedAt: string
  chats: DigestChat[]
}

export interface SendResponse {
  ok: boolean
  deduped?: boolean
  mock?: boolean
  queued?: boolean
  error?: string
  telegramMessageId?: number
}

async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = 5000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function fetchDigest(): Promise<DigestResponse> {
  return fetchJson<DigestResponse>(`${BACKEND_URL}/api/digest`)
}

export function sendReply(chatId: number, messageId: number, text: string): Promise<SendResponse> {
  // Idempotency key: one draft per message can only ever send once.
  const key = `${chatId}:${messageId}`
  return fetchJson<SendResponse>(
    `${BACKEND_URL}/api/send`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, messageId, text, key }),
    },
    10000,
  )
}
