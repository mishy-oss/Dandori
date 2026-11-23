import { inTransaction } from './transaction'
import { db } from './db'
import { newId, now } from '../lib/id'
import { compareRank, rankAfter, rankBetween, ranksForCount } from '../lib/rank'
import { validateSchedule } from '../lib/schedule'
import { todayStr } from '../lib/date'
import { nextRuleDate, recurrenceSource, recurrenceTemplate } from '../lib/recurrence'
import { getProject, getWorkflow } from './projectRepo'
import { getSprint } from './sprintRepo'
import { applyRecurrencePatch, expandRecurrenceInSprint, expandRecurrenceInMonth, normalizeRecurrence, type RecurrenceInput } from './recurrenceRepo'
import { isValidMonth, issueMonth, currentMonth } from '../lib/month'
import { existingIssueLabels, normalizeIssueLabels } from '../lib/labels'
import type { Issue, IssueType, Priority, RecurrenceRule } from './types'

export interface CreateIssueInput {
  projectId: string
  title: string
  type?: IssueType
  priority?: Priority
  statusId?: string
  description?: string
  parentId?: string | null
  labels?: string[]
  dueDate?: string | null
  estimateMin?: number | null
  sprintId?: string | null
  planningMonth?: string
  date?: string | null
  startMin?: number | null
  durationMin?: number
  calendarAllDay?: boolean
  reminderOffsetMin?: number | null
  recurrence?: RecurrenceInput
}

export type IssuePatch = Partial<
  Omit<Issue, 'id' | 'projectId' | 'number' | 'rank' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'recurrenceId'>
> & { recurrence?: RecurrenceInput | null }

const DEFAULT_DURATION_MIN = 30

/* 子と祖先の進捗が食い違わないよう、呼び出し元と同じトランザクション内で更新する。 */
export async function syncParentStatuses(ids: (string | null)[], timestamp: number): Promise<void> {
  for (const id of ids) {
    let parentId = id
    const seen = new Set<string>()
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId)
      const parent = await getIssue(parentId)
      if (!parent) break
      if (parent.carryoverToId) break
      const project = await getProject(parent.projectId)
      const workflow = project && await getWorkflow(project.workflowId)
      if (!workflow) break
      const children = await db.issues.where('parentId').equals(parent.id)
        .filter((child) => child.deletedAt === null && !child.carryoverToId && child.projectId === parent.projectId).toArray()
      if (children.length) {
        const categories = children.map((child) => workflow.statuses.find((s) => s.id === child.statusId)?.category)
        const category = categories.every((value) => value === 'done') ? 'done'
          : categories.some((value) => value === 'doing' || value === 'done' || value === 'routine') ? 'doing' : 'todo'
        const targetCategory = parent.isRoutine && category !== 'done' ? 'routine' : category
        const target = workflow.statuses.find((status) => status.category === targetCategory)
        const currentCategory = workflow.statuses.find((status) => status.id === parent.statusId)?.category
        if (target && currentCategory !== targetCategory) {
          await db.issues.update(parent.id, {
            statusId: target.id, completedAt: category === 'done' ? timestamp : null,
            rank: await nextRankInStatus(parent.projectId, target.id), updatedAt: timestamp,
          })
        }
      }
      parentId = parent.parentId
    }
  }
}

function activeInStatus(issues: Issue[], statusId: string): Issue[] {
  return issues.filter((i) => i.deletedAt === null && !i.carryoverToId && i.statusId === statusId)
}

async function nextRankInStatus(
  projectId: string,
  statusId: string,
): Promise<string> {
  const siblings = activeInStatus(
    await db.issues.where('projectId').equals(projectId).toArray(),
    statusId,
  )
  const last = siblings.reduce<string | null>(
    (max, i) => (max === null || i.rank > max ? i.rank : max),
    null,
  )
  return rankAfter(last)
}

export async function listIssues(projectId: string): Promise<Issue[]> {
  const all = await db.issues.where('projectId').equals(projectId).toArray()
  return all
    .filter((i) => i.deletedAt === null)
    .sort(compareRank)
}

export async function getIssue(id: string): Promise<Issue | undefined> {
  const i = await db.issues.get(id)
  return i && i.deletedAt === null ? i : undefined
}

export async function listRecurrenceRules(projectId: string): Promise<RecurrenceRule[]> {
  return db.recurrenceRules.where('projectId').equals(projectId).toArray()
}

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  const title = input.title.trim()
  if (input.calendarAllDay && (!input.date || input.startMin != null)) throw new Error('終日予定には日付を指定し、開始時刻は空にしてください')
  const durationMin = input.calendarAllDay ? 1440 : input.durationMin ?? DEFAULT_DURATION_MIN
  if (!title) throw new Error('タイトルを入力してください')
  if (input.planningMonth !== undefined && !isValidMonth(input.planningMonth)) throw new Error('対象月を正しく指定してください')

  return inTransaction(db, 'rw', [db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules], async () => {
    const project = await getProject(input.projectId)
    if (!project) throw new Error('プロジェクトが見つかりません')
    const workflow = await getWorkflow(project.workflowId)
    if (!workflow) throw new Error('ワークフローが見つかりません')

    if (input.sprintId) {
      const sprint = await getSprint(input.sprintId)
      if (!sprint || sprint.projectId !== project.id) throw new Error('スプリントが見つかりません')
      if (sprint.state === 'closed') throw new Error('完了したスプリントには追加できません')
    }

    let statusId =
      input.statusId ??
      workflow.statuses.find((s) => s.category === 'todo')!.id
    const status = workflow.statuses.find((s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')

    if (input.date != null && input.startMin != null && status.category === 'todo') {
      statusId = workflow.statuses.find((s) => s.category === 'doing')?.id ?? statusId
    }

    if (input.parentId) await validateParent(project.id, input.parentId)

    const recurrenceStartDate = input.date ?? (input.planningMonth && input.planningMonth !== currentMonth() ? `${input.planningMonth}-01` : todayStr())
    const recurrenceValues = input.recurrence
      ? normalizeRecurrence(input.recurrence, recurrenceStartDate)
      : null

    validateSchedule(input.date ?? null, input.startMin ?? null, durationMin)

    const t = now()
    const recurrenceRule: RecurrenceRule | null = recurrenceValues
      ? {
          id: newId(),
          projectId: project.id,
          ...recurrenceValues,
          createdAt: t,
          updatedAt: t,
        }
      : null
    const issue: Issue = {
      id: newId(),
      projectId: project.id,
      number: project.nextNumber,
      type: input.type ?? 'task',
      title,
      description: input.description,
      statusId,
      isRoutine: status.category === 'routine',
      priority: input.priority ?? 'medium',
      parentId: input.parentId ?? null,
      labels: normalizeIssueLabels(input.labels ?? [], existingIssueLabels(await db.issues.where('projectId').equals(project.id).toArray(), project.id)),
      dueDate: input.dueDate ?? null,
      estimateMin: input.estimateMin ?? null,
      sprintId: input.sprintId ?? null,
      planningMonth: input.planningMonth,
      rank: await nextRankInStatus(project.id, statusId),
      date: input.date ?? (recurrenceRule ? recurrenceStartDate : null),
      startMin: input.startMin ?? null,
      durationMin,
      calendarAllDay: input.calendarAllDay ?? false,
      icon: '',
      color: project.color,
      reminderOffsetMin: input.reminderOffsetMin ?? null,
      recurrenceId: recurrenceRule?.id ?? null,
      recurrenceDate: recurrenceRule ? recurrenceStartDate : undefined,
      recurrenceSeriesId: recurrenceRule?.id,
      assigneeId: null,
      completedAt: status.category === 'done' ? t : null,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    }
    if (recurrenceRule) await db.recurrenceRules.add({ ...recurrenceRule, template: recurrenceTemplate(issue) })
    await db.issues.add(issue)
    await db.projects.update(project.id, {
      nextNumber: project.nextNumber + 1,
      updatedAt: t,
    })
    if (recurrenceRule && issue.sprintId) {
      const sprint = await getSprint(issue.sprintId)
      if (sprint) await expandRecurrenceInSprint(issue, sprint, t)
    }
    if (recurrenceRule && issue.planningMonth && !issue.sprintId) await expandRecurrenceInMonth(issue, issue.planningMonth, t)
    await syncParentStatuses([issue.parentId], t)
    return issue
    })
}

export async function updateIssue(
  id: string,
  patch: IssuePatch,
): Promise<Issue> {
  const { recurrence: recurrencePatch, ...issuePatch } = patch
  if (issuePatch.planningMonth !== undefined && !isValidMonth(issuePatch.planningMonth)) throw new Error('対象月を正しく指定してください')
  const title = issuePatch.title?.trim()
  if (issuePatch.title !== undefined && !title) {
    throw new Error('タイトルを入力してください')
  }

  return inTransaction(db, 'rw', [db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules], async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    if (current.carryoverToId) throw new Error('持ち越し済みの配置は履歴です。持ち越し先を編集してください')
    if (issuePatch.parentId && issuePatch.parentId !== current.parentId) await validateParent(current.projectId, issuePatch.parentId, id)

    const t = now()
    const next: Issue = {
      ...current,
      ...issuePatch,
      ...(title !== undefined && { title }),
      updatedAt: t,
    }
    if (issuePatch.labels !== undefined) {
      next.labels = normalizeIssueLabels(issuePatch.labels, existingIssueLabels(await db.issues.where('projectId').equals(current.projectId).toArray(), current.projectId))
    }
    if (issuePatch.date && issuePatch.planningMonth === undefined && current.planningMonth) next.planningMonth = issuePatch.date.slice(0, 7)
    if (next.startMin !== null || next.date === null) {
      next.calendarAllDay = false
      if (current.calendarAllDay && issuePatch.durationMin === undefined && next.durationMin === 1440) next.durationMin = DEFAULT_DURATION_MIN
    }
    if (next.calendarAllDay) next.durationMin = 1440
    validateSchedule(next.date, next.startMin, next.durationMin)

    if (recurrencePatch !== undefined) await applyRecurrencePatch(next, recurrencePatch)

    const newlyScheduled = (current.date === null || current.startMin === null)
      && next.date !== null && next.startMin !== null
    const clearedSchedule = (issuePatch.date === null || issuePatch.startMin === null)
      && (next.date === null || next.startMin === null)
    let completedStatusIds: string[] = []
    if (newlyScheduled || clearedSchedule || 'statusId' in issuePatch) {
      const project = await getProject(current.projectId)
      const workflow = project && await getWorkflow(project.workflowId)
      const statuses = workflow?.statuses ?? []
      const chosenStatus = statuses.find((status) => status.id === next.statusId)
      if (issuePatch.statusId !== undefined && chosenStatus && chosenStatus.category !== 'done') {
        next.isRoutine = chosenStatus.category === 'routine'
      }
      if (newlyScheduled && chosenStatus?.category === 'todo') {
        next.statusId = statuses.find((status) => status.category === 'doing')?.id ?? next.statusId
      }
      if (clearedSchedule && chosenStatus && chosenStatus.category !== 'done' && chosenStatus.category !== 'routine') {
        next.statusId = statuses.find((status) => status.category === 'todo')?.id ?? next.statusId
      }
      if (next.statusId !== current.statusId) {
        const status = statuses.find((status) => status.id === next.statusId)
        if (!status) throw new Error('ステータスが見つかりません')
        const previousStatus = statuses.find((status) => status.id === current.statusId)
        if (status.category === 'done' && previousStatus?.category !== 'done') {
          completedStatusIds = statuses.filter((status) => status.category === 'done').map((status) => status.id)
        }
        next.completedAt = status.category === 'done' ? t : null
        next.rank = await nextRankInStatus(current.projectId, status.id)
      }
    }

    await db.issues.put(next)
    if (recurrencePatch !== undefined && next.sprintId && next.recurrenceId) {
      const sprint = await getSprint(next.sprintId)
      if (sprint) await expandRecurrenceInSprint(next, sprint, t)
    }
    if (next.planningMonth && !next.sprintId && next.recurrenceId && (recurrencePatch !== undefined || issuePatch.planningMonth !== undefined)) {
      await expandRecurrenceInMonth(next, next.planningMonth, t)
    }
    return finalizeIssueChange(next, completedStatusIds, current.parentId)
  })
}

async function finalizeIssueChange(issue: Issue, completedStatusIds: string[], previousParentId: string | null = null): Promise<Issue> {
  // 子の進捗が手動の完了を取り消した場合は、繰り返しの次回分を生成しない。
  await syncParentStatuses([issue.id], issue.updatedAt)
  const saved = (await getIssue(issue.id))!
  if (completedStatusIds.includes(saved.statusId)) await createNextOccurrence(saved, issue.updatedAt)

  // 次の回が未完了の子として追加されると、親の進捗が変わることがある。
  await syncParentStatuses([previousParentId, issue.id], issue.updatedAt)
  return (await getIssue(issue.id))!
}

async function createNextOccurrence(completed: Issue, timestamp: number): Promise<void> {
  if (!completed.recurrenceId) return
  const rule = await db.recurrenceRules.get(completed.recurrenceId)
  if (!rule?.active) return
  if (completed.sprintId) {
    const sprint = await getSprint(completed.sprintId)
    if (sprint) await expandRecurrenceInSprint(completed, sprint, timestamp)
  }
  const refreshed = completed.sprintId ? await db.issues.get(completed.id) : undefined
  const currentDate = refreshed?.recurrenceDate ?? completed.recurrenceDate ?? refreshed?.date ?? completed.date ?? rule.startDate
  let nextDate = nextRuleDate(rule, currentDate)
  while (rule.excludedDates?.includes(nextDate) || (rule.effectiveFrom && nextDate < rule.effectiveFrom)) nextDate = nextRuleDate(rule, nextDate)
  if (rule.endDate && nextDate > rule.endDate) return

  const alreadyExists = await db.issues
    .where('recurrenceId')
    .equals(rule.id)
    .filter((issue) => (rule.seriesId !== undefined || completed.planningMonth !== undefined || issue.deletedAt === null) && (issue.recurrenceDate ?? issue.date) === nextDate)
    .first()
  if (alreadyExists) return

  const project = await getProject(completed.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const source = recurrenceSource(completed, rule)
  const todoStatus = workflow?.statuses.find((status) => status.category === (source.isRoutine ? 'routine' : 'todo'))
  if (!project || !todoStatus) return

  const nextIssue: Issue = {
    ...source,
    carryoverFromId: undefined, carryoverToId: undefined, carryoverRootId: undefined, carryoverSequence: undefined,
    id: rule.seriesId ? `r-${rule.id}-${nextDate}` : newId(),
    number: project.nextNumber,
    statusId: todoStatus.id,
    sprintId: null,
    planningMonth: completed.planningMonth ? nextDate.slice(0, 7) : undefined,
    rank: await nextRankInStatus(project.id, todoStatus.id),
    date: nextDate,
    recurrenceDate: nextDate,
    dueDate: source.dueDate === source.date ? nextDate : source.dueDate,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
  await db.issues.add(nextIssue)
  await db.projects.update(project.id, { nextNumber: project.nextNumber + 1, updatedAt: timestamp })
}

async function validateParent(projectId: string, parentId: string, issueId?: string): Promise<void> {
  const seen = new Set(issueId ? [issueId] : [])
  let parent = await getIssue(parentId)
  while (parent) {
    if (parent.carryoverToId) throw new Error('持ち越し済みの履歴は親にできません')
    if (parent.projectId !== projectId) throw new Error('別のプロジェクトのIssueは親にできません')
    if (seen.has(parent.id)) throw new Error('親子関係が循環しています')
    seen.add(parent.id)
    if (!parent.parentId) return
    parent = await getIssue(parent.parentId)
  }
  throw new Error('親Issueが見つかりません')
}

// ドラッグ位置の index は、対象月や旧スプリントで絞った表示中の列を基準にする。
export async function moveIssue(
  id: string,
  statusId: string,
  index: number,
  scopeSprintId?: string | null,
  scopeMonth?: string,
): Promise<Issue> {
  return inTransaction(db, 'rw', [db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules], async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    if (current.carryoverToId) throw new Error('持ち越し済みの配置は履歴です。持ち越し先を編集してください')
    const project = await getProject(current.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    const status = workflow?.statuses.find((s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')
    const previousStatus = workflow?.statuses.find((s) => s.id === current.statusId)

    const t = now()
    const others = activeInStatus(
      await db.issues.where('projectId').equals(current.projectId).toArray(),
      statusId,
    )
      .filter((i) => i.id !== id && (scopeSprintId === undefined || i.sprintId === scopeSprintId) && (scopeMonth === undefined || issueMonth(i) === scopeMonth))
      .sort(compareRank)
    const at = Math.max(0, Math.min(index, others.length))

    let prev = at > 0 ? others[at - 1].rank : null
    let next = at < others.length ? others[at].rank : null
    if (prev !== null && next !== null && prev >= next) {
      const ranks = ranksForCount(others.length)
      await Promise.all(
        others.map((o, i) => db.issues.update(o.id, { rank: ranks[i], updatedAt: t })),
      )
      prev = at > 0 ? ranks[at - 1] : null
      next = at < others.length ? ranks[at] : null
    }

    const keepCompletedAt = current.statusId === statusId && current.completedAt !== null
    const moved: Issue = {
      ...current,
      statusId,
      isRoutine: status.category === 'done' ? current.isRoutine : status.category === 'routine',
      rank: rankBetween(prev, next),
      completedAt:
        status.category === 'done' ? (keepCompletedAt ? current.completedAt : t) : null,
      updatedAt: t,
    }
    await db.issues.put(moved)
    const completedStatusIds = status.category === 'done' && previousStatus?.category !== 'done' ? [status.id] : []
    return finalizeIssueChange(moved, completedStatusIds)
  })
}

export async function deleteIssue(id: string): Promise<void> {
  await inTransaction(db, 'rw', [db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules], async () => {
    const t = now()
    const current = await getIssue(id)
    if (current?.carryoverToId) throw new Error('持ち越し済みの配置は履歴として残します')
    if (current) await createNextOccurrence(current, t)
    const toDelete = new Set<string>([id])
    let frontier = [id]
    while (frontier.length > 0) {
      const children = await db.issues
        .where('parentId')
        .anyOf(frontier)
        .filter((i) => i.deletedAt === null && !i.carryoverToId && !toDelete.has(i.id))
        .toArray()
      frontier = children.map((c) => c.id)
      frontier.forEach((c) => toDelete.add(c))
    }
    await db.issues
      .where('id')
      .anyOf([...toDelete])
      .filter((i) => i.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
    await syncParentStatuses([current?.parentId ?? null], t)
  })
}
