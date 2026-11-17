import { AccountData, AccountSession } from '../accountObjects'
import { handleAccountRequest } from '../accountRoutes'
import { digest, randomToken } from '../accountSecurity'
export { AccountSession }

// 本番のエントリーポイントからは参照せず、ローカル実行テストでだけ内部の暗号化状態を確認する。
export class TestAccountData extends AccountData {
  async encryptedOnly(): Promise<boolean> {
    const value = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM account_state WHERE key = ?', 'tokens').toArray()[0]?.value
    return typeof value === 'string' && !value.includes('test-refresh') && !value.includes('test-access')
  }
  async calendarArchiveRoundTrip(): Promise<boolean> {
    const selection = { id: 'test-calendar', name: 'Test', timeZone: 'Asia/Tokyo' }
    const calendar = { ...selection, links: { task: { eventId: 'event', etag: 'etag', fingerprint: '{}', readOnly: false } } }
    this.ctx.storage.sql.exec('INSERT INTO account_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'calendar', JSON.stringify(calendar))
    await this.configureCalendar({ ...selection, id: 'other-calendar' })
    await this.configureCalendar(selection)
    this.ctx.storage.sql.exec('DELETE FROM account_state WHERE key = ?', 'tokens')
    await this.disconnectCalendar()
    const disconnected = await this.calendarStatus() === null
    await this.configureCalendar(selection)
    const saved = JSON.parse(this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM account_state WHERE key = ?', 'calendar').toArray()[0].value) as typeof calendar
    return disconnected && saved.links.task.eventId === 'event'
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/__runtime-test') return await handleAccountRequest(request, env) ?? new Response('Not found', { status: 404 })
    const accounts = env.ACCOUNT_DATA as DurableObjectNamespace<TestAccountData>
    const sessions = env.ACCOUNT_SESSIONS as DurableObjectNamespace<AccountSession>
    const suffix = crypto.randomUUID()
    const alice = accounts.getByName(`alice-${suffix}`), bob = accounts.getByName(`bob-${suffix}`)
    const initial = await alice.getDocument()
    const copy = structuredClone(initial.data)
    copy.settings[0].defaultDuration = 45
    const writes = await Promise.all([alice.replaceDocument(initial.revision, copy), alice.replaceDocument(initial.revision, copy)])
    const retained = await accounts.getByName(`alice-${suffix}`).getDocument()
    const separate = await bob.getDocument()
    await alice.saveTokens({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600, scope: 'test' })
    await alice.saveTokens({ access_token: 'test-access-next', expires_in: 3600 })
    const encrypted = await alice.encryptedOnly()
    const calendarArchive = await alice.calendarArchiveRoundTrip()
    const session = sessions.getByName(`session-${suffix}`)
    const user = { id: `alice-${suffix}`, email: 'alice@example.com', name: 'Alice' }
    await session.save({ kind: 'session', user, expiresAt: Date.now() + 60000 })
    const read = await session.read(), first = await session.take(), second = await session.take()
    const pair = sessions.getByName(`pair-${suffix}`)
    await pair.save({ kind: 'pairing', calendar: true, userId: user.id, expiresAt: Date.now() + 60000 })
    const pending = await pair.claimPair()
    await pair.completePair({ ...user, id: 'wrong-account' })
    const wrong = await pair.claimPair()
    await pair.completePair(user)
    const claimed = await pair.claimPair(), replay = await pair.claimPair()
    const token = randomToken()
    await sessions.getByName(await digest(token)).save({ kind: 'session', user, expiresAt: Date.now() + 60000 })
    const origin = env.APP_ORIGIN!
    const authenticated = await handleAccountRequest(new Request(`${origin}/api/account/sync`, { headers: { Cookie: `dandori_session=${token}`, 'X-Dandori-Account': user.id } }), env)
    const crossAccount = await handleAccountRequest(new Request(`${origin}/api/account/sync`, { headers: { Cookie: `dandori_session=${token}`, 'X-Dandori-Account': 'bob' } }), env)
    return Response.json({
      casOneWinner: writes.filter(Boolean).length === 1,
      durableStateRetained: retained.revision === 1 && retained.data.settings[0].defaultDuration === 45 && calendarArchive,
      accountIsolation: separate.revision === 0 && separate.data.settings[0].defaultDuration === 30,
      tokensEncrypted: encrypted,
      sessionSingleUse: read?.kind === 'session' && first?.kind === 'session' && second === null,
      pairingSingleUse: pending === null && wrong === null && claimed?.id === user.id && replay === null,
      authenticatedRoute: authenticated?.status === 200,
      crossAccountBlocked: crossAccount?.status === 403,
    })
  },
}
