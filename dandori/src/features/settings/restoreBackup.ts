import { inTransaction } from '../../db/transaction'
import { createBackup } from '../../db/backupRepo'
import { accountBackupData, parseBackup, replaceBackupData, type BackupFile } from '../../db/backupImport'
import { db } from '../../db/db'
import { newId } from '../../lib/id'
import { beginAccountRestore, clearRejectedAccountRestore, finishAccountRestore, markAccountRestoreRetry, readAccountSyncSnapshot, readSyncData, RESTORE_PENDING_MESSAGE } from '../account/accountRepo'
import { AccountApiError, accountApi, useAccountStore } from '../account/accountStore'
import { isSyncData, MAX_SYNC_BYTES, sameValue, type PendingAccountRestore, type SyncData, type SyncDocument } from '../account/syncModel'
import { useDataStore } from '../../store/data'
import type { ThemeSetting } from '../../store/theme'

export interface PreparedRestore {
  backup: BackupFile
  before: BackupFile
  captured: SyncData
  cloudBefore?: BackupFile
  cloud?: SyncDocument
  accountId: string | null
  databaseName: string
}

export async function prepareBackupRestore(file: BackupFile, theme: ThemeSetting): Promise<PreparedRestore> {
  const backup = parseBackup(JSON.stringify(file))
  const state = useAccountStore.getState()
  if (state.busy) throw new Error('同期処理が終わってから、もう一度JSONを選んでください。')
  if (state.user && !state.authenticated) throw new Error('Google連携中の復元には再ログインとオンライン接続が必要です。')
  if (state.calendar) throw new Error('Googleカレンダー連携を解除してから復元してください。解除してもGoogleの予定は残ります。復元後に改めて連携できます。')
  useAccountStore.setState({ busy: true })
  try {
    const { before, captured } = await inTransaction(db, 'r', db.tables, async () => ({ before: await createBackup(theme), captured: await readSyncData() }))
    const session: PreparedRestore = { backup, before, captured, accountId: state.user?.id ?? null, databaseName: db.name }
    if (state.user) {
      if ((await db.accountSync.get('main'))?.pendingRestore) throw new Error(RESTORE_PENDING_MESSAGE)
      const cloud = await accountApi<SyncDocument>('/api/account/sync')
      if (!isSyncData(cloud.data) || !Number.isInteger(cloud.revision) || cloud.revision < 0) throw new Error('クラウドの状態を確認できませんでした。復元は実行していません。')
      const target = accountBackupData(backup.data, cloud.data)
      assertSyncSize(target)
      session.cloud = cloud
      session.cloudBefore = parseBackup(JSON.stringify({ ...before, data: cloud.data }))
    }
    return session
  } finally { useAccountStore.setState({ busy: false }) }
}

function assertSyncSize(data: SyncData) {
  if (new TextEncoder().encode(JSON.stringify(data)).byteLength > MAX_SYNC_BYTES) throw new Error('アカウント同期の容量上限（1MB）を超えています。端末モードで復元してください。')
}

export async function restorePreparedBackup(session: PreparedRestore): Promise<string | null> {
  const backup = parseBackup(JSON.stringify(session.backup))
  const state = useAccountStore.getState()
  if (state.busy) throw new Error('同期処理中です。完了後に再試行してください。')
  if (db.name !== session.databaseName || (state.user?.id ?? null) !== session.accountId) throw new Error('利用中のアカウントが変わりました。JSONを選び直してください。')
  if (state.calendar) throw new Error('Googleカレンダー連携を解除してから復元してください。')
  if (session.accountId && !state.authenticated) throw new Error('再ログインしてからJSONを選び直してください。')
  useAccountStore.setState({ busy: true })
  try {
    const current = await readSyncData()
    if (!sameValue(current, session.captured)) throw new Error('確認中にデータが更新されました。JSONを選び直して、最新の状態で確認してください。')
    if (session.accountId) {
      if (!session.cloud) throw new Error('クラウドの確認情報がありません。JSONを選び直してください。')
      const target = accountBackupData(backup.data, session.cloud.data)
      assertSyncSize(target)
      const pending: PendingAccountRestore = { id: newId(), accountId: session.accountId, expectedRevision: session.cloud.revision, target, theme: backup.theme }
      // PUTの結果が分かる前に終了しても、次の起動で通常同期を先に走らせない。
      await beginAccountRestore(pending, session.captured)
      useAccountStore.setState({ restorePending: true })
      let result: SyncDocument
      try {
        result = await writeRestoreTarget(pending)
      } catch (cause) {
        if (isRejectedRestore(cause) && await clearRejectedAccountRestore(pending.id)) {
          useAccountStore.setState({ restorePending: false })
        }
        throw cause
      }
      await applyCloudRestore(pending, result, session.captured)
    } else {
      await replaceBackupData(backup, session.captured)
    }
    return refreshRestoredData()
  } finally { useAccountStore.setState({ busy: false }) }
}

function isRejectedRestore(cause: unknown): boolean {
  return cause instanceof AccountApiError && [400, 401, 403, 409, 413].includes(cause.status)
}

function isSyncDocument(value: SyncDocument): boolean {
  return Number.isInteger(value?.revision) && value.revision >= 0 && isSyncData(value.data)
}

async function writeRestoreTarget(pending: PendingAccountRestore): Promise<SyncDocument> {
  try {
    const result = await accountApi<SyncDocument>('/api/account/sync', { method: 'PUT', body: JSON.stringify({ revision: pending.expectedRevision, data: pending.target }) })
    if (isSyncDocument(result) && result.revision > pending.expectedRevision && sameValue(result.data, pending.target)) return result
  } catch (cause) {
    if (isRejectedRestore(cause)) throw cause
  }
  // 応答だけが途切れた場合もあるので、同じ書き込みを続けて送らない。
  try {
    const confirmed = await accountApi<SyncDocument>('/api/account/sync')
    if (isSyncDocument(confirmed) && sameValue(confirmed.data, pending.target)) return confirmed
  } catch { /* GETの失敗も、PUTが未反映である証拠にはならない。 */ }
  throw new Error('クラウドへの復元を確認できませんでした。接続を確認して「復元を再開」を押してください。')
}

async function applyCloudRestore(pending: PendingAccountRestore, cloud: SyncDocument, expected: SyncData) {
  try { await finishAccountRestore(pending.id, cloud, expected) }
  catch (cause) {
    const detail = cause instanceof Error && cause.message.startsWith('端末のデータが更新') ? ` ${cause.message}` : ''
    const status = sameValue(cloud.data, pending.target) ? 'クラウドへの復元は完了しましたが、' : 'クラウドの内容は確認できましたが、'
    throw new Error(`${status}この端末への保存に失敗しました。${detail} 端末のJSONを保存して復元を再開してください。`, { cause })
  }
  useAccountStore.setState({ restorePending: false, conflicts: [], lastSyncedAt: Date.now(), error: null })
}

async function refreshRestoredData(): Promise<string | null> {
  try { await useDataStore.getState().refreshPlanning() }
  catch { return 'データは復元しましたが、画面の更新に失敗しました。アプリを再読み込みしてください。' }
  return null
}

export async function resumeAccountRestore(useCurrentCloud = false): Promise<{ warning: string | null; theme?: ThemeSetting }> {
  const state = useAccountStore.getState()
  if (state.busy) throw new Error('同期処理中です。完了後に再試行してください。')
  if (!state.user || !state.authenticated) throw new Error('復元を再開するには、同じGoogleアカウントへログインしてください。')
  if (state.calendar) throw new Error('Googleカレンダー連携を解除してから復元を再開してください。')
  useAccountStore.setState({ busy: true })
  try {
    const { metadata, data: captured } = await readAccountSyncSnapshot()
    const pending = metadata?.pendingRestore
    if (!pending) {
      useAccountStore.setState({ restorePending: false })
      throw new Error('再開する復元はありません。')
    }
    if (pending.accountId !== state.user.id) throw new Error('復元を開始したGoogleアカウントでログインしてください。')
    const cloud = await accountApi<SyncDocument>('/api/account/sync')
    if (!isSyncDocument(cloud) || cloud.revision < pending.expectedRevision) throw new Error('現在のクラウドの状態を確認できませんでした。再試行してください。')
    const matchesTarget = sameValue(cloud.data, pending.target)
    let result = cloud
    if (!matchesTarget && cloud.revision === pending.expectedRevision) {
      if (useCurrentCloud) throw new Error('クラウドの版は確認時と同じです。「復元を再開」を押してください。')
      await markAccountRestoreRetry(pending.id)
      result = await writeRestoreTarget(pending)
    } else if (!matchesTarget && !useCurrentCloud) {
      throw new Error('別の端末でクラウドが更新されています。設定にある「現在のクラウドを端末に反映」を確認してください。')
    }
    await applyCloudRestore(pending, result, captured)
    const warning = await refreshRestoredData()
    return { warning, ...(!useCurrentCloud || matchesTarget ? { theme: pending.theme } : {}) }
  } finally { useAccountStore.setState({ busy: false }) }
}
