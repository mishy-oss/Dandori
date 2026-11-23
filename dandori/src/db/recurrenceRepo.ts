import { db } from './db'
import type { Issue, RecurrenceFrequency, RecurrenceRule, Sprint } from './types'
import { newId } from '../lib/id'
import { isValidDateStr, todayStr } from '../lib/date'
import { getProject, getWorkflow } from './projectRepo'
import { rankAfter } from '../lib/rank'
import { monthRange } from '../lib/month'
import { recurrenceSource, ruleDates } from '../lib/recurrence'

export interface RecurrenceInput {
  frequency: RecurrenceFrequency
  interval: number
  weekdays?: number[]
  endDate?: string | null
}

export function normalizeRecurrence(input: RecurrenceInput, startDate: string): Omit<RecurrenceRule, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> {
  if (!['daily', 'weekly', 'monthly'].includes(input.frequency)) {
    throw new Error('繰り返し頻度を正しく選択してください')
  }
  if (!Number.isInteger(input.interval) || input.interval < 1 || input.interval > 365) {
    throw new Error('繰り返し間隔は1〜365で指定してください')
  }
  if (input.endDate && !isValidDateStr(input.endDate)) {
    throw new Error('繰り返し終了日が正しくありません')
  }
  if (input.endDate && input.endDate < startDate) {
    throw new Error('繰り返し終了日は開始日以降にしてください')
  }

  let weekdays: number[] | undefined
  if (input.frequency === 'weekly') {
    weekdays = input.weekdays ?? [new Date(`${startDate}T00:00:00`).getDay()]
    if (
      weekdays.length === 0 ||
      weekdays.some((weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6) ||
      new Set(weekdays).size !== weekdays.length
    ) {
      throw new Error('繰り返す曜日を1つ以上選択してください')
    }
    weekdays = [...weekdays].sort((a, b) => a - b)
  }

  return {
    frequency: input.frequency,
    interval: input.interval,
    ...(weekdays && { weekdays }),
    startDate,
    endDate: input.endDate || null,
    active: true,
  }
}

export async function applyRecurrencePatch(issue: Issue, patch: RecurrenceInput | null): Promise<void> {
  const existingRule = issue.recurrenceId ? await db.recurrenceRules.get(issue.recurrenceId) : undefined
  if (patch === null) {
    if (existingRule) {
      await db.recurrenceRules.update(existingRule.id, { active: false, updatedAt: issue.updatedAt })
      await db.issues.where('recurrenceId').equals(existingRule.id).filter(row => !row.carryoverToId)
        .modify({ recurrenceId: null, updatedAt: issue.updatedAt })
    }
    issue.recurrenceId = null
    return
  }

  const startDate = issue.date ?? existingRule?.startDate ?? todayStr()
  const values = normalizeRecurrence(patch, startDate)
  if (existingRule) {
    await db.recurrenceRules.put({ ...existingRule, ...values, updatedAt: issue.updatedAt })
    return
  }

  const rule: RecurrenceRule = {
    id: newId(),
    projectId: issue.projectId,
    ...values,
    createdAt: issue.updatedAt,
    updatedAt: issue.updatedAt,
  }
  await db.recurrenceRules.add(rule)
  issue.recurrenceId = rule.id
  issue.recurrenceSeriesId = rule.id
  issue.recurrenceDate = startDate
}

export async function expandRecurrenceInMonth(source: Issue, month: string, timestamp: number): Promise<void> {
  if (!source.recurrenceId) return
  const rule = await db.recurrenceRules.get(source.recurrenceId)
  if (!rule?.active) return
  const assignSource = source.date === null && source.recurrenceDate === undefined
  source = recurrenceSource(source, rule)
  const { startDate, endDate } = monthRange(month)
  const project = await getProject(source.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todo = workflow?.statuses.find((status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todo) return
  const existing = await db.issues.where('recurrenceId').equals(rule.id).toArray()
  // 削除済みの回も数え、ユーザーが消した予定を再生成しない。
  const dates = new Set(existing.map((issue) => issue.recurrenceDate ?? issue.date))
  const all = await db.issues.where('projectId').equals(project.id).toArray()
  let rank = all.filter((issue) => issue.deletedAt === null && issue.statusId === todo.id).reduce<string | null>((last, issue) => last === null || issue.rank > last ? issue.rank : last, null)
  let number = project.nextNumber
  for (const cursor of ruleDates(rule, startDate, endDate)) {
    if (!dates.has(cursor)) {
      if (assignSource && source.recurrenceDate === undefined && source.planningMonth === month) {
        await db.issues.update(source.id, { date: cursor, recurrenceDate: cursor, updatedAt: timestamp })
        source = { ...source, date: cursor, recurrenceDate: cursor }
      } else {
        rank = rankAfter(rank)
        await db.issues.add({ ...source, id: rule.seriesId ? `r-${rule.id}-${cursor}` : newId(), number: number++, sprintId: null, legacySprintId: null, planningMonth: month, statusId: todo.id, rank, date: cursor, recurrenceDate: cursor, dueDate: source.dueDate === source.date ? cursor : source.dueDate, completedAt: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null })
      }
      dates.add(cursor)
    }
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
  source = recurrenceSource(source, rule)

  if (!source.date) {
    const occurrenceDate = ruleDates(rule, sprint.startDate, sprint.endDate)[0]
    if (!occurrenceDate) return
    source = { ...source, date: occurrenceDate }
    await db.issues.update(source.id, { date: occurrenceDate, recurrenceDate: occurrenceDate, updatedAt: timestamp })
  }

  const project = await getProject(source.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todoStatus = workflow?.statuses.find((status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todoStatus) return

  let nextNumber = project.nextNumber
  let lastRank = await db.issues
    .where('projectId')
    .equals(source.projectId)
    .filter((issue) => issue.deletedAt === null && issue.statusId === todoStatus.id)
    .toArray()
    .then((issues) => issues.reduce<string | null>((rank, issue) => (!rank || issue.rank > rank ? issue.rank : rank), null))

  for (const cursor of ruleDates(rule, sprint.startDate, sprint.endDate)) {
    if (cursor >= sprint.startDate && cursor !== source.date) {
      const existing = await db.issues
        .where('recurrenceId')
        .equals(rule.id)
        .filter((issue) => (issue.recurrenceDate ?? issue.date) === cursor)
        .first()
      if (!existing) {
        lastRank = rankAfter(lastRank)
        const occurrence: Issue = {
          ...source,
          id: rule.seriesId ? `r-${rule.id}-${cursor}` : newId(),
          number: nextNumber,
          statusId: todoStatus.id,
          sprintId: sprint.id,
          rank: lastRank,
          date: cursor,
          recurrenceDate: cursor,
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
  }

  if (nextNumber !== project.nextNumber) {
    await db.projects.update(project.id, { nextNumber, updatedAt: timestamp })
  }
}
