import { afterEach, expect, it, vi } from 'vitest'
import { importGuestData, initialSyncData, isSyncData, mergeSyncData } from './syncModel'
import { fixtureIssue } from './syncFixtures'
import { activeDatabaseName, readActiveAccount, selectAccount } from './accountIdentity'

afterEach(() => vi.unstubAllGlobals())
it('merges independent offline edits and retains tombstones without trusting device clocks', () => {
  const base = initialSyncData(1)
  base.issues = [fixtureIssue(), fixtureIssue({ id: 'task-2', number: 2 })]
  const local = structuredClone(base), remote = structuredClone(base)
  local.issues[0].title = '端末で編集'; local.issues[0].updatedAt = 9999
  remote.issues[1].deletedAt = 10
  const result = mergeSyncData(base, local, remote)
  expect(result.conflicts).toEqual([])
  expect(result.data.issues[0].title).toBe('端末で編集')
  expect(result.data.issues[1].deletedAt).toBe(10)
})
it('detects edits versus deletion and resolves only conflicting rows when explicitly selected', () => {
  const base = initialSyncData(1); base.issues = [fixtureIssue()]
  const local = structuredClone(base), remote = structuredClone(base)
  local.issues[0].title = 'ローカル'; remote.issues[0].deletedAt = 4
  local.issues.push(fixtureIssue({ id: 'new-local', number: 2 }))
  expect(mergeSyncData(base, local, remote).conflicts).toEqual(['ローカル'])
  expect(mergeSyncData(base, local, remote, 'local').data.issues[0].title).toBe('ローカル')
  const cloud = mergeSyncData(base, local, remote, 'remote').data
  expect(cloud.issues[0].deletedAt).toBe(4)
  expect(cloud.issues.some(row => row.id === 'new-local')).toBe(true)
})
it('keeps independently created tasks with duplicate numbers and repairs the counter', () => {
  const base = initialSyncData(1), local = structuredClone(base), remote = structuredClone(base)
  local.issues = [fixtureIssue({ id: 'local-new' })]; remote.issues = [fixtureIssue({ id: 'cloud-new' })]
  local.projects[0].nextNumber = 2; remote.projects[0].nextNumber = 2
  const result = mergeSyncData(base, local, remote)
  expect(result.conflicts).toEqual([])
  expect(result.data.issues.map(row => row.number)).toEqual([1,2])
  expect(result.data.projects[0].nextNumber).toBe(3)
  expect(local.issues[0].number).toBe(1)
  expect(remote.issues[0].number).toBe(1)
})
it('merges project fields independently and uploads local workflow edits with tasks using the new status', () => {
  const base = initialSyncData(0)
  const local = structuredClone(base)
  const remote = initialSyncData(100)
  local.projects[0].name = '端末のプロジェクト名'
  remote.projects[0].color = '#112233'
  local.workflows[0].statuses[0].name = '未着手'
  local.workflows[0].statuses.push({ id: 'queued', name: '待ち', category: 'todo' })
  local.issues.push(fixtureIssue({ statusId: 'queued' }))

  const { data, conflicts } = mergeSyncData(base, local, remote)
  expect(conflicts).toEqual([])
  expect(data.projects[0]).toMatchObject({ name: '端末のプロジェクト名', color: '#112233', createdAt: 100, nextNumber: 2 })
  expect(data.workflows[0].statuses).toEqual(local.workflows[0].statuses)
  expect(data.issues[0].statusId).toBe('queued')
  expect(isSyncData(data)).toBe(true)
})
it('detects conflicting project and workflow edits and preserves the independent counter', () => {
  const base = initialSyncData(1)
  const local = structuredClone(base)
  const remote = structuredClone(base)
  local.projects[0].name = '端末'
  remote.projects[0].name = 'クラウド'
  local.projects[0].nextNumber = 30
  remote.projects[0].nextNumber = 20
  local.workflows[0].statuses[0].name = '端末の表示名'
  remote.workflows[0].statuses[0].name = 'クラウドの表示名'

  expect(mergeSyncData(base, local, remote).conflicts).toEqual(['プロジェクト名', 'ワークフロー'])
  for (const choice of ['local', 'remote'] as const) {
    const chosen = choice === 'local' ? local : remote
    const { data } = mergeSyncData(base, local, remote, choice)
    expect(data.projects[0]).toMatchObject({ name: chosen.projects[0].name, nextNumber: 30 })
    expect(data.workflows[0].statuses).toEqual(chosen.workflows[0].statuses)
  }
  remote.projects[0].name = local.projects[0].name
  remote.workflows[0].statuses = structuredClone(local.workflows[0].statuses)
  remote.workflows[0].updatedAt = 200
  expect(mergeSyncData(base, local, remote).conflicts).toEqual([])
})
it.each(['local', 'remote'] as const)('preserves the task when the %s side removes the status used by another device', deletedOn => {
  const base = initialSyncData(1)
  base.workflows[0].statuses.push({ id: 'review', name: 'レビュー中', category: 'doing' })
  base.issues.push(fixtureIssue({ statusId: 'account-todo' }))
  const local = structuredClone(base)
  const remote = structuredClone(base)
  const deleted = deletedOn === 'local' ? local : remote
  const kept = deletedOn === 'local' ? remote : local
  deleted.workflows[0].statuses.pop()
  kept.issues[0].statusId = 'review'
  kept.issues[0].title = '内容も編集したタスク'
  kept.issues.push(fixtureIssue({ id: 'new-in-review', number: 2, title: '新しいタスク', statusId: 'review' }))
  expect(isSyncData(local)).toBe(true)
  expect(isSyncData(remote)).toBe(true)

  expect(mergeSyncData(base, local, remote).conflicts).toEqual(['ステータス参照（内容も編集したタスク）', 'ステータス参照（新しいタスク）'])
  const keepStatus = mergeSyncData(base, local, remote, deletedOn === 'local' ? 'remote' : 'local').data
  expect(keepStatus.issues.map(issue => issue.statusId)).toEqual(['review', 'review'])
  expect(isSyncData(keepStatus)).toBe(true)
  const removeStatus = mergeSyncData(base, local, remote, deletedOn).data
  expect(removeStatus.issues[0]).toMatchObject({ title: '内容も編集したタスク', statusId: 'account-todo' })
  expect(removeStatus.issues[1]).toMatchObject({ title: '新しいタスク', statusId: 'account-doing' })
  expect(removeStatus.workflows[0].statuses.some(status => status.id === 'review')).toBe(false)
  expect(isSyncData(removeStatus)).toBe(true)
})
it('keeps deletions synchronized when only historical records reference a removed status', () => {
  const base = initialSyncData(1)
  base.workflows[0].statuses.push({ id: 'review', name: 'レビュー中', category: 'doing' })
  base.issues.push(fixtureIssue({ statusId: 'review', deletedAt: 2 }))
  const local = structuredClone(base)
  local.workflows[0].statuses.pop()

  const { data, conflicts } = mergeSyncData(base, local, base)
  expect(conflicts).toEqual([])
  expect(data.issues[0]).toMatchObject({ statusId: 'account-doing', deletedAt: 2 })
  expect(isSyncData(data)).toBe(true)
})
it('imports guest relationships and recurrence once while mapping status IDs into the account', () => {
  const guest = initialSyncData(1), account = initialSyncData(2)
  guest.workflows[0].statuses[0].id = 'guest-todo'
  guest.issues = [fixtureIssue({ id: 'parent', statusId: 'guest-todo', number: 1 }), fixtureIssue({ id: 'child', statusId: 'guest-todo', parentId: 'parent', number: 2, recurrenceId: 'rule' })]
  guest.recurrenceRules = [{ id: 'rule', projectId: 'old-project', frequency: 'weekly', interval: 1, weekdays: [1,3], startDate: '2026-11-16', endDate: null, active: true, createdAt: 1, updatedAt: 1 }]
  const first = importGuestData(guest, account)
  expect(first.issues[1]).toMatchObject({ parentId: 'parent', recurrenceId: 'rule', statusId: 'account-todo', number: 2 })
  expect(first.recurrenceRules[0].projectId).toBe('account-project')
  expect(importGuestData(guest, first)).toEqual(first)
  expect(guest.issues[0].statusId).toBe('guest-todo')
})
it('rejects malformed snapshots, dangling references, invalid dates, duplicate IDs and oversize labels', () => {
  const valid = initialSyncData(1); valid.issues = [fixtureIssue()]
  expect(isSyncData(valid)).toBe(true)
  for (const patch of [{ parentId: 'missing' }, { date: '2026-02-30' }, { labels: ['x'.repeat(201)] }, { priority: 'invalid' }, { startMin: 1500 }, { recurrenceId: 'missing' }]) {
    const data = structuredClone(valid); Object.assign(data.issues[0], patch)
    expect(isSyncData(data)).toBe(false)
  }
  const duplicate = structuredClone(valid); duplicate.issues.push(fixtureIssue())
  expect(isSyncData(duplicate)).toBe(false)
  expect(isSyncData(null)).toBe(false)
})
it('isolates account database names and falls back to the guest database on invalid cached identity', () => {
  const values = new Map<string,string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key,value), removeItem: (key: string) => values.delete(key) })
  expect(activeDatabaseName()).toBe('dandori')
  selectAccount({ id: 'user-A', email: 'a@example.com', name: 'A' })
  expect(activeDatabaseName()).toBe('dandori-account-user-A')
  selectAccount({ id: 'user-B', email: 'b@example.com', name: 'B' })
  expect(activeDatabaseName()).toBe('dandori-account-user-B')
  values.set('dandori_active_account', '{')
  expect(readActiveAccount()).toBeNull()
  selectAccount(null)
  expect(activeDatabaseName()).toBe('dandori')
})
