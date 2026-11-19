import { db } from './db'
import { getIssue, syncParentStatuses } from './issueRepo'
import { getProject, getWorkflow } from './projectRepo'
import { isValidDateStr } from '../lib/date'
import { validateSchedule } from '../lib/schedule'
import { rankAfter } from '../lib/rank'
import type { Issue } from './types'

export interface CarryoverInput { date: string; startMin: number | null; durationMin: number }

export async function carryoverIssue(id: string, input: CarryoverInput): Promise<Issue> {
  if (!isValidDateStr(input.date)) throw new Error('持ち越し先の日付を選択してください')
  validateSchedule(input.date, input.startMin, input.durationMin)
  return db.transaction('rw', [db.projects, db.workflows, db.issues], async () => {
    const source = await getIssue(id)
    if (!source) throw new Error('タスクが見つかりません')
    if (source.carryoverToId) {
      const existing = await getIssue(source.carryoverToId)
      if (existing) return existing
      throw new Error('このタスクは持ち越し済みです。履歴から持ち越し先を確認してください')
    }
    if (!source.date || input.date <= source.date) throw new Error('元の配置日より後の日付を選択してください')
    const project = await getProject(source.projectId)
    const workflow = project && await getWorkflow(project.workflowId)
    if (!project || !workflow) throw new Error('プロジェクトが見つかりません')
    const doneIds = new Set(workflow.statuses.filter(status => status.category === 'done').map(status => status.id))
    if (doneIds.has(source.statusId)) throw new Error('完了済みのタスクは持ち越せません')
    const all = await db.issues.where('projectId').equals(project.id).toArray()
    const selected: Issue[] = []
    const visited = new Set<string>()
    function collect(issue: Issue) {
      if (visited.has(issue.id) || issue.deletedAt !== null || issue.carryoverToId || doneIds.has(issue.statusId)) return
      visited.add(issue.id)
      selected.push(issue)
      for (const child of all.filter(child => child.parentId === issue.id)) collect(child)
    }
    collect(source)
    // 同じ元タスクを2台で持ち越しても、別々のコピーが増えないIDにする。
    const targetIds = new Map(selected.map(issue => [issue.id, `carryover:${issue.carryoverRootId ?? issue.id}:${(issue.carryoverSequence ?? 0) + 1}`]))
    if ([...targetIds.values()].some(value => value.length > 160)) throw new Error('タスクIDが長すぎるため持ち越せません')
    let number = project.nextNumber
    let rank = all.reduce<string | null>((last, issue) => last === null || issue.rank > last ? issue.rank : last, null)
    const timestamp = Date.now()
    const copies: Issue[] = []
    for (const original of selected) {
      const targetId = targetIds.get(original.id)!
      if (await db.issues.get(targetId)) throw new Error('持ち越しデータが既に存在します。同期して確認してください')
      const isRoot = original.id === id
      const date = !isRoot && original.date && original.date > input.date ? original.date : input.date
      const startMin = isRoot ? input.startMin : null
      const allDay = !!original.calendarAllDay && startMin === null
      rank = rankAfter(rank)
      const status = workflow.statuses.find(status => status.category === (original.isRoutine ? 'routine' : startMin === null ? 'todo' : 'doing'))!
      const copy: Issue = {
        ...original, id: targetId, number: number++, rank,
        carryoverFromId: original.id, carryoverToId: undefined,
        carryoverRootId: original.carryoverRootId ?? original.id,
        carryoverSequence: (original.carryoverSequence ?? 0) + 1,
        parentId: original.parentId ? targetIds.get(original.parentId) ?? original.parentId : null,
        date, startMin, durationMin: allDay ? 1440 : isRoot ? input.durationMin : original.durationMin,
        calendarAllDay: allDay, planningMonth: date.slice(0, 7), sprintId: null,
        statusId: status.id, recurrenceId: null, recurrenceDate: undefined, recurrenceSeriesId: undefined,
        calendarSource: undefined, calendarReadOnly: undefined, calendarSeriesId: undefined,
        completedAt: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null,
      }
      copies.push(copy)
      await db.issues.add(copy)
      await db.issues.update(original.id, { carryoverToId: copy.id, updatedAt: timestamp })
    }
    await db.projects.update(project.id, { nextNumber: number, updatedAt: timestamp })
    await syncParentStatuses([...copies.map(copy => copy.id), ...copies.map(copy => copy.parentId)], timestamp)
    return (await getIssue(targetIds.get(id)!))!
  })
}
