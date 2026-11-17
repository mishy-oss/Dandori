import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../db/db'
import { initializeAccountDatabase, readSyncData } from './accountRepo'
import { syncAccount, syncCalendar, useAccountStore } from './accountStore'
import { initialSyncData, type SyncDocument } from './syncModel'
import { fixtureIssue } from './syncFixtures'

beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  await initializeAccountDatabase()
  useAccountStore.setState({ user: { id: 'alice', email: 'alice@example.com', name: 'Alice' }, authenticated: true, busy: false, error: null, calendarError: null, conflicts: [], message: null, calendar: null })
})
afterEach(() => vi.unstubAllGlobals())
it('retries a stale revision without losing independently created tasks and sends the account guard header', async () => {
  await db.issues.put(fixtureIssue({ id: 'local' }))
  const remote: SyncDocument = { revision: 1, data: initialSyncData(0) }
  remote.data.issues = [fixtureIssue({ id: 'remote' })]
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 0, data: initialSyncData(0) }))
    .mockResolvedValueOnce(Response.json({ error: 'revision changed' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(remote))
    .mockImplementationOnce(async (_path: string, init: RequestInit) => Response.json({ revision: 2, data: JSON.parse(String(init.body)).data }))
  vi.stubGlobal('fetch', fetcher)
  expect(await syncAccount()).toBe(true)
  expect(fetcher).toHaveBeenCalledTimes(4)
  expect(new Headers(fetcher.mock.calls[0][1].headers).get('X-Dandori-Account')).toBe('alice')
  expect(await db.issues.count()).toBe(2)
  expect(new Set((await db.issues.toArray()).map(row => row.number)).size).toBe(2)
})
it('pauses on a true conflict and uploads the selected resolution only after an explicit choice', async () => {
  const base = initialSyncData(0); base.issues = [fixtureIssue()]
  await db.accountSync.put({ id: 'main', revision: 1, baseline: base, lastSyncedAt: 0 })
  await db.issues.put(fixtureIssue({ title: '端末の変更' }))
  const remote = structuredClone(base); remote.issues[0].title = 'クラウドの変更'
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 2, data: remote }))
  vi.stubGlobal('fetch', fetcher)
  expect(await syncAccount()).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect((await db.issues.get('task-1'))?.title).toBe('端末の変更')
  expect(useAccountStore.getState().conflicts).toEqual(['端末の変更'])
  fetcher.mockResolvedValueOnce(Response.json({ revision: 2, data: remote })).mockImplementationOnce(async (_path: string, init: RequestInit) => Response.json({ revision: 3, data: JSON.parse(String(init.body)).data }))
  expect(await syncAccount('local')).toBe(true)
  expect((await db.issues.get('task-1'))?.title).toBe('端末の変更')
})
it('preserves offline tasks and asks for login after an expired session', async () => {
  await db.issues.put(fixtureIssue())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: '再ログインしてください' }, { status: 401 })))
  expect(await syncAccount()).toBe(false)
  expect(await db.issues.count()).toBe(1)
  expect(useAccountStore.getState().authenticated).toBe(false)
})
it('does not clear a Calendar conflict by performing a second task sync', async () => {
  const captured = await readSyncData()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 0, data: captured })).mockResolvedValueOnce(Response.json({ error: '両方で変更された予定があります' }, { status: 502 }))
  vi.stubGlobal('fetch', fetcher)
  await syncCalendar()
  expect(useAccountStore.getState().error).toContain('両方で変更')
  expect(fetcher).toHaveBeenCalledTimes(2)
  fetcher.mockResolvedValueOnce(Response.json({ revision: 0, data: captured }))
  expect(await syncAccount()).toBe(true)
  expect(useAccountStore.getState().calendarError).toContain('両方で変更')
})
