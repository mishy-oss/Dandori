import Dexie from 'dexie'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from './db'
import { inTransaction } from './transaction'
import { createProject, ensureDefaultProject } from './projectRepo'
import { createIssue, updateIssue } from './issueRepo'

beforeEach(async () => { await Promise.all(db.tables.map(table => table.clear())) })
afterEach(() => { vi.restoreAllMocks() })

it('reuses one transaction object across repository calls and commits the complete operation', async () => {
  const transaction = vi.spyOn(db, 'transaction')
  await inTransaction(db, 'rw', db.tables, async () => {
    const root = Dexie.currentTransaction
    const project = await ensureDefaultProject()
    const issue = await createIssue({ projectId: project.id, title: '作成' })
    await updateIssue(issue.id, { title: '更新' })
    expect(Dexie.currentTransaction).toBe(root)
    expect(Dexie.currentTransaction?.parent).toBeNull()
  })
  expect(transaction).toHaveBeenCalledTimes(1)
  expect((await db.issues.toArray())[0].title).toBe('更新')
})

it('aborts the whole write even when an outer operation catches an inner failure', async () => {
  await expect(inTransaction(db, 'rw', db.tables, async () => {
    const project = await createProject({ key: 'APP', name: 'App' })
    await createIssue({ projectId: project.id, title: '途中の作業' })
    try {
      await inTransaction(db, 'rw', [db.projects], async () => { throw new Error('保存失敗') })
    } catch { /* 上位の捕捉で部分保存が起きないことを検証する。 */ }
  })).rejects.toThrow()
  expect(await db.projects.count()).toBe(0)
  expect(await db.workflows.count()).toBe(0)
  expect(await db.issues.count()).toBe(0)
})

it('rejects a missing table or write inside a read-only scope before running the operation', async () => {
  let invoked = false
  await expect(inTransaction(db, 'rw', [db.projects], async () => {
    await inTransaction(db, 'rw', [db.issues], async () => { invoked = true })
  })).rejects.toThrow('scope mismatch')
  await expect(inTransaction(db, 'r', db.tables, async () => {
    await inTransaction(db, 'rw', [db.projects], async () => { invoked = true })
  })).rejects.toThrow('scope mismatch')
  expect(invoked).toBe(false)
})
