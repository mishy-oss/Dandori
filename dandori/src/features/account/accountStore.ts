import { create } from 'zustand'
import { db, DandoriDB } from '../../db/db'
import { useDataStore } from '../../store/data'
import { readActiveAccount, selectAccount, type AccountIdentity } from './accountIdentity'
import { acceptSyncedData, initializeAccountDatabase, readSyncData, saveLocalImport } from './accountRepo'
import { importGuestData, initialSyncData, isSyncData, mergeSyncData, sameValue, type ConflictChoice, type SyncDocument } from './syncModel'

export interface CalendarSelection { id: string; name: string; timeZone: string }
interface AccountState {
  user: AccountIdentity | null
  enabled: boolean | null
  authenticated: boolean
  busy: boolean
  error: string | null
  calendarError: string | null
  message: string | null
  conflicts: string[]
  calendar: CalendarSelection | null
  calendars: CalendarSelection[]
  lastSyncedAt: number
}
export const useAccountStore = create<AccountState>(() => ({ user: readActiveAccount(), enabled: null, authenticated: false, busy: false, error: null, calendarError: null, message: null, conflicts: [], calendar: null, calendars: [], lastSyncedAt: 0 }))
export class AccountApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}
export async function accountApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (path.startsWith('/api/account/')) headers.set('X-Dandori-Account', useAccountStore.getState().user?.id ?? '')
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(90_000) })
  if (!response.ok) {
    let message = response.status === 401 ? '再ログインが必要です。端末内のタスクは保存されています。' : '通信に失敗しました。接続を確認して再試行してください。'
    try { const body = await response.json() as { error?: string }; if (body.error) message = body.error } catch { /* HTMLのエラーページをアプリ内に表示しない。 */ }
    if (response.status === 401) useAccountStore.setState({ authenticated: false })
    throw new AccountApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}
let boot: Promise<void> | undefined
export async function prepareAccountCache(): Promise<void> {
  if (readActiveAccount()) await initializeAccountDatabase()
}
const PAIR_KEY = 'dandori_google_pair'
const PAIR_CALENDAR_KEY = 'dandori_google_pair_calendar'
export async function resumeGoogleLogin(reload = true): Promise<boolean> {
  const secret = sessionStorage.getItem(PAIR_KEY)
  if (!secret) return false
  try {
    const result = await accountApi<{ user?: AccountIdentity; pending?: boolean }>('/api/auth/claim', { method: 'POST', body: JSON.stringify({ secret }) })
    if (!result.user) return false
    const calendar = sessionStorage.getItem(PAIR_CALENDAR_KEY) === '1'
    sessionStorage.removeItem(PAIR_KEY)
    sessionStorage.removeItem(PAIR_CALENDAR_KEY)
    if (reload) {
      history.replaceState(null, '', `/?google=${calendar ? 'calendar_connected' : 'connected'}`)
      location.reload()
    }
    return true
  } catch (error) {
    if (error instanceof AccountApiError && error.status === 410) { sessionStorage.removeItem(PAIR_KEY); sessionStorage.removeItem(PAIR_CALENDAR_KEY); useAccountStore.setState({ error: error.message }) }
    return false
  }
}
// iOSでは認証先のSafariとPWAのCookieが別になるため、一度だけ使える確認情報でPWAへログインを引き継ぐ。
export async function startGoogleLogin(calendar = false): Promise<void> {
  await runAccountAction(async () => {
    const result = await accountApi<{ secret: string; loginUrl: string }>('/api/auth/prepare', { method: 'POST', body: JSON.stringify({ calendar }) })
    sessionStorage.setItem(PAIR_KEY, result.secret)
    sessionStorage.setItem(PAIR_CALENDAR_KEY, calendar ? '1' : '0')
    location.assign(result.loginUrl)
  })
}
export function initializeAccount(): Promise<void> {
  return boot ??= (async () => {
    if (readActiveAccount()) await initializeAccountDatabase()
    const metadata = await db.accountSync.get('main')
    useAccountStore.setState({ lastSyncedAt: metadata?.lastSyncedAt ?? 0 })
    const outcome = new URLSearchParams(location.search).get('google')
    if (outcome) {
      const messages: Record<string,string> = { cancelled: 'Google連携をキャンセルしました', invalid_state: '認証の確認に失敗しました。もう一度ログインしてください', expired: '認証の時間が切れました', not_allowed: '許可されたGoogleアカウントでログインしてください', missing_scope: 'カレンダーへのアクセスを許可して再連携してください', failed: 'Googleの認証に失敗しました' }
      useAccountStore.setState({ error: messages[outcome] ?? null, message: outcome === 'calendar_connected' ? 'Googleの許可を取得しました。設定で同期するカレンダーを選択してください。' : null })
    }
    try {
      const config = await accountApi<{ enabled: boolean }>('/api/auth/config')
      useAccountStore.setState({ enabled: config.enabled })
      if (!config.enabled) return
      await resumeGoogleLogin(false)
      const result = await accountApi<{ user: AccountIdentity; calendar: CalendarSelection | null }>('/api/auth/session')
      if (result.user.id !== readActiveAccount()?.id) { selectAccount(result.user); location.reload(); return }
      if (outcome) history.replaceState(null, '', `${location.pathname}${location.hash}`)
      useAccountStore.setState({ user: result.user, authenticated: true, calendar: result.calendar })
    } catch (error) {
      if (!(error instanceof AccountApiError && error.status === 401)) useAccountStore.setState({ error: error instanceof Error ? error.message : 'Google連携を確認できませんでした' })
    }
  })()
}
export async function syncAccount(choice?: ConflictChoice): Promise<boolean> {
  const state = useAccountStore.getState()
  if (!state.user || !state.authenticated || state.busy || (state.conflicts.length && !choice)) return false
  useAccountStore.setState({ busy: true, error: null })
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const captured = await readSyncData()
      const base = (await db.accountSync.get('main'))?.baseline ?? initialSyncData(0)
      const remote = await accountApi<SyncDocument>('/api/account/sync')
      if (!isSyncData(remote.data)) throw new Error('クラウドデータの形式を確認できませんでした')
      const merged = mergeSyncData(base, captured, remote.data, choice)
      if (merged.conflicts.length && !choice) { useAccountStore.setState({ conflicts: merged.conflicts, error: '同じデータが複数の端末で変更されています。優先する内容を選択してください。' }); return false }
      let result = remote
      if (!sameValue(merged.data, remote.data)) {
        try { result = await accountApi<SyncDocument>('/api/account/sync', { method: 'PUT', body: JSON.stringify({ revision: remote.revision, data: merged.data }) }) }
        catch (error) { if (error instanceof AccountApiError && error.status === 409) continue; throw error }
      }
      await acceptSyncedData(captured, result)
      if (!sameValue(captured, result.data)) await useDataStore.getState().refreshPlanning()
      useAccountStore.setState({ conflicts: [], lastSyncedAt: Date.now(), message: 'タスクを同期しました' })
      return true
    }
    throw new Error('別の端末で更新が続いています。少し待って再同期してください')
  } catch (error) { useAccountStore.setState({ error: error instanceof Error ? error.message : String(error) }); return false }
  finally { useAccountStore.setState({ busy: false }) }
}
export async function runAccountAction(action: () => Promise<void>): Promise<void> {
  if (useAccountStore.getState().busy) return
  useAccountStore.setState({ busy: true, error: null })
  try { await action() }
  catch (error) { useAccountStore.setState({ error: error instanceof Error ? error.message : String(error) }) }
  finally { useAccountStore.setState({ busy: false }) }
}
export async function loadCalendars(): Promise<void> {
  const result = await accountApi<{ calendars: CalendarSelection[] }>('/api/account/calendars')
  useAccountStore.setState({ calendars: result.calendars })
}
export async function selectCalendar(id: string): Promise<void> {
  const result = await accountApi<{ calendar: CalendarSelection }>('/api/account/calendar', { method: 'POST', body: JSON.stringify({ id }) })
  useAccountStore.setState({ calendar: result.calendar, calendarError: null, message: 'カレンダーを選択しました。「カレンダーと同期」で反映します。' })
}
export async function syncCalendar(): Promise<void> {
  if (!await syncAccount()) return
  useAccountStore.setState({ calendarError: null })
  let success = false, message = ''
  await runAccountAction(async () => {
    const result = await accountApi<{ imported: number; exported: number; skipped: number; more: boolean }>('/api/account/calendar-sync', { method: 'POST' })
    success = true
    message = `カレンダー：取り込み${result.imported}件・反映${result.exported}件${result.skipped ? `・対象外${result.skipped}件` : ''}${result.more ? '。残りは再度同期してください。' : ''}`
  })
  if (success && await syncAccount()) useAccountStore.setState({ message })
  if (!success) useAccountStore.setState({ calendarError: useAccountStore.getState().error })
}
export async function importDeviceTasks(): Promise<void> {
  await runAccountAction(async () => {
    const guest = new DandoriDB('dandori')
    try {
      const source = await readSyncData(guest), current = await readSyncData()
      const next = importGuestData(source, current)
      await saveLocalImport(next)
      await useDataStore.getState().refreshPlanning()
      useAccountStore.setState({ message: `端末のタスクを${next.issues.length - current.issues.length}件取り込みました。元の端末データも残しています。` })
    } finally { guest.close() }
  })
  await syncAccount()
}
export async function logoutAccount(): Promise<void> {
  await runAccountAction(async () => {
    await accountApi<void>('/api/auth/logout', { method: 'POST' })
    sessionStorage.removeItem(PAIR_KEY)
    sessionStorage.removeItem(PAIR_CALENDAR_KEY)
    selectAccount(null)
    location.reload()
  })
}
