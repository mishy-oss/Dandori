import { db } from './db'
import { getProject, getWorkflow } from './projectRepo'
import { expandRecurrenceInMonth } from './recurrenceRepo'
import { isValidMonth, issueMonth } from '../lib/month'
import { todayStr } from '../lib/date'
import { syncParentStatuses } from './issueRepo'
import type { Issue, MonthlySnapshot } from './types'
import { currentWork } from '../lib/carryover'
import { ruleDates } from '../lib/recurrence'

/* 親と子の作業を二重に数えないよう、集計は末端のタスクだけを対象にする。 */
export function monthlyWork(issues: Issue[], month: string, doneIds: Set<string>) {
  const active = currentWork(issues)
  const parents = new Set(active.map((issue) => issue.parentId))
  const work = active.filter((issue) => issueMonth(issue) === month && issue.type !== 'epic' && !parents.has(issue.id))
  return { totalCount: work.length, remainingCount: work.filter((issue) => !doneIds.has(issue.statusId)).length }
}

export async function prepareMonthlyProject(projectId: string, selectedMonth: string, today = todayStr()): Promise<void> {
  if (!isValidMonth(selectedMonth)) throw new Error('対象月を正しく指定してください')
  await db.transaction('rw', [db.projects, db.workflows, db.issues, db.recurrenceRules, db.monthlySnapshots], async () => {
    const project = await getProject(projectId)
    const workflow = project && await getWorkflow(project.workflowId)
    if (!project || !workflow) return
    const doneIds = new Set(workflow.statuses.filter((status) => status.category === 'done').map((status) => status.id))
    const month = today.slice(0, 7)
    const all = await db.issues.where('projectId').equals(projectId).toArray()
    const rules = new Map((await db.recurrenceRules.where('projectId').equals(projectId).toArray()).map(rule => [rule.id, rule]))
    for (const issue of all) {
      if (issue.carryoverToId) continue
      const rule = issue.recurrenceId ? rules.get(issue.recurrenceId) : undefined
      const date = issue.recurrenceDate
      // オフラインで別々の曜日へ変更した端末を統合した場合も、採用したルールの生成分だけを残す。
      if (issue.deletedAt === null && !doneIds.has(issue.statusId) && rule?.seriesId && date && issue.id === `r-${rule.id}-${date}` && !ruleDates(rule, date, date).length) {
        const linked = !!issue.carryoverFromId || all.some(child => child.parentId === issue.id && child.deletedAt === null)
        await db.issues.update(issue.id, linked ? { recurrenceId: null, recurrenceDate: undefined, recurrenceSeriesId: undefined, updatedAt: Date.now() } : { deletedAt: Date.now(), updatedAt: Date.now() })
        continue
      }
      const originalMonth = issueMonth(issue)
      const targetMonth = issue.deletedAt === null && !doneIds.has(issue.statusId) && originalMonth < month ? month : originalMonth
      if (!issue.planningMonth || issue.planningMonth !== targetMonth || issue.sprintId !== null) {
        await db.issues.update(issue.id, { planningMonth: targetMonth, legacySprintId: issue.legacySprintId ?? issue.sprintId, sprintId: null })
      }
    }
    const templates = new Map<string, Issue>()
    for (const issue of await db.issues.where('projectId').equals(projectId).toArray()) {
      if (issue.deletedAt === null && issue.recurrenceId && !templates.has(issue.recurrenceId)) templates.set(issue.recurrenceId, issue)
    }
    for (const source of templates.values()) {
      await expandRecurrenceInMonth(source, month, Date.now())
      if (selectedMonth !== month) await expandRecurrenceInMonth(source, selectedMonth, Date.now())
    }
    await syncParentStatuses((await db.issues.where('projectId').equals(projectId).toArray())
      .filter((issue) => issue.deletedAt === null).map((issue) => issue.parentId), Date.now())
    const issues = await db.issues.where('projectId').equals(projectId).toArray()
    const summary = monthlyWork(issues, month, doneIds)
    await db.monthlySnapshots.put({ id: `${projectId}:${today}`, projectId, month, date: today, ...summary })
  })
}

export async function listMonthlySnapshots(projectId: string): Promise<MonthlySnapshot[]> {
  return (await db.monthlySnapshots.where('projectId').equals(projectId).toArray()).sort((a, b) => a.date.localeCompare(b.date))
}

