import type { Issue } from '../../db/types'

export interface PushSchedule {
  id: string
  at: number
  title: string
}

export const MAX_PUSH_SCHEDULES = 500
export const MAX_PUSH_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
export const MAX_PUSH_TITLE_LENGTH = 120

/* Worker 側の検証上限に合わせて事前に整形し、1件の超過で全体の通知同期が落ちないようにする。 */
export function buildPushSchedules(
  issues: ReadonlyArray<Pick<Issue, 'id' | 'title' | 'statusId' | 'date' | 'startMin' | 'reminderOffsetMin' | 'carryoverToId'>>,
  doneIds: ReadonlySet<string>,
  now = Date.now(),
): PushSchedule[] {
  const maxAt = now + MAX_PUSH_AHEAD_MS
  return issues
    .filter((issue) => !issue.carryoverToId && !doneIds.has(issue.statusId) && issue.date && issue.startMin !== null && issue.reminderOffsetMin !== null)
    .flatMap((issue) => {
      const title = issue.title.trim().slice(0, MAX_PUSH_TITLE_LENGTH)
      if (!title) return []
      const [year, month, day] = issue.date!.split('-').map(Number)
      const at = new Date(year, month - 1, day, 0, issue.startMin!).getTime() - issue.reminderOffsetMin! * 60_000
      return Number.isFinite(at) && at > now && at <= maxAt ? [{ id: issue.id, at, title }] : []
    })
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_PUSH_SCHEDULES)
}

export const PUSH_SETTINGS_CHANGED_EVENT = 'dandori:push-settings-changed'

const DEVICE_TOKEN_KEY = 'dandori.push.device-token'

export function readPushDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_KEY)
}

export function getOrCreatePushDeviceToken(): string {
  const current = readPushDeviceToken()
  if (current && /^[A-Za-z0-9_-]{43}$/.test(current)) return current

  const random = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of random) binary += String.fromCharCode(byte)
  const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  localStorage.setItem(DEVICE_TOKEN_KEY, token)
  return token
}

export function forgetPushDeviceToken(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY)
}

export function notifyPushSettingsChanged(): void {
  window.dispatchEvent(new Event(PUSH_SETTINGS_CHANGED_EVENT))
}

export function decodeVapidPublicKey(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const decoded = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  const buffer = new ArrayBuffer(decoded.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index)
  }
  return buffer
}

async function postJson(path: string, data: unknown): Promise<void> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (response.ok) return

  let message = '通知サーバーとの通信に失敗しました'
  try {
    const body = (await response.json()) as { error?: unknown }
    if (typeof body.error === 'string') message = body.error
  } catch {
    // Keep the generic message when the server response is not JSON.
  }
  throw new Error(message)
}

export function savePushSubscription(deviceToken: string, subscription: PushSubscription): Promise<void> {
  return postJson('/api/push/subscribe', { deviceToken, subscription: subscription.toJSON() })
}

export function clearPushSubscription(deviceToken: string): Promise<void> {
  return postJson('/api/push/unsubscribe', { deviceToken })
}

export function sendPushTest(deviceToken: string): Promise<void> {
  return postJson('/api/push/test', { deviceToken })
}

export function syncPushSchedules(deviceToken: string, notifications: PushSchedule[]): Promise<void> {
  return postJson('/api/push/schedules', { deviceToken, notifications })
}
