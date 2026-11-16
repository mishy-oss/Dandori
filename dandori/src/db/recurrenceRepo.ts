import { db } from './db'
import type { Issue, RecurrenceRule, Sprint } from './types'
import { nextRecurrenceDate, nextWeeklyRecurrenceDate } from '../lib/date'
import { newId } from '../lib/id'
import { getProject, getWorkflow } from './projectRepo'
import { rankAfter } from '../lib/rank'
import { monthRange } from '../lib/month'

/* 月末補正を次回へ引き継がないよう、ルールの開始日を計算に渡す。 */
function nextDate(rule: RecurrenceRule, date: string): string {
  return rule.frequency === 'weekly' && rule.weekdays?.length
    ? nextWeeklyRecurrenceDate(date, rule.weekdays, rule.interval, rule.startDate)
    : nextRecurrenceDate(date, rule.frequency, rule.interval, rule.startDate)
}

export async function expandRecurrenceInMonth(source: Issue, month: string, timestamp: number): Promise<void> {
  if (!source.recurrenceId) return
  const rule = await db.recurrenceRules.get(source.recurrenceId)
  if (!rule?.active) return
  const { startDate, endDate } = monthRange(month)
  let cursor = rule.startDate
  while (cursor < startDate) cursor = nextDate(rule, cursor)
  const project = await getProject(source.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todo = workflow?.statuses.find((status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todo) return
  const existing = await db.issues.where('recurrenceId').equals(rule.id).toArray()
  // 削除済みの回も数え、ユーザーが消した予定を再生成しない。
  const dates = new Set(existing.map((issue) => issue.date))
  const all = await db.issues.where('projectId').equals(project.id).toArray()
  let rank = all.filter((issue) => issue.deletedAt === null && issue.statusId === todo.id).reduce<string | null>((last, issue) => last === null || issue.rank > last ? issue.rank : last, null)
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
  const todoStatus = workflow?.statuses.find((status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todoStatus) return

  let nextNumber = project.nextNumber
  let cursor = occurrenceDate
  let lastRank = await db.issues
    .where('projectId')
    .equals(source.projectId)
    .filter((issue) => issue.deletedAt === null && issue.statusId === todoStatus.id)
    .toArray()
    .then((issues) => issues.reduce<string | null>((rank, issue) => (!rank || issue.rank > rank ? issue.rank : rank), null))

  while (cursor <= sprint.endDate && (!rule.endDate || cursor <= rule.endDate)) {
    if (cursor >= sprint.startDate && cursor !== source.date) {
      const existing = await db.issues
        .where('recurrenceId')
        .equals(rule.id)
        .filter((issue) => issue.deletedAt === null && issue.date === cursor)
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
