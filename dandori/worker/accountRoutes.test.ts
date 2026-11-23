import { afterEach, expect, it, vi } from 'vitest'
import { handleAccountRequest } from './accountRoutes'
import { digest, randomToken } from './accountSecurity'
import { initialSyncData } from '../src/features/account/syncModel'
import type { AuthRecord } from './accountObjects'

afterEach(() => vi.unstubAllGlobals())
function namespace(byName: (id: string) => object): DurableObjectNamespace {
  return { getByName: vi.fn((id: string) => ({ id: {} as DurableObjectId, ...byName(id) }) as DurableObjectStub), newUniqueId: vi.fn(), idFromName: vi.fn(), idFromString: vi.fn(), get: vi.fn(), jurisdiction: vi.fn() }
}
async function setup() {
  const records = new Map<string, AuthRecord>()
  const token = randomToken()
  records.set(await digest(token), { kind: 'session', user: { id: 'alice', name: 'Alice', email: 'alice@example.com' }, expiresAt: Date.now() + 60_000 })
  const getDocument = vi.fn(async () => ({ revision: 0, data: initialSyncData(1) }))
  const saveTokens = vi.fn()
  const env = { VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '', VAPID_SUBJECT: '', PUSH_DEVICES: {} as Env['PUSH_DEVICES'], APP_ORIGIN: 'https://app.test', GOOGLE_CLIENT_ID: 'client', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_TOKEN_ENCRYPTION_KEY: randomToken(), GOOGLE_ALLOWED_EMAILS: 'alice@example.com',
    ACCOUNT_SESSIONS: namespace((id: string) => ({
      read: async () => records.get(id) ?? null,
      save: async (record: AuthRecord) => { records.set(id,record) },
      take: async () => { const record = records.get(id) ?? null; records.delete(id); return record },
      clear: async () => { records.delete(id) },
      completePair: async (user: { id: string; email: string; name: string }) => { const old = records.get(id); if (old?.kind === 'pairing') records.set(id, { ...old, user }) },
      claimPair: async () => { const old = records.get(id); if (old?.kind !== 'pairing' || !old.user) return null; records.delete(id); return old.user },
    })),
    ACCOUNT_DATA: namespace(() => ({ getDocument, saveTokens, calendarStatus: async () => null, replaceDocument: async () => null })),
  } satisfies Env
  const request = (path: string, method = 'GET', body?: unknown, extra: Record<string,string> = {}) => new Request(`https://app.test${path}`, { method, headers: { Cookie: `dandori_session=${token}`, Origin: 'https://app.test', 'X-Dandori-Account': 'alice', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return { env, request, records, token, getDocument, saveTokens }
}
it('disables unconfigured authentication without leaking configured secret values', async () => {
  const response = await handleAccountRequest(new Request('https://app.test/api/auth/config'), {} as Env)
  expect(await response!.json()).toEqual({ enabled: false })
  expect(await handleAccountRequest(new Request('https://app.test/ordinary-page'), {} as Env)).toBeNull()
})
it('rejects unauthenticated reads, foreign-origin writes and cross-account requests before reading account data', async () => {
  const { env, request, getDocument } = await setup()
  expect((await handleAccountRequest(request('/api/account/sync', 'GET', undefined, { Cookie: '' }), env))!.status).toBe(401)
  expect((await handleAccountRequest(request('/api/account/sync', 'PUT', {}, { Origin: 'https://evil.test' }), env))!.status).toBe(403)
  expect((await handleAccountRequest(request('/api/account/sync', 'GET', undefined, { 'X-Dandori-Account': 'bob' }), env))!.status).toBe(403)
  expect(getDocument).not.toHaveBeenCalled()
})
it('scopes account reads using the authenticated identity and returns revision conflicts', async () => {
  const { env, request } = await setup()
  expect((await handleAccountRequest(request('/api/account/sync'), env))!.status).toBe(200)
  expect(env.ACCOUNT_DATA.getByName).toHaveBeenCalledWith('alice')
  const response = await handleAccountRequest(request('/api/account/sync', 'PUT', { revision: 0, data: initialSyncData(1) }), env)
  expect(response!.status).toBe(409)
})
it('binds a PKCE login to a cookie, rejects a mismatched callback and consumes a successful state once', async () => {
  const { env, request, records } = await setup()
  const start = await handleAccountRequest(request('/api/auth/google/start'), env)
  const target = new URL(start!.headers.get('Location')!)
  const state = target.searchParams.get('state')!
  const pending = records.get(await digest(state))!
  expect(pending.kind).toBe('pending')
  if (pending.kind !== 'pending') throw new Error('Expected pending')
  expect(target.searchParams.get('code_challenge')).toBe(await digest(pending.verifier))
  expect(target.searchParams.get('redirect_uri')).toBe('https://app.test/api/auth/google/callback')
  expect((await handleAccountRequest(request(`/api/auth/google/callback?state=${state}&code=code`), env))!.headers.get('Location')).toContain('invalid_state')
  const mockedFetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'google-access', refresh_token: 'google-refresh', expires_in: 3600 })).mockResolvedValueOnce(Response.json({ sub: 'alice', email: 'alice@example.com', email_verified: true }))
  vi.stubGlobal('fetch', mockedFetch)
  const callback = request(`/api/auth/google/callback?state=${state}&code=code`, 'GET', undefined, { Cookie: `dandori_oauth=${state}` })
  const result = await handleAccountRequest(callback, env)
  expect(result!.headers.get('Location')).toBe('https://app.test/?google=connected')
  expect(result!.headers.get('Set-Cookie')).toContain('HttpOnly')
  expect(result!.headers.get('Set-Cookie')).not.toContain('google-access')
  expect((await handleAccountRequest(callback, env))!.headers.get('Location')).toContain('expired')
})
it('rejects unapproved Google identities without saving tokens or creating sessions', async () => {
  const { env, request, saveTokens } = await setup()
  const start = await handleAccountRequest(request('/api/auth/google/start?calendar=1'), env)
  const state = new URL(start!.headers.get('Location')!).searchParams.get('state')!
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'access', expires_in: 3600 })).mockResolvedValueOnce(Response.json({ sub: 'mallory', email: 'mallory@example.com', email_verified: true })))
  const result = await handleAccountRequest(request(`/api/auth/google/callback?state=${state}&code=c`, 'GET', undefined, { Cookie: `dandori_oauth=${state}` }), env)
  expect(result!.headers.get('Location')).toContain('not_allowed')
  expect(saveTokens).not.toHaveBeenCalled()
})
it('keeps an iOS pairing secret out of login URLs and permits a single successful claim', async () => {
  const { env, request, records } = await setup()
  const prepared = await handleAccountRequest(request('/api/auth/prepare', 'POST', {}), env)
  const body = await prepared!.json() as { secret: string; loginUrl: string }
  expect(body.loginUrl).not.toContain(body.secret)
  expect((await handleAccountRequest(request('/api/auth/claim', 'POST', { secret: body.secret }), env))!.status).toBe(202)
  const pairId = `pair:${await digest(body.secret)}`
  const pair = records.get(pairId)!
  expect(pair.kind).toBe('pairing')
  if (pair.kind !== 'pairing') throw new Error('Expected pairing')
  records.set(pairId, { ...pair, user: { id: 'alice', email: 'alice@example.com', name: 'Alice' } })
  const claimed = await handleAccountRequest(request('/api/auth/claim', 'POST', { secret: body.secret }), env)
  expect(claimed!.status).toBe(200)
  expect(claimed!.headers.get('Set-Cookie')).toContain('dandori_session=')
  expect((await handleAccountRequest(request('/api/auth/claim', 'POST', { secret: body.secret }), env))!.status).toBe(410)
})
it('logs out only on a same-origin POST and invalidates the stored session', async () => {
  const { env, request, records, token } = await setup()
  expect((await handleAccountRequest(request('/api/auth/logout', 'POST', undefined, { Origin: 'https://evil.test' }), env))!.status).toBe(403)
  expect(records.has(await digest(token))).toBe(true)
  const response = await handleAccountRequest(request('/api/auth/logout', 'POST'), env)
  expect(response!.status).toBe(204)
  expect(records.has(await digest(token))).toBe(false)
})

it('returns 400 for malformed JSON and 413 for oversized sync payloads', async () => {
  const { env, request } = await setup()
  const badType = await handleAccountRequest(new Request('https://app.test/api/account/sync', {
    method: 'PUT',
    headers: { Cookie: request('/api/account/sync').headers.get('Cookie')!, Origin: 'https://app.test', 'X-Dandori-Account': 'alice', 'Content-Type': 'text/plain' },
    body: 'plain text',
  }), env)
  expect(badType!.status).toBe(400)
  expect((await badType!.json() as { error: string }).error).toBe('JSON形式が必要です')

  const oversized = await handleAccountRequest(new Request('https://app.test/api/account/sync', {
    method: 'PUT',
    headers: { Cookie: request('/api/account/sync').headers.get('Cookie')!, Origin: 'https://app.test', 'X-Dandori-Account': 'alice', 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(1_000_050) }),
  }), env)
  expect(oversized!.status).toBe(413)
})
