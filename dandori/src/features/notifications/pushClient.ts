export interface PushSchedule {
  id: string
  at: number
  title: string
}

export const PUSH_SETTINGS_CHANGED_EVENT = 'dandori:push-settings-changed'

const DEVICE_TOKEN_KEY = 'dandori.push.device-token'

/** この端末の通知設定を識別するトークンをlocalStorageから取得する。 */
export function readPushDeviceToken(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_KEY)
}

/** 有効な端末トークンがあれば再利用し、なければ暗号学的乱数32バイトから作ってlocalStorageに保存する。 */
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

/** 通知登録の識別に使っていた端末トークンをlocalStorageから削除する。 */
export function forgetPushDeviceToken(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY)
}

/** 通知設定変更のイベントを発火し、アプリ側に通知予定の再同期を促す。 */
export function notifyPushSettingsChanged(): void {
  window.dispatchEvent(new Event(PUSH_SETTINGS_CHANGED_EVENT))
}

/** URL向けBase64形式のVAPID公開鍵を復号し、Push APIへ渡せるArrayBufferに変換する。 */
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

/** 通知APIにJSONをPOSTし、失敗時はサーバーの説明または共通メッセージを持つエラーを投げる。 */
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

/** 端末トークンとブラウザーのPush購読情報を通知サーバーへ登録する。 */
export function savePushSubscription(deviceToken: string, subscription: PushSubscription): Promise<void> {
  return postJson('/api/push/subscribe', { deviceToken, subscription: subscription.toJSON() })
}

/** 端末トークンを指定して、サーバーのPush購読と通知予定の削除を依頼する。 */
export function clearPushSubscription(deviceToken: string): Promise<void> {
  return postJson('/api/push/unsubscribe', { deviceToken })
}

/** 登録済みの端末にテスト通知を送るようサーバーへ依頼する。 */
export function sendPushTest(deviceToken: string): Promise<void> {
  return postJson('/api/push/test', { deviceToken })
}

/** 端末の未来の通知予定をまとめて送信し、サーバー側の予定を現在のタスクに合わせて置き換える。 */
export function syncPushSchedules(deviceToken: string, notifications: PushSchedule[]): Promise<void> {
  return postJson('/api/push/schedules', { deviceToken, notifications })
}
