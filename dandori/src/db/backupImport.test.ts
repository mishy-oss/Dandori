import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createBackup } from './backupRepo'
import { accountBackupData, isBackupData, MAX_BACKUP_BYTES, parseBackup, replaceBackupData } from './backupImport'
import { createProject } from './projectRepo'
import { createIssue, deleteIssue } from './issueRepo'
import { carryoverIssue } from './carryoverRepo'
import { updateSettings } from './settingsRepo'
import { readSyncData } from '../features/account/accountRepo'
import { initialSyncData, isSyncData } from '../features/account/syncModel'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })

async function backupFixture() {
  const project = await createProject({ key: 'APP', name: '復元元' })
  const parent = await createIssue({ projectId: project.id, title: '親', labels: ['仕事', '顧客,相談'] })
  await createIssue({ projectId: project.id, title: '子', parentId: parent.id })
  await createIssue({ projectId: project.id, title: '繰り返し', date: '2027-01-01', planningMonth: '2027-01', startMin: 540, recurrence: { frequency: 'daily', interval: 1, endDate: '2027-01-02' } })
  const source = await createIssue({ projectId: project.id, title: '持ち越し', date: '2027-01-01', startMin: 600 })
  await carryoverIssue(source.id, { date: '2027-01-02', startMin: 660, durationMin: 30 })
  const deleted = await createIssue({ projectId: project.id, title: '削除済み' })
  await deleteIssue(deleted.id)
  await updateSettings({ defaultDuration: 45, lastBackupAt: 123 })
  await db.sprints.put({ id: 'legacy', projectId: project.id, name: '旧スプリント', startDate: '2026-01-01', endDate: '2026-01-14', state: 'closed', snapshots: [{ date: '2026-01-01', remainingMin: 30, remainingCount: 1 }], createdAt: 1, updatedAt: 1, deletedAt: null })
  await db.monthlySnapshots.put({ id: `${project.id}:2027-01-01`, projectId: project.id, month: '2027-01', date: '2027-01-01', totalCount: 4, remainingCount: 3 })
  return parseBackup(JSON.stringify(await createBackup('dark')))
}

it('round-trips the existing export format, including parent links, carryover, recurrence templates, tombstones and settings', async () => {
  const file = await backupFixture()
  expect(isBackupData(file.data)).toBe(true)
  for (const table of db.tables) await table.clear()
  const other = await createProject({ key: 'NEW', name: '現在' })
  await createIssue({ projectId: other.id, title: '置き換え対象' })
  const before = await readSyncData()
  await replaceBackupData(file, before)
  expect(await readSyncData()).toEqual(file.data)
  expect(await db.accountSync.count()).toBe(0)
  expect(file.theme).toBe('dark')
  expect(file.data.issues.some(issue => issue.carryoverFromId)).toBe(true)
  expect(file.data.recurrenceRules[0].template?.title).toBe('繰り返し')
})

it('rejects malformed files and unsupported versions before modifying any stored data', async () => {
  const file = await backupFixture()
  const before = await readSyncData()
  const invalid: unknown[] = [null, {}, { ...file, formatVersion: 2 }, { ...file, databaseVersion: db.verno + 1 }, { ...file, theme: 'invalid' }, { ...file, exportedAt: 'invalid' }]
  expect(() => parseBackup('{broken')).toThrow('JSON')
  for (const value of invalid) expect(() => parseBackup(JSON.stringify(value))).toThrow()
  expect(() => parseBackup(' '.repeat(MAX_BACKUP_BYTES + 1))).toThrow('20MB')
  expect(await readSyncData()).toEqual(before)
})

it('rejects impossible dates, dangling and cyclic parents, duplicate IDs, invalid settings and broken carryover links', async () => {
  const file = await backupFixture()
  const edits = [
    (data: typeof file.data) => { data.issues[0].date = '2026-02-30' },
    (data: typeof file.data) => { data.issues[0].parentId = 'missing' },
    (data: typeof file.data) => { data.issues[0].rank = 'invalid-rank' },
    (data: typeof file.data) => { data.issues[0].parentId = data.issues[0].id },
    (data: typeof file.data) => { data.issues.push({ ...data.issues[0] }) },
    (data: typeof file.data) => { data.settings[0].defaultDuration = 1 },
    (data: typeof file.data) => { data.issues[0].startMin = 1439; data.issues[0].date = '2026-11-22'; data.issues[0].durationMin = 30 },
    (data: typeof file.data) => { data.issues.find(issue => issue.carryoverFromId)!.carryoverFromId = 'missing' },
    (data: typeof file.data) => { data.recurrenceRules[0].template!.parentId = 'missing' },
    (data: typeof file.data) => { data.monthlySnapshots[0].month = '2026-99' },
  ]
  for (const edit of edits) {
    const invalid = structuredClone(file)
    edit(invalid.data)
    expect(() => parseBackup(JSON.stringify(invalid))).toThrow('内容が不正')
  }
  expect(await readSyncData()).toEqual(file.data)
})

it('rolls all tables back if a write fails after clearing the first tables', async () => {
  const file = await backupFixture()
  const before = await readSyncData()
  const fail = () => { throw new Error('容量不足の再現') }
  db.issues.hook('creating', fail)
  try { await expect(replaceBackupData(file, before)).rejects.toThrow('容量不足') }
  finally { db.issues.hook('creating').unsubscribe(fail) }
  expect(await readSyncData()).toEqual(before)
})

it('refuses to replace data changed after the review snapshot', async () => {
  const file = await backupFixture()
  const before = await readSyncData()
  const issue = file.data.issues[0]
  await db.issues.update(issue.id, { title: '確認後の編集' })
  await expect(replaceBackupData(file, before)).rejects.toThrow('確認中にデータが更新')
  expect((await db.issues.get(issue.id))?.title).toBe('確認後の編集')
})

it('maps local project and status IDs into an account without losing relationships or importing login metadata', async () => {
  const file = await backupFixture()
  const result = accountBackupData(file.data, initialSyncData(0))
  expect(isSyncData(result)).toBe(true)
  expect(result.projects[0].id).toBe('account-project')
  expect(result.issues.map(issue => issue.id)).toEqual(file.data.issues.map(issue => issue.id))
  expect(result.issues.map(issue => issue.parentId)).toEqual(file.data.issues.map(issue => issue.parentId))
  expect(result.issues.map(issue => issue.number)).toEqual(file.data.issues.map(issue => issue.number))
  expect(result.issues.every(issue => issue.statusId.startsWith('account-'))).toBe(true)
  expect(result.recurrenceRules[0].template).toEqual(file.data.recurrenceRules[0].template)
  expect(result.settings).toEqual(file.data.settings)
  expect(result).not.toHaveProperty('accountSync')
})

it('accepts an empty export and a UTF-8 BOM', async () => {
  const file = await createBackup('system')
  expect(parseBackup(`\uFEFF${JSON.stringify(file)}`).data.projects).toEqual([])
  expect(isSyncData(accountBackupData(file.data, initialSyncData(0)))).toBe(true)
})

it('merges multiple local projects into the account without duplicate numbers or losing same-day totals', async () => {
  const one = await createProject({ key: 'ONE', name: '一つ目' })
  const two = await createProject({ key: 'TWO', name: '二つ目' })
  await createIssue({ projectId: one.id, title: '番号1-A' })
  await createIssue({ projectId: two.id, title: '番号1-B' })
  for (const project of [one, two]) await db.monthlySnapshots.put({ id: `${project.id}:2026-11-20`, projectId: project.id, date: '2026-11-20', month: '2026-11', totalCount: 1, remainingCount: 1 })
  const file = parseBackup(JSON.stringify(await createBackup('system')))
  const account = accountBackupData(file.data, initialSyncData(0))
  expect(isSyncData(account)).toBe(true)
  expect(new Set(account.issues.map(issue => issue.number)).size).toBe(2)
  expect(account.monthlySnapshots).toEqual([{ id: 'account-project:2026-11-20', projectId: 'account-project', date: '2026-11-20', month: '2026-11', totalCount: 2, remainingCount: 2 }])
})
