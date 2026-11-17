import { cookie, digest, randomToken, readCookie, readLimitedJson, trustedOrigin } from './accountSecurity'
import { isSyncData, MAX_SYNC_BYTES, type SyncData } from '../src/features/account/syncModel'
import type { AccountIdentity, GoogleTokens, AccountData, AccountSession } from './accountObjects'

const SESSION = 'dandori_session'
const STATE = 'dandori_oauth'
const SESSION_SECONDS = 30 * 24 * 60 * 60
const CALENDAR_SCOPES = ['https://www.googleapis.com/auth/calendar.events.owned', 'https://www.googleapis.com/auth/calendar.calendarlist.readonly']
const accountFor = (env: Env, id: string) => env.ACCOUNT_DATA.getByName(id) as DurableObjectStub<AccountData>
const sessionFor = (env: Env, id: string) => env.ACCOUNT_SESSIONS.getByName(id) as DurableObjectStub<AccountSession>
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }) }
function configured(env: Env): boolean { return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_ENCRYPTION_KEY && env.APP_ORIGIN && env.GOOGLE_ALLOWED_EMAILS) }
function redirect(url: string, cookies: string[] = []) {
  const headers = new Headers({ Location: url, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' })
  for (const value of cookies) headers.append('Set-Cookie', value)
  return new Response(null, { status: 303, headers })
}
async function session(request: Request, env: Env) {
  const token = readCookie(request, SESSION)
  if (!token || !/^[\w-]{43}$/.test(token)) return null
  const record = await sessionFor(env, await digest(token)).read()
  return record?.kind === 'session' ? record.user : null
}
export async function handleAccountRequest(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/auth/') && !url.pathname.startsWith('/api/account/')) return null
  if (url.pathname === '/api/auth/config' && request.method === 'GET') return json({ enabled: configured(env) })
  if (!configured(env)) return json({ error: 'Google連携のサーバー設定が未完了です' }, 503)
  const origin = env.APP_ORIGIN!
  if (url.origin !== origin || (!origin.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) return json({ error: '許可されていない接続先です' }, 403)
  if (!['GET','POST','PUT','DELETE'].includes(request.method)) return json({ error: 'Method not allowed' }, 405)
  if (request.method !== 'GET' && !trustedOrigin(request, origin)) return json({ error: '別サイトからの操作は受け付けません' }, 403)
  try {
    if (url.pathname === '/api/auth/prepare' && request.method === 'POST') {
      const body = await readLimitedJson<{ calendar?: boolean }>(request, 1000)
      const user = await session(request, env)
      if (body.calendar && !user) return json({ error: '先にGoogleでログインしてください' }, 401)
      const secret = randomToken(), pairId = await digest(secret)
      await sessionFor(env, `pair:${pairId}`).save({ kind: 'pairing', calendar: !!body.calendar, userId: body.calendar ? user?.id : undefined, expiresAt: Date.now() + 600_000 })
      return json({ secret, loginUrl: `/api/auth/google/start?pair=${pairId}` })
    }
    if (url.pathname === '/api/auth/claim' && request.method === 'POST') {
      const body = await readLimitedJson<{ secret: string }>(request, 1000)
      if (typeof body.secret !== 'string' || !/^[\w-]{43}$/.test(body.secret)) return json({ error: '認証の確認情報が不正です' }, 400)
      const pairing = sessionFor(env, `pair:${await digest(body.secret)}`)
      if (!await pairing.read()) return json({ error: 'ログインの確認期限が切れました。もう一度ログインしてください' }, 410)
      const user = await pairing.claimPair()
      if (!user) return json({ pending: true }, 202)
      const token = randomToken()
      await sessionFor(env, await digest(token)).save({ kind: 'session', user, expiresAt: Date.now() + SESSION_SECONDS * 1000 })
      return new Response(JSON.stringify({ user }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Set-Cookie': cookie(SESSION, token, SESSION_SECONDS, origin) } })
    }
    if (url.pathname === '/api/auth/google/start' && request.method === 'GET') {
      const pairId = url.searchParams.get('pair')
      const pair = pairId && /^[\w-]{43}$/.test(pairId) ? await sessionFor(env, `pair:${pairId}`).read() : null
      if (pairId && pair?.kind !== 'pairing') return json({ error: 'ログインの確認期限が切れました' }, 410)
      const calendar = pair?.kind === 'pairing' ? pair.calendar : url.searchParams.get('calendar') === '1'
      const user = await session(request, env)
      const expectedUser = pair?.kind === 'pairing' ? pair.userId : user?.id
      if (calendar && !expectedUser) return json({ error: '先にGoogleでログインしてください' }, 401)
      const state = randomToken(), verifier = randomToken()
      await sessionFor(env, await digest(state)).save({ kind: 'pending', verifier, calendar, userId: expectedUser, pairId: pairId ?? undefined, expiresAt: Date.now() + 10 * 60_000 })
      const target = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      target.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID!, redirect_uri: `${origin}/api/auth/google/callback`, response_type: 'code', scope: ['openid', 'email', 'profile', ...(calendar ? CALENDAR_SCOPES : [])].join(' '), state, code_challenge: await digest(verifier), code_challenge_method: 'S256', access_type: 'offline', include_granted_scopes: 'true', prompt: calendar ? 'consent' : 'select_account', ...(calendar && user ? { login_hint: user.email } : {}) }).toString()
      return redirect(target.href, [cookie(STATE, state, 600, origin)])
    }
    if (url.pathname === '/api/auth/google/callback' && request.method === 'GET') {
      const state = url.searchParams.get('state'), browserState = readCookie(request, STATE)
      const clear = cookie(STATE, '', 0, origin)
      if (!state || !browserState || !/^[\w-]{43}$/.test(state) || await digest(state) !== await digest(browserState)) return redirect(`${origin}/?google=invalid_state`, [clear])
      const pending = await sessionFor(env, await digest(state)).take()
      if (pending?.kind !== 'pending') return redirect(`${origin}/?google=expired`, [clear])
      const code = url.searchParams.get('code')
      if (url.searchParams.has('error') || !code) return redirect(`${origin}/?google=cancelled`, [clear])
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID!, client_secret: env.GOOGLE_CLIENT_SECRET!, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: 'authorization_code', code_verifier: pending.verifier }), signal: AbortSignal.timeout(15_000) })
      if (!tokenResponse.ok) return redirect(`${origin}/?google=failed`, [clear])
      const tokens = await tokenResponse.json<GoogleTokens>()
      // JWTの中身を読むだけで本人確認せず、Googleの認証済みuserinfo応答を利用する。
      const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15_000) })
      if (!identityResponse.ok) return redirect(`${origin}/?google=failed`, [clear])
      const profile = await identityResponse.json<{ sub: string; email: string; email_verified: boolean; name?: string }>()
      const allowed = env.GOOGLE_ALLOWED_EMAILS!.split(',').map(email => email.trim().toLowerCase())
      if (!profile.email_verified || !profile.sub || !allowed.includes(profile.email.toLowerCase()) || (pending.calendar && pending.userId !== profile.sub)) return redirect(`${origin}/?google=not_allowed`, [clear])
      if (pending.calendar && !CALENDAR_SCOPES.every(scope => tokens.scope?.split(' ').includes(scope))) return redirect(`${origin}/?google=missing_scope`, [clear])
      const user: AccountIdentity = { id: profile.sub, email: profile.email, name: profile.name || profile.email }
      if (pending.calendar) await accountFor(env, profile.sub).saveTokens(tokens)
      if (pending.pairId) await sessionFor(env, `pair:${pending.pairId}`).completePair(user)
      const token = randomToken()
      await sessionFor(env, await digest(token)).save({ kind: 'session', user, expiresAt: Date.now() + SESSION_SECONDS * 1000 })
      const old = readCookie(request, SESSION)
      if (old && /^[\w-]{43}$/.test(old)) await sessionFor(env, await digest(old)).clear()
      return redirect(`${origin}/?google=${pending.calendar ? 'calendar_connected' : 'connected'}`, [clear, cookie(SESSION, token, SESSION_SECONDS, origin)])
    }
    const user = await session(request, env)
    if (!user) return json({ error: 'Googleへのログインが必要です' }, 401)
    if (url.pathname.startsWith('/api/account/') && request.headers.get('X-Dandori-Account') !== user.id) return json({ error: '別のタブでアカウントが切り替わりました。画面を再読み込みしてください' }, 403)
    const account = accountFor(env, user.id)
    if (url.pathname === '/api/auth/session' && request.method === 'GET') return json({ user, calendar: await account.calendarStatus() })
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      await sessionFor(env, await digest(readCookie(request, SESSION)!)).clear()
      return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(SESSION, '', 0, origin), 'Cache-Control': 'no-store' } })
    }
    if (url.pathname === '/api/account/sync' && request.method === 'GET') return json(await account.getDocument())
    if (url.pathname === '/api/account/sync' && request.method === 'PUT') {
      const body = await readLimitedJson<{ revision: number; data: SyncData }>(request, MAX_SYNC_BYTES)
      if (!Number.isInteger(body.revision) || body.revision < 0 || !isSyncData(body.data)) return json({ error: '同期データの形式が正しくありません' }, 400)
      const next = await account.replaceDocument(body.revision, body.data)
      return next ? json(next) : json({ error: '別の端末が先に更新しました。再同期してください' }, 409)
    }
    if (url.pathname === '/api/account/calendars' && request.method === 'GET') return json({ calendars: await account.listCalendars() })
    if (url.pathname === '/api/account/calendar' && request.method === 'POST') {
      const body = await readLimitedJson<{ id: string }>(request, 4096)
      const selected = (await account.listCalendars()).find(calendar => calendar.id === body.id)
      if (!selected) return json({ error: '自分が所有するカレンダーを選択してください' }, 400)
      await account.configureCalendar(selected)
      return json({ calendar: selected })
    }
    if (url.pathname === '/api/account/calendar' && request.method === 'DELETE') { await account.disconnectCalendar(); return json({ disconnected: true }) }
    if (url.pathname === '/api/account/calendar-sync' && request.method === 'POST') return json(await account.synchronizeCalendar())
    return json({ error: 'Not found' }, 404)
  } catch (error) {
    // Googleの応答本文や認証コードをエラー応答・ログへ流さない。
    const message = error instanceof Error && /^[\u3040-\u9fff]/.test(error.message) ? error.message : 'Google連携に失敗しました。接続と権限を確認して再試行してください'
    return json({ error: message }, 502)
  }
}
