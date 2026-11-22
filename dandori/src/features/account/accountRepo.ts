import { inTransaction } from '../../db/transaction'
import { db, DandoriDB } from '../../db/db'
import { initialSyncData, mergeSyncData, sameValue, SYNC_TABLES, type PendingAccountRestore, type SyncData, type SyncDocument } from './syncModel'

export const RESTORE_PENDING_MESSAGE = 'バックアップの復元が途中です。設定の「バックアップ」から復元を再開してください。'
const LOCAL_DATA_CHANGED = '端末のデータが更新されました。必要なJSONを保存し、最新の状態でやり直してください。'

export function readAccountSyncSnapshot() {
  return inTransaction(db, 'r', db.tables, async () => ({
    metadata: await db.accountSync.get('main'),
    data: await readSyncData(),
  }))
}

export async function beginAccountRestore(pendingRestore: PendingAccountRestore, expected: SyncData) {
  await inTransaction(db, 'rw', db.tables, async () => {
    const metadata = await db.accountSync.get('main')
    if (metadata?.pendingRestore) throw new Error(RESTORE_PENDING_MESSAGE)
    if (!sameValue(await readSyncData(), expected)) throw new Error(LOCAL_DATA_CHANGED)
    await db.accountSync.put({ ...(metadata ?? { id: 'main', revision: 0, baseline: initialSyncData(0), lastSyncedAt: 0 }), pendingRestore })
  })
}

export async function clearRejectedAccountRestore(id: string): Promise<boolean> {
  return inTransaction(db, 'rw', [db.accountSync], async () => {
    const metadata = await db.accountSync.get('main')
    // 別のタブで再試行が始まっていれば、最初のPUTの失敗だけでは未反映と判断できない。
    if (metadata?.pendingRestore?.id !== id || metadata.pendingRestore.retryStarted) return false
    delete metadata.pendingRestore
    await db.accountSync.put(metadata)
    return true
  })
}

export async function markAccountRestoreRetry(id: string) {
  await inTransaction(db, 'rw', [db.accountSync], async () => {
    const metadata = await db.accountSync.get('main')
    if (metadata?.pendingRestore?.id !== id) throw new Error('復元の状態が変わりました。画面を開き直してください。')
    metadata.pendingRestore.retryStarted = true
    await db.accountSync.put(metadata)
  })
}

export async function finishAccountRestore(id: string, cloud: SyncDocument, expected: SyncData) {
  await inTransaction(db, 'rw', db.tables, async () => {
    const metadata = await db.accountSync.get('main')
    if (metadata?.pendingRestore?.id !== id) throw new Error('復元の状態が変わりました。画面を開き直してください。')
    if (!sameValue(await readSyncData(), expected)) throw new Error(LOCAL_DATA_CHANGED)
    await putData(cloud.data)
    await db.accountSync.put({ id: 'main', revision: cloud.revision, baseline: cloud.data, lastSyncedAt: Date.now() })
  })
}

export class StatusSyncConflictError extends Error {
  constructor(readonly conflicts: string[]) {
    super('同期中の変更で、タスクが参照するステータスに競合が発生しました。優先する内容を選択してください。削除を優先すると、該当タスクは別のステータスに移ります。')
  }
}

export async function readSyncData(database: DandoriDB = db): Promise<SyncData> {
  return inTransaction(database, 'r', database.tables, async () => ({
    projects: await database.projects.toArray(), workflows: await database.workflows.toArray(), issues: await database.issues.toArray(),
    recurrenceRules: await database.recurrenceRules.toArray(), sprints: await database.sprints.toArray(), settings: await database.settings.toArray(), monthlySnapshots: await database.monthlySnapshots.toArray(),
  }))
}
async function putData(data: SyncData, database = db): Promise<void> {
  for (const name of SYNC_TABLES) {
    const table = database.table(name)
    await table.clear()
    if (data[name].length) await table.bulkPut(data[name])
  }
}
export async function initializeAccountDatabase(): Promise<void> {
  await inTransaction(db, 'rw', db.tables, async () => {
    if (await db.projects.count()) return
    const data = initialSyncData(0)
    await putData(data)
    await db.accountSync.put({ id: 'main', revision: 0, baseline: data, lastSyncedAt: 0 })
  })
}
// 通信中の編集を消さないよう、取得時点以降の端末変更を同じトランザクション内で重ねる。
export async function acceptSyncedData(captured: SyncData, cloud: SyncDocument, expectedRevision?: number | null): Promise<void> {
  await inTransaction(db, 'rw', db.tables, async () => {
    const metadata = await db.accountSync.get('main')
    if (metadata?.pendingRestore) throw new Error(RESTORE_PENDING_MESSAGE)
    if (expectedRevision !== undefined && (metadata?.revision ?? null) !== expectedRevision) {
      throw new Error('別の画面で同期または復元が完了しました。もう一度同期してください。')
    }
    const current = await readSyncData()
    const merged = mergeSyncData(captured, current, cloud.data, 'local')
    if (merged.statusConflicts.length) throw new StatusSyncConflictError(merged.statusConflicts)
    await putData(merged.data)
    // 通信中に端末へ加わった未送信データを、次回の同期でも変更として拾う。
    await db.accountSync.put({ id: 'main', revision: cloud.revision, baseline: cloud.data, lastSyncedAt: Date.now() })
  })
}
export async function saveLocalImport(data: SyncData): Promise<void> {
  await inTransaction(db, 'rw', db.tables, () => putData(data))
}
