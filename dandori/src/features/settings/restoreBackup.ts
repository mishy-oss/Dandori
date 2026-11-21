import { inTransaction } from '../../db/transaction'
import { createBackup } from '../../db/backupRepo'
import { accountBackupData, parseBackup, replaceBackupData, type BackupFile } from '../../db/backupImport'
import { db } from '../../db/db'
import { acceptSyncedData, readSyncData } from '../account/accountRepo'
import { AccountApiError, accountApi, useAccountStore } from '../account/accountStore'
import { isSyncData, MAX_SYNC_BYTES, sameValue, type SyncData, type SyncDocument } from '../account/syncModel'
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
      // 古い確認画面のまま他端末の新しい内容を消さないよう、確認時のリビジョンで一度だけ書き込む。
      let result: SyncDocument
      try {
        result = await accountApi<SyncDocument>('/api/account/sync', { method: 'PUT', body: JSON.stringify({ revision: session.cloud.revision, data: target }) })
      } catch (cause) {
        if (cause instanceof AccountApiError && [401, 403, 409, 413].includes(cause.status)) throw cause
        // 応答だけが途切れた場合もあるため、書き込みを繰り返す前に結果を読み直す。
        try {
          const confirmed = await accountApi<SyncDocument>('/api/account/sync')
          if (!sameValue(confirmed.data, target)) throw new Error('unconfirmed', { cause })
          result = confirmed
        } catch {
          useAccountStore.setState({ conflicts: ['バックアップ復元の完了確認が必要です'] })
          throw new Error('クラウドへの復元の完了を確認できませんでした。反映済みの場合があるため自動同期を止めました。復元前のJSONを保存し、接続を確認してJSONを選び直してください。')
        }
      }
      if (!isSyncData(result.data)) throw new Error('クラウドの応答を確認できませんでした。タスクを再同期してください。')
      try { await acceptSyncedData(session.captured, result) }
      catch {
        useAccountStore.setState({ conflicts: ['クラウドの復元後、端末への保存が必要です'] })
        throw new Error('クラウドへの復元は完了しましたが、この端末への保存に失敗しました。自動同期を止めました。復元前のJSONを保存し、端末の空き容量などを確認してJSONを選び直してください。')
      }
      useAccountStore.setState({ conflicts: [], lastSyncedAt: Date.now(), error: null })
    } else {
      await replaceBackupData(backup, session.captured)
    }
    try { await useDataStore.getState().refreshPlanning() }
    catch { return 'データは復元しましたが、画面の更新に失敗しました。アプリを再読み込みしてください。' }
    return null
  } finally { useAccountStore.setState({ busy: false }) }
}
