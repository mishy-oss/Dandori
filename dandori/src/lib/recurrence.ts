import type { Issue, RecurrenceRule, RecurrenceTemplate } from '../db/types'
import { nextRecurrenceDate, nextWeeklyRecurrenceDate } from './date'

export function recurrenceTemplate(issue: Issue): RecurrenceTemplate {
  const { title, description, type, priority, labels, parentId, dueDate, estimateMin, date, startMin, durationMin, calendarAllDay, reminderOffsetMin, icon, color, isRoutine } = issue
  return { title, description, type, priority, labels: [...labels], parentId, dueDate, estimateMin, date, startMin, durationMin, calendarAllDay, reminderOffsetMin, icon, color, isRoutine }
}

export function recurrenceSource(issue: Issue, rule: RecurrenceRule): Issue {
  return { ...issue, ...rule.template, carryoverFromId: undefined, carryoverToId: undefined, carryoverRootId: undefined, carryoverSequence: undefined,
    calendarSource: undefined, calendarReadOnly: undefined, calendarSeriesId: undefined }
}

export function nextRuleDate(rule: RecurrenceRule, date: string): string {
  return rule.frequency === 'weekly' && rule.weekdays?.length
    ? nextWeeklyRecurrenceDate(date, rule.weekdays, rule.interval, rule.startDate)
    : nextRecurrenceDate(date, rule.frequency, rule.interval, rule.startDate)
}

export function ruleDates(rule: RecurrenceRule, from: string, to: string): string[] {
  const dates: string[] = []
  const excluded = new Set(rule.excludedDates)
  let cursor = rule.startDate
  if (rule.frequency === 'weekly' && rule.weekdays?.length && !rule.weekdays.includes(new Date(`${cursor}T00:00:00`).getDay())) cursor = nextRuleDate(rule, cursor)
  let count = 0
  while (cursor <= to && (!rule.endDate || cursor <= rule.endDate)) {
    if (++count > 100_000) throw new Error('繰り返しの期間が長すぎます')
    if (cursor >= from && (!rule.effectiveFrom || cursor >= rule.effectiveFrom) && !excluded.has(cursor)) dates.push(cursor)
    cursor = nextRuleDate(rule, cursor)
  }
  return dates
}
