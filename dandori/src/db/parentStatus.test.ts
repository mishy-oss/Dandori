import { beforeEach, expect, it } from 'vitest'
import { db } from './db'
import { createProject, getWorkflow } from './projectRepo'
import { createIssue, deleteIssue, getIssue, moveIssue, updateIssue } from './issueRepo'
import { prepareMonthlyProject } from './monthlyRepo'

/** 親子と繰り返しの保存データを毎回初期化する。 */
beforeEach(async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear(), db.monthlySnapshots.clear()])
})

/** 孫を持つ親子と、それぞれの状態を検証するためのIDを用意する。 */
async function setup() {
  const project = await createProject({ key: 'APP', name: 'App' })
  const workflow = (await getWorkflow(project.workflowId))!
  const todo = workflow.statuses.find((s) => s.category === 'todo')!.id
  const doing = workflow.statuses.find((s) => s.category === 'doing')!.id
  const done = workflow.statuses.find((s) => s.category === 'done')!.id
  const root = await createIssue({ projectId: project.id, title: 'Root' })
  const parent = await createIssue({ projectId: project.id, title: 'Parent', parentId: root.id })
  const a = await createIssue({ projectId: project.id, title: 'A', parentId: parent.id })
  const b = await createIssue({ projectId: project.id, title: 'B', parentId: parent.id })
  return { projectId: project.id, root, parent, a, b, todo, doing, done }
}

/** 子の一部完了・全完了・再開を、祖先まで反映し、完了日時も更新する。 */
it('rolls up child progress through ancestors for edits and board moves', async () => {
  const { root, parent, a, b, todo, doing, done } = await setup()
  await updateIssue(a.id, { statusId: done })
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  expect((await getIssue(root.id))?.statusId).toBe(doing)
  await moveIssue(b.id, done, 0)
  const completedAt = (await getIssue(parent.id))?.completedAt
  expect(completedAt).not.toBeNull()
  expect((await getIssue(root.id))?.statusId).toBe(done)
  await updateIssue(b.id, { title: 'Renamed' })
  expect((await getIssue(parent.id))?.completedAt).toBe(completedAt)
  await updateIssue(a.id, { statusId: todo })
  expect(await getIssue(parent.id)).toMatchObject({ statusId: doing, completedAt: null })
  await moveIssue(b.id, todo, 0)
  expect(await getIssue(root.id)).toMatchObject({ statusId: todo, completedAt: null })
})

/** 予定の追加・解除でも、子と親の状態を揃える。 */
it('rolls up scheduling changes without copying schedules to the parent', async () => {
  const { parent, a, doing, todo } = await setup()
  await updateIssue(a.id, { date: '2026-11-08', startMin: 600 })
  expect(await getIssue(parent.id)).toMatchObject({ statusId: doing, date: null, startMin: null })
  await updateIssue(a.id, { startMin: null })
  expect((await getIssue(parent.id))?.statusId).toBe(todo)
})

/** 作成・親の付け替え・削除後にも、変更元と変更先の進捗を再計算する。 */
it('updates both families when children are added, reparented and deleted', async () => {
  const { projectId, parent, a, b, doing, done, todo } = await setup()
  await updateIssue(a.id, { statusId: done })
  await updateIssue(b.id, { statusId: done })
  const newChild = await createIssue({ projectId, title: 'New', parentId: parent.id })
  expect((await getIssue(parent.id))?.statusId).toBe(doing)
  const other = await createIssue({ projectId, title: 'Other' })
  await createIssue({ projectId, title: 'Other todo', parentId: other.id })
  await updateIssue(newChild.id, { parentId: other.id })
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect((await getIssue(other.id))?.statusId).toBe(todo)
  await updateIssue(a.id, { parentId: other.id })
  expect((await getIssue(other.id))?.statusId).toBe(doing)
  await deleteIssue(a.id)
  expect((await getIssue(other.id))?.statusId).toBe(todo)
})

/** 親だけの手動変更で子の実績を上書きせず、保存結果も集約後の状態を返す。 */
it('uses child progress when a parent is edited directly', async () => {
  const { parent, a, todo, doing, done } = await setup()
  expect((await updateIssue(parent.id, { statusId: done })).statusId).toBe(todo)
  await updateIssue(a.id, { statusId: doing })
  expect((await moveIssue(parent.id, done, 0)).statusId).toBe(doing)
})

/** 既存データの不整合も、月次データを読み込む際に修復する。 */
it('repairs existing parent statuses on reload', async () => {
  const { projectId, parent, root, a, b, done } = await setup()
  await db.issues.update(a.id, { statusId: done, completedAt: 1 })
  await db.issues.update(b.id, { statusId: done, completedAt: 1 })
  await prepareMonthlyProject(projectId, '2026-11', '2026-11-08')
  expect((await getIssue(parent.id))?.statusId).toBe(done)
  expect((await getIssue(root.id))?.statusId).toBe(done)
})
