import { db, DandoriDB } from '../../db/db'
import { initialSyncData, mergeSyncData, SYNC_TABLES, type SyncData, type SyncDocument } from './syncModel'

export async function readSyncData(database: DandoriDB = db): Promise<SyncData> {
  return database.transaction('r', database.tables, async () => ({
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
  await db.transaction('rw', db.tables, async () => {
    if (await db.projects.count()) return
    const data = initialSyncData(0)
    await putData(data)
    await db.accountSync.put({ id: 'main', revision: 0, baseline: data, lastSyncedAt: 0 })
  })
}
// 通信中の編集を消さないよう、取得時点以降の端末変更を同じトランザクション内で重ねる。
export async function acceptSyncedData(captured: SyncData, cloud: SyncDocument): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    const current = await readSyncData()
    const next = mergeSyncData(captured, current, cloud.data, 'local').data
    await putData(next)
    await db.accountSync.put({ id: 'main', revision: cloud.revision, baseline: cloud.data, lastSyncedAt: Date.now() })
  })
}
export async function saveLocalImport(data: SyncData): Promise<void> {
  await db.transaction('rw', db.tables, () => putData(data))
}
