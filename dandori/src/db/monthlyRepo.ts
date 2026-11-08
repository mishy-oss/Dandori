import { db } from './db'
import { getProject, getWorkflow } from './projectRepo'
import { expandRecurrenceInMonth } from './recurrenceRepo'
import { isValidMonth, issueMonth } from '../lib/month'
import { todayStr } from '../lib/date'
import type { Issue, MonthlySnapshot } from './types'

/** Epicと子を持つ親を除き、対象月の作業単位だけを集計する。 */
export function monthlyWork(issues: Issue[], month: string, doneIds: Set<string>) {
  const active = issues.filter(/* 削除済みを除く。 */ (issue) => issue.deletedAt === null)
  const parents = new Set(active.map(/* 子を持つ親IDを集め、二重計上を防ぐ。 */ (issue) => issue.parentId))
  const work = active.filter(/* 月の作業単位だけを取り出す。 */ (issue) => issueMonth(issue) === month && issue.type !== 'epic' && !parents.has(issue.id))
  return { totalCount: work.length, remainingCount: work.filter(/* 完了カテゴリ以外を残作業として数える。 */ (issue) => !doneIds.has(issue.statusId)).length }
}

/** 旧所属を保存して月管理へ移し、過去月の未完了を今月へ繰り越す。繰り返しを選択月へ展開し、今日の実績を記録する。 */
export async function prepareMonthlyProject(projectId: string, selectedMonth: string, today = todayStr()): Promise<void> {
  if (!isValidMonth(selectedMonth)) throw new Error('対象月を正しく指定してください')
  await db.transaction('rw', [db.projects, db.workflows, db.issues, db.recurrenceRules, db.monthlySnapshots], /* 月管理の準備と実績記録をまとめて保存する。 */ async () => {
    const project = await getProject(projectId)
    const workflow = project && await getWorkflow(project.workflowId)
    if (!project || !workflow) return
    const doneIds = new Set(workflow.statuses.filter(/* 完了カテゴリのIDを取り出す。 */ (status) => status.category === 'done').map(/* 判定用のID集合を作る。 */ (status) => status.id))
    const month = today.slice(0, 7)
    const all = await db.issues.where('projectId').equals(projectId).toArray()
    for (const issue of all) {
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
    const issues = await db.issues.where('projectId').equals(projectId).toArray()
    const summary = monthlyWork(issues, month, doneIds)
    await db.monthlySnapshots.put({ id: `${projectId}:${today}`, projectId, month, date: today, ...summary })
  })
}

/** プロジェクトの記録済み月次実績を日付順に取得する。 */
export async function listMonthlySnapshots(projectId: string): Promise<MonthlySnapshot[]> {
  return (await db.monthlySnapshots.where('projectId').equals(projectId).toArray()).sort(/* 古い日付から順に並べる。 */ (a, b) => a.date.localeCompare(b.date))
}

