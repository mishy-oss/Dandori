export function randomToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}
export function base64Url(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
export async function digest(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0))
}
async function encryptionKey(secret: string) {
  const bytes = decode(secret)
  if (bytes.byteLength !== 32) throw new Error('GOOGLE_TOKEN_ENCRYPTION_KEY must contain 32 random bytes')
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export async function seal(value: unknown, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encryptionKey(secret), new TextEncoder().encode(JSON.stringify(value)))
  return `${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`
}
export async function unseal<T>(value: string, secret: string): Promise<T> {
  const [iv, encrypted] = value.split('.')
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv) }, await encryptionKey(secret), decode(encrypted)))) as T
}
export function readCookie(request: Request, name: string): string | undefined {
  return request.headers.get('cookie')?.split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1)
}
export function cookie(name: string, value: string, seconds: number, origin: string): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin.startsWith('https://') ? '; Secure' : ''}`
}
export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}
export async function readLimitedJson<T>(request: Request, limit: number, tooLargeMessage = '同期データの上限（1MB）を超えています'): Promise<T> {
  if (!request.body || !request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(400, 'JSON形式が必要です')
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let size = 0, text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new HttpError(413, tooLargeMessage) }
    text += decoder.decode(value, { stream: true })
  }
  try { return JSON.parse(text + decoder.decode()) as T }
  catch { throw new HttpError(400, 'JSON形式が正しくありません') }
}
export function trustedOrigin(request: Request, origin: string): boolean {
  return request.headers.get('origin') === origin && request.headers.get('sec-fetch-site') !== 'cross-site'
}
