import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createBackup } from './backupRepo'
import { createProject } from './projectRepo'
import { createIssue, deleteIssue } from './issueRepo'
import { updateSettings, getSettings } from './settingsRepo'
import { DEFAULT_SETTINGS } from './types'

beforeEach(async () => {
  await Promise.all(db.tables.map((table) => table.clear()))
})

it('exports an empty database with default settings and theme', async () => {
  const backup = JSON.parse(JSON.stringify(await createBackup('dark')))
  expect(backup).toMatchObject({ format: 'dandori-backup', formatVersion: 1, databaseVersion: db.verno, theme: 'dark' })
  expect(Number.isFinite(Date.parse(backup.exportedAt))).toBe(true)
  expect(backup.data.settings).toEqual([DEFAULT_SETTINGS])
  expect(backup.data.issues).toEqual([])
  expect((await getSettings()).lastBackupAt).toBeNull()
  expect(await db.settings.count()).toBe(0)
})

it('preserves all saved data and relationships through JSON serialization', async () => {
  const project = await createProject({ key: 'APP', name: '仕事' })
  const parent = await createIssue({ projectId: project.id, title: '親', labels: ['仕事', '顧客,相談'] })
  await createIssue({ projectId: project.id, title: '子', parentId: parent.id })
  const deleted = await createIssue({ projectId: project.id, title: '削除済み' })
  await deleteIssue(deleted.id)
  await createIssue({ projectId: project.id, title: '繰り返し', planningMonth: '2027-01', date: '2027-01-01', recurrence: { frequency: 'daily', interval: 1, endDate: '2027-01-02' } })
  await db.sprints.put({ id: 'legacy', projectId: project.id, name: '旧スプリント', startDate: '2026-01-01', endDate: '2026-01-14', state: 'closed', snapshots: [], createdAt: 1, updatedAt: 1, deletedAt: null })
  await db.monthlySnapshots.put({ id: 'history', projectId: project.id, month: '2026-01', date: '2026-01-01', totalCount: 2, remainingCount: 1 })
  await updateSettings({ lastBackupAt: 123, defaultDuration: 45 })
  const backup = JSON.parse(JSON.stringify(await createBackup('system')))
  for (const table of db.tables) {
    expect(backup.data[table.name]).toEqual(await table.toArray())
  }
  expect(backup.data.issues.find((issue: { id: string }) => issue.id === deleted.id).deletedAt).not.toBeNull()
  expect(backup.data.issues.find((issue: { id: string }) => issue.id === parent.id).labels).toEqual(['仕事', '顧客,相談'])
  expect((await getSettings()).lastBackupAt).toBe(123)
})
