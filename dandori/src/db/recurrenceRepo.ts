import { db } from './db'
import type { Issue, RecurrenceRule, Sprint } from './types'
import { nextRecurrenceDate, nextWeeklyRecurrenceDate } from '../lib/date'
import { newId } from '../lib/id'
import { getProject, getWorkflow } from './projectRepo'
import { rankAfter } from '../lib/rank'
import { monthRange } from '../lib/month'

/** 曜日指定の毎週、または日・週・月の間隔で次回日を求める。毎月の日にちはルールの開始日を基準にする。 */
function nextDate(rule: RecurrenceRule, date: string): string {
  return rule.frequency === 'weekly' && rule.weekdays?.length
    ? nextWeeklyRecurrenceDate(date, rule.weekdays, rule.interval, rule.startDate)
    : nextRecurrenceDate(date, rule.frequency, rule.interval, rule.startDate)
}

/** スプリントを作らず、選択月の範囲にある繰り返し回を生成する。同じルール・日付の既存回は重複させない。 */
export async function expandRecurrenceInMonth(source: Issue, month: string, timestamp: number): Promise<void> {
  if (!source.recurrenceId) return
  const rule = await db.recurrenceRules.get(source.recurrenceId)
  if (!rule?.active) return
  const { startDate, endDate } = monthRange(month)
  let cursor = rule.startDate
  while (cursor < startDate) cursor = nextDate(rule, cursor)
  const project = await getProject(source.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todo = workflow?.statuses.find(/* 定期タスクは専用列へ、通常の繰り返しは未着手列へ置く。 */ (status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todo) return
  const existing = await db.issues.where('recurrenceId').equals(rule.id).toArray()
  const dates = new Set(existing.map(/* 削除した回も記録として残し、同じ日を勝手に再生成しない。 */ (issue) => issue.date))
  const all = await db.issues.where('projectId').equals(project.id).toArray()
  let rank = all.filter(/* 未着手列の末尾を求める。 */ (issue) => issue.deletedAt === null && issue.statusId === todo.id).reduce<string | null>(/* 最大の並び順キーを選ぶ。 */ (last, issue) => last === null || issue.rank > last ? issue.rank : last, null)
  let number = project.nextNumber
  while (cursor <= endDate && (!rule.endDate || cursor <= rule.endDate)) {
    if (!dates.has(cursor)) {
      if (source.date === null && source.planningMonth === month) {
        await db.issues.update(source.id, { date: cursor, updatedAt: timestamp })
        source = { ...source, date: cursor }
      } else {
        rank = rankAfter(rank)
        await db.issues.add({ ...source, id: newId(), number: number++, sprintId: null, legacySprintId: null, planningMonth: month, statusId: todo.id, rank, date: cursor, dueDate: source.dueDate === source.date ? cursor : source.dueDate, completedAt: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null })
      }
      dates.add(cursor)
    }
    cursor = nextDate(rule, cursor)
  }
  if (number !== project.nextNumber) await db.projects.update(project.id, { nextNumber: number, updatedAt: timestamp })
}

/** Materialize this recurring task's remaining occurrences within its sprint. */
/** 有効な繰り返しルールに従い、スプリント期間内で未作成の日付のIssueを生成する。ルールの終了日を超える予定は作らない。 */
export async function expandRecurrenceInSprint(
  source: Issue,
  sprint: Sprint,
  timestamp: number,
): Promise<void> {
  if (sprint.state === 'closed' || sprint.projectId !== source.projectId || !source.recurrenceId) return
  const rule = await db.recurrenceRules.get(source.recurrenceId)
  if (!rule?.active) return

  let occurrenceDate = source.date ?? rule.startDate
  if (!source.date) {
    while (occurrenceDate < sprint.startDate) occurrenceDate = nextDate(rule, occurrenceDate)
    source = { ...source, date: occurrenceDate }
    await db.issues.update(source.id, { date: occurrenceDate, updatedAt: timestamp })
  }

  const project = await getProject(source.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todoStatus = workflow?.statuses.find(/* 旧スプリントでも定期タスクの列を引き継ぐ。 */ (status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todoStatus) return

  let nextNumber = project.nextNumber
  let cursor = occurrenceDate
  let lastRank = await db.issues
    .where('projectId')
    .equals(source.projectId)
    .filter(/* 未削除・指定ステータスと一致という条件を満たす要素だけを残す。 */ (issue) => issue.deletedAt === null && issue.statusId === todoStatus.id)
    .toArray()
    .then(/* 取得したIssue一覧から並び順キーの最大値を求め、末尾への追加位置を決める。 */ (issues) => issues.reduce<string | null>(/* 並び順キーを比較し、これまでの最大値を次の要素へ引き継ぐ。 */ (rank, issue) => (!rank || issue.rank > rank ? issue.rank : rank), null))

  while (cursor <= sprint.endDate && (!rule.endDate || cursor <= rule.endDate)) {
    if (cursor >= sprint.startDate && cursor !== source.date) {
      const existing = await db.issues
        .where('recurrenceId')
        .equals(rule.id)
        .filter(/* 未削除・指定日と一致という条件を満たす要素だけを残す。 */ (issue) => issue.deletedAt === null && issue.date === cursor)
        .first()
      if (!existing) {
        lastRank = rankAfter(lastRank)
        const occurrence: Issue = {
          ...source,
          id: newId(),
          number: nextNumber,
          statusId: todoStatus.id,
          sprintId: sprint.id,
          rank: lastRank,
          date: cursor,
          dueDate: source.dueDate === source.date ? cursor : source.dueDate,
          completedAt: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          deletedAt: null,
        }
        await db.issues.add(occurrence)
        nextNumber += 1
      }
    }
    cursor = nextDate(rule, cursor)
  }

  if (nextNumber !== project.nextNumber) {
    await db.projects.update(project.id, { nextNumber, updatedAt: timestamp })
  }
}
