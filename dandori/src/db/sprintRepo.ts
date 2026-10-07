import { differenceInCalendarDays, parseISO } from 'date-fns'
import { db } from './db'
import { addDaysStr, isValidDateStr, todayStr } from '../lib/date'
import { newId, now } from '../lib/id'
import { getProject, getWorkflow } from './projectRepo'
import type { Issue, Sprint, SprintSnapshot } from './types'

export const DEFAULT_SPRINT_DAYS = 14

export interface SprintInput {
  name?: string
  goal?: string
  startDate?: string
  endDate?: string
}

export type IncompleteIssuesAction =
  | { to: 'backlog' }
  | { to: 'sprint'; sprintId: string }
  | { to: 'new' }

export interface CompleteSprintResult {
  doneCount: number
  movedCount: number
  nextSprintId: string | null
}

export async function listSprints(projectId: string): Promise<Sprint[]> {
  const all = await db.sprints.where('projectId').equals(projectId).toArray()
  return all
    .filter((s) => s.deletedAt === null)
    .sort((a, b) => (a.startDate === b.startDate ? a.createdAt - b.createdAt : a.startDate < b.startDate ? -1 : 1))
}

export async function getSprint(id: string): Promise<Sprint | undefined> {
  const s = await db.sprints.get(id)
  return s && s.deletedAt === null ? s : undefined
}

function validatePeriod(startDate: string, endDate: string) {
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
    throw new Error('日付を正しく入力してください')
  }
  if (endDate < startDate) throw new Error('終了日は開始日以降にしてください')
}

async function insertSprint(projectId: string, input: SprintInput, today: string): Promise<Sprint> {
  const startDate = input.startDate ?? today
  const endDate = input.endDate ?? addDaysStr(startDate, DEFAULT_SPRINT_DAYS - 1)
  validatePeriod(startDate, endDate)

  const name = input.name?.trim() ?? `Sprint ${(await db.sprints.where('projectId').equals(projectId).count()) + 1}`
  if (!name) throw new Error('スプリント名を入力してください')

  const t = now()
  const sprint: Sprint = {
    id: newId(),
    projectId,
    name,
    goal: input.goal?.trim() || undefined,
    startDate,
    endDate,
    state: 'planned',
    snapshots: [],
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
  }
  await db.sprints.add(sprint)
  return sprint
}

export async function createSprint(
  projectId: string,
  input: SprintInput = {},
  today: string = todayStr(),
): Promise<Sprint> {
  return db.transaction('rw', db.projects, db.sprints, async () => {
    if (!(await getProject(projectId))) throw new Error('プロジェクトが見つかりません')
    return insertSprint(projectId, input, today)
  })
}

export async function updateSprint(
  id: string,
  patch: Pick<SprintInput, 'name' | 'goal' | 'startDate' | 'endDate'>,
): Promise<Sprint> {
  return db.transaction('rw', db.sprints, async () => {
    const current = await getSprint(id)
    if (!current) throw new Error('スプリントが見つかりません')
    if (current.state === 'closed') throw new Error('完了したスプリントは編集できません')

    const name = patch.name !== undefined ? patch.name.trim() : current.name
    if (!name) throw new Error('スプリント名を入力してください')
    const startDate = patch.startDate ?? current.startDate
    const endDate = patch.endDate ?? current.endDate
    validatePeriod(startDate, endDate)

    const next: Sprint = {
      ...current,
      name,
      goal: patch.goal !== undefined ? patch.goal.trim() || undefined : current.goal,
      startDate,
      endDate,
      updatedAt: now(),
    }
    await db.sprints.put(next)
    return next
  })
}

// 計画中のスプリントのみ削除でき、中のIssueはバックログへ戻る
export async function deleteSprint(id: string): Promise<void> {
  await db.transaction('rw', db.sprints, db.issues, async () => {
    const s = await getSprint(id)
    if (!s) return
    if (s.state !== 'planned') throw new Error('計画中のスプリントのみ削除できます')
    const t = now()
    await db.issues
      .where('sprintId')
      .equals(id)
      .filter((i) => i.deletedAt === null)
      .modify({ sprintId: null, updatedAt: t })
    await db.sprints.update(id, { deletedAt: t, updatedAt: t })
  })
}

export async function startSprint(id: string): Promise<Sprint> {
  return db.transaction('rw', db.sprints, db.issues, async () => {
    const s = await getSprint(id)
    if (!s) throw new Error('スプリントが見つかりません')
    if (s.state !== 'planned') throw new Error('計画中のスプリントのみ開始できます')

    const others = await listSprints(s.projectId)
    if (others.some((o) => o.state === 'active')) {
      throw new Error('アクティブなスプリントが既にあります。先に完了してください')
    }
    const count = await db.issues
      .where('sprintId')
      .equals(id)
      .filter((i) => i.deletedAt === null)
      .count()
    if (count === 0) throw new Error('バックログからIssueを追加してから開始してください')

    const next: Sprint = { ...s, state: 'active', updatedAt: now() }
    await db.sprints.put(next)
    return next
  })
}

function makeSnapshot(sprint: Sprint, issues: Issue[], doneIds: Set<string>, date: string): SprintSnapshot {
  const sprintIssues = issues.filter((i) => i.sprintId === sprint.id && i.deletedAt === null)
  const parentsWithChildren = new Set(sprintIssues.flatMap((i) => (i.parentId ? [i.parentId] : [])))
  // Epic and parent estimates are represented by their leaf work items to avoid double-counting.
  const workItems = sprintIssues.filter((i) => i.type !== 'epic' && !parentsWithChildren.has(i.id))
  const openItems = workItems.filter((i) => !doneIds.has(i.statusId))
  return {
    date,
    totalMin: workItems.reduce((sum, i) => sum + (i.estimateMin ?? 0), 0),
    totalCount: workItems.length,
    remainingMin: openItems.reduce((sum, i) => sum + (i.estimateMin ?? 0), 0),
    remainingCount: openItems.length,
  }
}

function withSnapshot(sprint: Sprint, snapshot: SprintSnapshot): Sprint {
  return {
    ...sprint,
    snapshots: [...sprint.snapshots.filter((s) => s.date !== snapshot.date), snapshot].sort((a, b) => a.date.localeCompare(b.date)),
    updatedAt: now(),
  }
}

/** Record or refresh today's actual remaining sprint scope. */
export async function recordSprintSnapshot(id: string, date: string = todayStr()): Promise<Sprint | undefined> {
  return db.transaction('rw', db.projects, db.workflows, db.sprints, db.issues, async () => {
    const sprint = await getSprint(id)
    if (!sprint || sprint.state !== 'active') return sprint
    const project = await getProject(sprint.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    if (!workflow) throw new Error('ワークフローが見つかりません')
    const issues = await db.issues.where('sprintId').equals(id).toArray()
    const doneIds = new Set(workflow.statuses.filter((status) => status.category === 'done').map((status) => status.id))
    const updated = withSnapshot(sprint, makeSnapshot(sprint, issues, doneIds, date))
    await db.sprints.put(updated)
    return updated
  })
}

export async function completeSprint(
  id: string,
  incomplete: IncompleteIssuesAction,
  today: string = todayStr(),
): Promise<CompleteSprintResult> {
  return db.transaction('rw', db.projects, db.workflows, db.sprints, db.issues, async () => {
    const s = await getSprint(id)
    if (!s) throw new Error('スプリントが見つかりません')
    if (s.state !== 'active') throw new Error('アクティブなスプリントのみ完了できます')

    const project = await getProject(s.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    if (!workflow) throw new Error('ワークフローが見つかりません')
    const doneIds = new Set(workflow.statuses.filter((st) => st.category === 'done').map((st) => st.id))

    const issues = await db.issues
      .where('sprintId')
      .equals(id)
      .filter((i) => i.deletedAt === null)
      .toArray()
    await db.sprints.put(withSnapshot(s, makeSnapshot(s, issues, doneIds, today)))
    const open: Issue[] = issues.filter((i) => !doneIds.has(i.statusId))

    let nextSprintId: string | null = null
    if (open.length > 0) {
      if (incomplete.to === 'sprint') {
        const target = await getSprint(incomplete.sprintId)
        if (!target || target.projectId !== s.projectId || target.state !== 'planned' || target.id === id) {
          throw new Error('移動先のスプリントが正しくありません')
        }
        nextSprintId = target.id
      } else if (incomplete.to === 'new') {
        const length = Math.max(differenceInCalendarDays(parseISO(s.endDate), parseISO(s.startDate)), 0)
        const dayAfterEnd = addDaysStr(s.endDate, 1)
        const startDate = dayAfterEnd > today ? dayAfterEnd : today
        const created = await insertSprint(
          s.projectId,
          { startDate, endDate: addDaysStr(startDate, length) },
          today,
        )
        nextSprintId = created.id
      }
      const t = now()
      await db.issues.bulkUpdate(
        open.map((i) => ({ key: i.id, changes: { sprintId: nextSprintId, updatedAt: t } })),
      )
    }

    await db.sprints.update(id, { state: 'closed', updatedAt: now() })
    return { doneCount: issues.length - open.length, movedCount: open.length, nextSprintId }
  })
}

// 完了済みスプリントへは移せない。null でバックログへ戻す
export async function assignIssueToSprint(issueId: string, sprintId: string | null): Promise<Issue> {
  return db.transaction('rw', db.sprints, db.issues, async () => {
    const issue = await db.issues.get(issueId)
    if (!issue || issue.deletedAt !== null) throw new Error('Issueが見つかりません')
    if (sprintId !== null) {
      const s = await getSprint(sprintId)
      if (!s || s.projectId !== issue.projectId) throw new Error('スプリントが見つかりません')
      if (s.state === 'closed') throw new Error('完了したスプリントには追加できません')
    }
    const next: Issue = { ...issue, sprintId, updatedAt: now() }
    await db.issues.put(next)
    return next
  })
}
