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
