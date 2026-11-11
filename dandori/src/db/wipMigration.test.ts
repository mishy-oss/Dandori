import Dexie from 'dexie'
import { expect, it } from 'vitest'
import { DandoriDB } from './db'
import { createDefaultStatuses } from './projectRepo'
import { wipStatus } from '../features/board/boardLogic'

/** 既存の上限を解除し、タスク数が多くても警告を出さず、他の列の設定を保つ。 */
it('removes existing doing limits without changing status IDs, order or other limits', async () => {
  const name = `wip-removal-${Date.now()}`
  const legacy = new Dexie(name)
  legacy.version(9).stores({ workflows: 'id, updatedAt, deletedAt' })
  const statuses = createDefaultStatuses().map((status) => ({ ...status, wipLimit: status.category === 'doing' ? 3 : 10 }))
  await legacy.table('workflows').add({ id: 'workflow', statuses, createdAt: 1, updatedAt: 1, deletedAt: null })
  legacy.close()
  const upgraded = new DandoriDB(name)
  try {
    const workflow = (await upgraded.workflows.get('workflow'))!
    expect(workflow.statuses.map((status) => status.id)).toEqual(statuses.map((status) => status.id))
    expect(workflow.statuses.map((status) => status.name)).toEqual(statuses.map((status) => status.name))
    const doing = workflow.statuses.find((status) => status.category === 'doing')!
    expect(doing.wipLimit).toBeUndefined()
    expect(wipStatus(100, doing.wipLimit).over).toBe(false)
    expect(workflow.statuses.filter((status) => status.category !== 'doing').every((status) => status.wipLimit === 10)).toBe(true)
  } finally {
    upgraded.close()
    await Dexie.delete(name)
  }
})
