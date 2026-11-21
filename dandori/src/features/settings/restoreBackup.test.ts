import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { db } from '../../db/db'
import { createBackup } from '../../db/backupRepo'
import { parseBackup } from '../../db/backupImport'
import { createIssue } from '../../db/issueRepo'
import { createProject } from '../../db/projectRepo'
import { readSyncData, saveLocalImport } from '../account/accountRepo'
import { initialSyncData } from '../account/syncModel'
import { useAccountStore } from '../account/accountStore'
import { useDataStore } from '../../store/data'
import { prepareBackupRestore, restorePreparedBackup } from './restoreBackup'
import { RestoreBackupDialog } from './BackupImportSection'

const refresh = vi.fn().mockResolvedValue(undefined)
beforeEach(async () => {
  await Promise.all(db.tables.map(table => table.clear()))
  useAccountStore.setState({ user: null, authenticated: false, busy: false, calendar: null, conflicts: [], error: null })
  useDataStore.setState({ refreshPlanning: refresh })
  refresh.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

async function fileFixture() {
  const project = await createProject({ key: 'APP', name: '復元元' })
  await createIssue({ projectId: project.id, title: '復元されるタスク' })
  const file = parseBackup(JSON.stringify(await createBackup('dark')))
  await Promise.all(db.tables.map(table => table.clear()))
  return file
}
function account() {
  useAccountStore.setState({ user: { id: 'alice', email: 'alice@example.com', name: 'Alice' }, authenticated: true })
}

it('prepares without writes and restores a fresh database even when settings were only defaults', async () => {
  const file = await fileFixture()
  vi.stubGlobal('fetch', vi.fn())
  const before = await readSyncData()
  const session = await prepareBackupRestore(file, 'light')
  expect(await readSyncData()).toEqual(before)
  expect(session.captured.settings).toEqual([])
  expect(session.before.data.settings).toHaveLength(1)
  expect(await restorePreparedBackup(session)).toBeNull()
  expect(await readSyncData()).toEqual(file.data)
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(fetch).not.toHaveBeenCalled()
  expect(useAccountStore.getState().busy).toBe(false)
})

it('restores an account with the reviewed revision and updates its sync baseline', async () => {
  const file = await fileFixture()
  const current = initialSyncData(1)
  await saveLocalImport(current)
  account()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 5, data: current }))
    .mockImplementationOnce(async (_path: string, init: RequestInit) => Response.json({ revision: 6, data: JSON.parse(String(init.body)).data }))
  vi.stubGlobal('fetch', fetcher)
  const session = await prepareBackupRestore(file, 'light')
  expect(await readSyncData()).toEqual(current)
  expect(session.cloudBefore?.data).toEqual(current)
  await restorePreparedBackup(session)
  const restored = await readSyncData()
  expect(restored.issues[0].title).toBe('復元されるタスク')
  expect(restored.projects[0].id).toBe('account-project')
  expect((await db.accountSync.get('main'))?.baseline).toEqual(restored)
  expect((await db.accountSync.get('main'))?.revision).toBe(6)
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body)).revision).toBe(5)
  expect(new Headers(fetcher.mock.calls[1][1].headers).get('X-Dandori-Account')).toBe('alice')
  expect(useAccountStore.getState().busy).toBe(false)
})

it('does not retry a stale cloud confirmation or replace local data on a revision conflict', async () => {
  const file = await fileFixture()
  const current = initialSyncData(1)
  await saveLocalImport(current)
  account()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 5, data: current }))
    .mockResolvedValueOnce(Response.json({ error: '他端末で更新されました' }, { status: 409 }))
  vi.stubGlobal('fetch', fetcher)
  const session = await prepareBackupRestore(file, 'light')
  await expect(restorePreparedBackup(session)).rejects.toThrow('他端末で更新')
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(await readSyncData()).toEqual(current)
  expect(useAccountStore.getState().busy).toBe(false)
})

it('confirms a completed cloud write after its response is lost without writing it twice', async () => {
  const file = await fileFixture()
  const current = initialSyncData(1)
  await saveLocalImport(current)
  account()
  let remote = { revision: 5, data: current }
  const fetcher = vi.fn(async (_path: string, init: RequestInit) => {
    if (init.method === 'PUT') {
      remote = { revision: 6, data: JSON.parse(String(init.body)).data }
      throw new TypeError('response lost')
    }
    return Response.json(remote)
  })
  vi.stubGlobal('fetch', fetcher)
  const session = await prepareBackupRestore(file, 'light')
  await restorePreparedBackup(session)
  expect(fetcher.mock.calls.filter(call => call[1].method === 'PUT')).toHaveLength(1)
  expect(fetcher).toHaveBeenCalledTimes(3)
  expect((await db.issues.toArray())[0].title).toBe('復元されるタスク')
  expect((await db.accountSync.get('main'))?.revision).toBe(6)
})

it('reports a committed cloud restore and stops automatic sync if saving the local copy fails', async () => {
  const file = await fileFixture()
  const current = initialSyncData(1)
  await saveLocalImport(current)
  account()
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ revision: 5, data: current }))
    .mockImplementationOnce(async (_path: string, init: RequestInit) => Response.json({ revision: 6, data: JSON.parse(String(init.body)).data }))
  vi.stubGlobal('fetch', fetcher)
  const session = await prepareBackupRestore(file, 'light')
  const fail = () => { throw new Error('quota') }
  db.issues.hook('creating', fail)
  try { await expect(restorePreparedBackup(session)).rejects.toThrow('クラウドへの復元は完了') }
  finally { db.issues.hook('creating').unsubscribe(fail) }
  expect(await readSyncData()).toEqual(current)
  expect(useAccountStore.getState().conflicts).toHaveLength(1)
  expect(useAccountStore.getState().busy).toBe(false)
})

it('rejects a backup exceeding account sync capacity before making any cloud write', async () => {
  const file = await fileFixture()
  const source = file.data.issues[0]
  file.data.issues = Array.from({ length: 60 }, (_, index) => ({ ...source, id: `large-${index}`, number: index + 1, description: 'x'.repeat(20_000) }))
  file.data.projects[0].nextNumber = 61
  const current = initialSyncData(1)
  await saveLocalImport(current)
  account()
  const fetcher = vi.fn().mockResolvedValue(Response.json({ revision: 5, data: current }))
  vi.stubGlobal('fetch', fetcher)
  await expect(prepareBackupRestore(file, 'light')).rejects.toThrow('容量上限')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(await readSyncData()).toEqual(current)
  expect(useAccountStore.getState().busy).toBe(false)
})

it('protects edits made during confirmation and rejects account changes', async () => {
  const file = await fileFixture()
  const project = await createProject({ key: 'NEW', name: '現在' })
  const session = await prepareBackupRestore(file, 'light')
  const added = await createIssue({ projectId: project.id, title: '確認中に追加' })
  await expect(restorePreparedBackup(session)).rejects.toThrow('確認中にデータが更新')
  expect(await db.issues.get(added.id)).toBeDefined()
  account()
  await expect(restorePreparedBackup(session)).rejects.toThrow('アカウントが変わり')
})

it('requires an idle authenticated account and prevents calendar re-import from racing restoration', async () => {
  const file = await fileFixture()
  vi.stubGlobal('fetch', vi.fn())
  useAccountStore.setState({ busy: true })
  await expect(prepareBackupRestore(file, 'light')).rejects.toThrow('同期処理')
  useAccountStore.setState({ busy: false })
  account()
  useAccountStore.setState({ authenticated: false })
  await expect(prepareBackupRestore(file, 'light')).rejects.toThrow('再ログイン')
  useAccountStore.setState({ authenticated: true, calendar: { id: 'calendar', name: '予定', timeZone: 'Asia/Tokyo' } })
  await expect(prepareBackupRestore(file, 'light')).rejects.toThrow('カレンダー連携を解除')
  expect(fetch).not.toHaveBeenCalled()
  expect(await db.issues.count()).toBe(0)
})

it('reports that data was committed if refreshing the view subsequently fails', async () => {
  const file = await fileFixture()
  const session = await prepareBackupRestore(file, 'light')
  refresh.mockRejectedValueOnce(new Error('refresh failed'))
  expect(await restorePreparedBackup(session)).toContain('データは復元しました')
  expect(await readSyncData()).toEqual(file.data)
})

it('renders backup date, counts, a pre-restore download and an explicit disabled-by-default confirmation', async () => {
  const file = await fileFixture()
  const session = await prepareBackupRestore(file, 'light')
  const html = renderToStaticMarkup(createElement(RestoreBackupDialog, {
    preview: { filename: 'backup.json', session }, downloads: [{ url: 'blob:test', filename: 'before.json', cloud: false }], busy: false, error: null, onClose: () => {}, onRestore: () => {},
  }))
  expect(html).toContain('role="alertdialog"')
  expect(html).toContain('書き出し日時')
  expect(html).toContain('1件（履歴・削除済みを含む総件数 1件）')
  expect(html).toContain('復元前の端末JSONを保存')
  expect(html).toContain('現在のデータを置き換えることを確認しました')
  expect(html).toMatch(/disabled=""[^>]*>復元する<\/button>/)
})
