import { db } from './db'
import type { Issue, RecurrenceRule, Sprint } from './types'
import { nextRecurrenceDate, nextWeeklyRecurrenceDate } from '../lib/date'
import { newId } from '../lib/id'
import { getProject, getWorkflow } from './projectRepo'
import { rankAfter } from '../lib/rank'

function nextDate(rule: RecurrenceRule, date: string): string {
  return rule.frequency === 'weekly' && rule.weekdays?.length
    ? nextWeeklyRecurrenceDate(date, rule.weekdays, rule.interval, rule.startDate)
    : nextRecurrenceDate(date, rule.frequency, rule.interval)
}

/** Materialize this recurring task's remaining occurrences within its sprint. */
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
  const todoStatus = workflow?.statuses.find((status) => status.category === 'todo')
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
