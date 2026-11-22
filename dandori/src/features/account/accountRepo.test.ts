import { beforeEach, expect, it } from 'vitest'
import { db, DandoriDB } from '../../db/db'
import { acceptSyncedData, initializeAccountDatabase, readSyncData, saveLocalImport } from './accountRepo'
import { fixtureIssue } from './syncFixtures'
import { mergeSyncData } from './syncModel'
import { createIssue, updateIssue } from '../../db/issueRepo'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())); await initializeAccountDatabase() })
it('normalizes all-day schedules and can convert them back into ordinary timed tasks', async () => {
  await expect(createIssue({ projectId: 'account-project', title: '日付なし', calendarAllDay: true })).rejects.toThrow('日付')
  const issue = await createIssue({ projectId: 'account-project', title: '終日予定', date: '2026-11-17', calendarAllDay: true })
  expect(issue).toMatchObject({ startMin: null, durationMin: 1440, calendarAllDay: true })
  await updateIssue(issue.id, { startMin: 540 })
  expect(await db.issues.get(issue.id)).toMatchObject({ startMin: 540, durationMin: 30, calendarAllDay: false })
})
it('keeps edits and new tasks made while a cloud request was in flight', async () => {
  await db.issues.put(fixtureIssue())
  const captured = await readSyncData()
  const cloud = structuredClone(captured)
  cloud.issues.push(fixtureIssue({ id: 'remote', number: 2 }))
  await db.issues.update('task-1', { title: '通信中の変更' })
  await db.issues.put(fixtureIssue({ id: 'local', number: 2 }))
  await acceptSyncedData(captured, { revision: 3, data: cloud })
  expect((await db.issues.get('task-1'))?.title).toBe('通信中の変更')
  expect(await db.issues.count()).toBe(3)
  const metadata = (await db.accountSync.get('main'))!
  expect(metadata.baseline.issues[0].title).toBe('資料を作る')
  expect(metadata.revision).toBe(3)
  const nextSync = mergeSyncData(metadata.baseline, await readSyncData(), cloud)
  expect(nextSync.conflicts).toEqual([])
  expect(nextSync.data.issues.find(issue => issue.id === 'task-1')?.title).toBe('通信中の変更')
  expect(nextSync.data.issues.some(issue => issue.id === 'local')).toBe(true)
})
it('preserves independent local databases and does not mark an import as uploaded', async () => {
  const other = new DandoriDB('account-repo-other-test')
  try {
    await other.issues.put(fixtureIssue({ title: '別アカウント' }))
    const local = await readSyncData(); local.issues.push(fixtureIssue())
    await saveLocalImport(local)
    expect((await other.issues.get('task-1'))?.title).toBe('別アカウント')
    expect((await db.accountSync.get('main'))?.baseline.issues).toEqual([])
  } finally { await other.delete() }
})
