import { DurableObject } from 'cloudflare:workers'
import { initialSyncData, isSyncData, MAX_SYNC_BYTES, type SyncData, type SyncDocument } from '../src/features/account/syncModel'
import { GoogleApiError, synchronizeCalendar, type CalendarState } from './calendarSync'
import { seal, unseal } from './accountSecurity'

export interface AccountIdentity { id: string; email: string; name: string }
export interface GoogleTokens { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
interface SavedTokens { accessToken: string; refreshToken: string; expiresAt: number; scope: string }
export type AuthRecord = { kind: 'pending'; verifier: string; calendar: boolean; userId?: string; pairId?: string; expiresAt: number } | { kind: 'session'; user: AccountIdentity; expiresAt: number } | { kind: 'pairing'; calendar: boolean; userId?: string; user?: AccountIdentity; expiresAt: number }

export class AccountSession extends DurableObject<Env> {
  async save(record: AuthRecord): Promise<void> {
    await this.ctx.storage.put('record', record)
    await this.ctx.storage.setAlarm(record.expiresAt)
  }
  async read(): Promise<AuthRecord | null> {
    const record = await this.ctx.storage.get<AuthRecord>('record')
    return record && record.expiresAt > Date.now() ? record : null
  }
  async take(): Promise<AuthRecord | null> {
    return this.ctx.storage.transaction(async transaction => {
      const record = await transaction.get<AuthRecord>('record')
      await transaction.delete('record')
      return record && record.expiresAt > Date.now() ? record : null
    })
  }
  async clear(): Promise<void> { await this.ctx.storage.deleteAll() }
  async completePair(user: AccountIdentity): Promise<void> {
    await this.ctx.storage.transaction(async transaction => {
      const record = await transaction.get<AuthRecord>('record')
      if (record?.kind === 'pairing' && record.expiresAt > Date.now() && (!record.userId || record.userId === user.id)) await transaction.put('record', { ...record, user })
    })
  }
  async claimPair(): Promise<AccountIdentity | null> {
    return this.ctx.storage.transaction(async transaction => {
      const record = await transaction.get<AuthRecord>('record')
      if (record?.kind !== 'pairing' || record.expiresAt <= Date.now() || !record.user) return null
      await transaction.delete('record')
      return record.user
    })
  }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll() }
}

export class AccountData extends DurableObject<Env> {
  private queue: Promise<void> = Promise.resolve()
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS account_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    if (!this.read<SyncDocument>('document')) this.write('document', { revision: 0, data: initialSyncData() })
  }
  private read<T>(key: string): T | null {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM account_state WHERE key = ?', key).toArray()[0]
    return row ? JSON.parse(row.value) as T : null
  }
  private write(key: string, value: unknown): void {
    this.ctx.storage.sql.exec('INSERT INTO account_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value))
  }
  // 外部APIへの通信中にも別端末が書き込めるため、アカウント単位の更新を直列化する。
  private async serialize<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }
  async getDocument(): Promise<SyncDocument> { return this.read<SyncDocument>('document')! }
  async replaceDocument(revision: number, data: SyncData): Promise<SyncDocument | null> {
    return this.serialize(() => {
      const current = this.read<SyncDocument>('document')!
      if (current.revision !== revision) return null
      if (!isSyncData(data) || new TextEncoder().encode(JSON.stringify(data)).length > MAX_SYNC_BYTES) throw new Error('同期データが不正、または上限を超えています')
      const next = { revision: revision + 1, data }
      this.write('document', next)
      return next
    })
  }
  async saveTokens(tokens: GoogleTokens): Promise<void> {
    return this.serialize(async () => {
      const encrypted = this.read<string>('tokens')
      let old: SavedTokens | null = null
      if (encrypted) {
        try { old = await unseal<SavedTokens>(encrypted, this.env.GOOGLE_TOKEN_ENCRYPTION_KEY!) }
        catch { if (!tokens.refresh_token) throw new Error('暗号化キーが変わりました。Googleカレンダーを再認証してください') }
      }
      const record: SavedTokens = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || old?.refreshToken || '', expiresAt: Date.now() + tokens.expires_in * 1000, scope: tokens.scope ?? old?.scope ?? '' }
      this.write('tokens', await seal(record, this.env.GOOGLE_TOKEN_ENCRYPTION_KEY!))
    })
  }
  private async accessToken(): Promise<string> {
    const encrypted = this.read<string>('tokens')
    if (!encrypted) throw new Error('Googleカレンダーを連携してください')
    const tokens = await unseal<SavedTokens>(encrypted, this.env.GOOGLE_TOKEN_ENCRYPTION_KEY!)
    if (tokens.expiresAt > Date.now() + 60_000) return tokens.accessToken
    if (!tokens.refreshToken) throw new Error('Googleカレンダーの再連携が必要です')
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: this.env.GOOGLE_CLIENT_ID!, client_secret: this.env.GOOGLE_CLIENT_SECRET!, refresh_token: tokens.refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Googleの認証期限が切れました。再連携してください')
    const fresh = await response.json<GoogleTokens>()
    tokens.accessToken = fresh.access_token; tokens.expiresAt = Date.now() + fresh.expires_in * 1000
    if (fresh.refresh_token) tokens.refreshToken = fresh.refresh_token
    this.write('tokens', await seal(tokens, this.env.GOOGLE_TOKEN_ENCRYPTION_KEY!))
    return tokens.accessToken
  }
  private async google(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${await this.accessToken()}`)
    if (init.body) headers.set('Content-Type', 'application/json')
    return fetch(`https://www.googleapis.com/calendar/v3${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) })
  }
  async listCalendars(): Promise<Array<{ id: string; name: string; timeZone: string }>> {
    return this.serialize(async () => {
      const calendars: Array<{ id: string; name: string; timeZone: string }> = []
      let page: string | undefined
      do {
        const query = new URLSearchParams({ minAccessRole: 'owner', maxResults: '100' })
        if (page) query.set('pageToken', page)
        const response = await this.google(`/users/me/calendarList?${query}`)
        if (!response.ok) throw new GoogleApiError(response.status)
        const result = await response.json<{ items?: Array<{ id: string; summary: string; timeZone: string }>; nextPageToken?: string }>()
        calendars.push(...(result.items ?? []).map(item => ({ id: item.id, name: item.summary, timeZone: item.timeZone || 'Asia/Tokyo' })))
        page = result.nextPageToken
      } while (page && calendars.length < 1000)
      return calendars
    })
  }
  async calendarStatus(): Promise<{ id: string; name: string; timeZone: string } | null> {
    const current = this.read<CalendarState>('calendar')
    return current ? { id: current.id, name: current.name, timeZone: current.timeZone } : null
  }
  async configureCalendar(selection: { id: string; name: string; timeZone: string } | null): Promise<void> {
    return this.serialize(() => {
      const old = this.read<CalendarState>('calendar')
      if (old) this.write(`calendar-history:${old.id}`, old)
      const prior = selection ? (old?.id === selection.id ? old : this.read<CalendarState>(`calendar-history:${selection.id}`)) : null
      this.write('calendar', selection ? { ...selection, links: prior?.links ?? {}, syncToken: prior?.syncToken } : null)
    })
  }
  async synchronizeCalendar(): Promise<{ imported: number; exported: number; skipped: number; more: boolean }> {
    return this.serialize(async () => {
      const current = this.read<SyncDocument>('document')!
      const calendar = this.read<CalendarState>('calendar')
      if (!calendar) throw new Error('同期するカレンダーを選択してください')
      const result = await synchronizeCalendar(current.data, calendar, (path, init) => this.google(path, init))
      if (!isSyncData(result.data) || new TextEncoder().encode(JSON.stringify(result.data)).length > MAX_SYNC_BYTES) throw new Error('同期後のデータが上限を超えています')
      this.ctx.storage.transactionSync(() => {
        this.write('document', { revision: current.revision + 1, data: result.data })
        this.write('calendar', result.calendar)
      })
      return { imported: result.imported, exported: result.exported, skipped: result.skipped, more: result.more }
    })
  }
  async disconnectCalendar(): Promise<void> {
    return this.serialize(async () => {
      const encrypted = this.read<string>('tokens')
      if (encrypted) {
        const tokens = await unseal<SavedTokens>(encrypted, this.env.GOOGLE_TOKEN_ENCRYPTION_KEY!)
        const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', body: new URLSearchParams({ token: tokens.refreshToken || tokens.accessToken }), signal: AbortSignal.timeout(15_000) })
        if (!response.ok && response.status !== 400) throw new Error('Googleの権限解除に失敗しました。もう一度お試しください')
      }
      this.ctx.storage.transactionSync(() => {
        // 再連携時に同じ予定を二重登録しないよう、認証情報とは別に予定IDの対応を保持する。
        const calendar = this.read<CalendarState>('calendar')
        if (calendar) this.write(`calendar-history:${calendar.id}`, calendar)
        this.ctx.storage.sql.exec('DELETE FROM account_state WHERE key IN (?, ?)', 'tokens', 'calendar')
      })
    })
  }
}
