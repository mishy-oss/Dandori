import { db } from './db'
import { getIssue, normalizeRecurrence, syncParentStatuses, updateIssue, type IssuePatch } from './issueRepo'
import { getProject, getWorkflow } from './projectRepo'
import { expandRecurrenceInMonth, expandRecurrenceInSprint } from './recurrenceRepo'
import { addDaysStr } from '../lib/date'
import { monthRange } from '../lib/month'
import { recurrenceTemplate, ruleDates } from '../lib/recurrence'
import type { RecurrenceRule } from './types'

export type RecurringEditScope = 'single' | 'future'
const SHARED_FIELDS = ['title', 'description', 'type', 'priority', 'labels', 'startMin', 'durationMin', 'calendarAllDay', 'reminderOffsetMin', 'dueDate', 'estimateMin', 'icon', 'color'] as const

export async function editRecurringIssue(id: string, patch: IssuePatch, scope: RecurringEditScope) {
  const captured = await getIssue(id)
  const hash = scope === 'future' && captured?.recurrenceId
    ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${captured.recurrenceId}:${id}`)) : null
  const ruleId = hash ? `recurrence-${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')}` : ''
  return db.transaction('rw', [db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules], async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('タスクが見つかりません')
    if (scope === 'future' && current.recurrenceId !== captured?.recurrenceId) throw new Error('繰り返し設定が変更されました。画面を開き直してください')
    if (current.carryoverToId) throw new Error('持ち越し済みの配置は履歴です')
    const rule = current.recurrenceId ? await db.recurrenceRules.get(current.recurrenceId) : undefined
    if (!rule) return updateIssue(id, patch)
    const timestamp = Date.now()
    const template = rule.template ?? recurrenceTemplate(current)
    // 1回だけの例外を、後日の自動生成用の内容へ混ぜない。
    await db.recurrenceRules.update(rule.id, { template, updatedAt: timestamp })
    const { recurrence, planningMonth, ...singlePatch } = patch
    if (scope === 'single') {
      const sourceDate = current.recurrenceDate ?? current.date ?? rule.startDate
      await db.issues.update(current.id, { recurrenceDate: sourceDate })
      return updateIssue(id, { ...singlePatch, ...(planningMonth !== undefined && { planningMonth }) })
    }

    const cutoff = current.recurrenceDate ?? current.date
    const nextDate = patch.date === undefined ? current.date : patch.date
    if (!cutoff || !nextDate || nextDate < cutoff) throw new Error('「この回以降」では元の発生日以降の日付を指定してください。個別の日付変更には「この回のみ」を使えます')
    const project = await getProject(current.projectId)
    const workflow = project && await getWorkflow(project.workflowId)
    if (!project || !workflow) throw new Error('プロジェクトが見つかりません')
    const doneIds = new Set(workflow.statuses.filter(status => status.category === 'done').map(status => status.id))
    if (doneIds.has(current.statusId)) throw new Error('完了済みの回は「この回のみ」で編集してください')
    const all = await db.issues.where('projectId').equals(current.projectId).toArray()
    const occurrences = all.filter(issue => issue.recurrenceId === rule.id && (issue.recurrenceDate ?? issue.date ?? '') >= cutoff)
    const editable = occurrences.filter(issue => issue.deletedAt === null && !issue.carryoverToId && !doneIds.has(issue.statusId))
    const protectedDates = occurrences.filter(issue => !editable.includes(issue)).map(issue => issue.recurrenceDate ?? issue.date).filter((date): date is string => date !== null)
    const changes = Object.fromEntries(SHARED_FIELDS.filter(key => key in patch && JSON.stringify(patch[key]) !== JSON.stringify(current[key])).map(key => [key, patch[key]]))
    if (typeof changes.title === 'string') changes.title = changes.title.trim()
    if ('calendarAllDay' in changes) changes.startMin = patch.startMin ?? null
    const truncatedEnd = addDaysStr(cutoff, -1)
    await db.recurrenceRules.update(rule.id, { endDate: rule.endDate && rule.endDate < truncatedEnd ? rule.endDate : truncatedEnd, active: rule.active && truncatedEnd >= rule.startDate, updatedAt: timestamp })

    const baseDate = template.date
    const nextTemplate = { ...template, ...changes, date: nextDate }
    if (!('dueDate' in changes) && template.dueDate === baseDate) nextTemplate.dueDate = nextDate
    let nextRule: RecurrenceRule | undefined
    const months = new Set(editable.map(issue => (issue.recurrenceDate ?? issue.date ?? nextDate).slice(0, 7)))
    months.add(nextDate.slice(0, 7))
    const expected = new Set<string>()
    let selectedDate = nextDate
    if (recurrence !== null) {
      const input = recurrence ?? { frequency: rule.frequency, interval: rule.interval, weekdays: rule.weekdays, endDate: rule.endDate }
      const changedPattern = input.frequency !== rule.frequency || input.interval !== rule.interval || JSON.stringify(input.weekdays) !== JSON.stringify(rule.weekdays) || nextDate !== cutoff
      const anchor = changedPattern ? nextDate : rule.startDate
      nextRule = { id: ruleId, projectId: current.projectId, ...normalizeRecurrence(input, anchor), active: rule.active, effectiveFrom: nextDate,
        excludedDates: [...new Set([...(rule.excludedDates ?? []), ...protectedDates])],
        template: nextTemplate, seriesId: rule.seriesId ?? rule.id, createdAt: timestamp, updatedAt: timestamp }
      selectedDate = ruleDates(nextRule, nextDate, addDaysStr(nextDate, input.interval * 366 + 7))[0]
      if (!selectedDate) throw new Error('指定した期間に繰り返し日がありません')
      months.add(selectedDate.slice(0, 7))
      for (const month of months) {
        const range = monthRange(month)
        for (const date of ruleDates(nextRule, range.startDate, range.endDate)) expected.add(date)
      }
      await db.recurrenceRules.add(nextRule)
    }
    for (const issue of editable.filter(issue => issue.id !== id)) {
      const occurrenceDate = issue.recurrenceDate ?? issue.date!
      if (!nextRule || !expected.has(occurrenceDate) || occurrenceDate === selectedDate) {
        // 子や持ち越しとの関係を持つ回は、日程変更で作業ごと消さない。
        const linked = !!issue.carryoverFromId || all.some(child => child.parentId === issue.id && child.deletedAt === null)
        await db.issues.update(issue.id, linked ? { recurrenceId: null, recurrenceDate: undefined, recurrenceSeriesId: undefined, updatedAt: timestamp } : { deletedAt: timestamp, updatedAt: timestamp })
      } else {
        await db.issues.update(issue.id, { recurrenceId: nextRule.id, recurrenceSeriesId: nextRule.seriesId, recurrenceDate: occurrenceDate, updatedAt: timestamp })
        await updateIssue(issue.id, changes)
      }
    }
    await db.issues.update(id, { recurrenceId: nextRule?.id ?? null, recurrenceSeriesId: nextRule?.seriesId, recurrenceDate: nextRule ? selectedDate : undefined })
    await updateIssue(id, { ...singlePatch, date: selectedDate })
    const saved = (await getIssue(id))!
    if (nextRule) {
      for (const month of months) await expandRecurrenceInMonth(saved, month, timestamp)
      if (saved.sprintId) {
        const sprint = await db.sprints.get(saved.sprintId)
        if (sprint) await expandRecurrenceInSprint(saved, sprint, timestamp)
      }
    }
    if (planningMonth !== undefined) await updateIssue(id, { planningMonth })
    await syncParentStatuses(editable.map(issue => issue.parentId), timestamp)
    return (await getIssue(id))!
  })
}
