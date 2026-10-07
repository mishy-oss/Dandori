import { db } from './db'
import { newId, now } from '../lib/id'
import { compareRank, rankAfter, rankBetween, ranksForCount } from '../lib/rank'
import { validateSchedule } from '../lib/schedule'
import { getProject, getWorkflow } from './projectRepo'
import { getSprint } from './sprintRepo'
import type { Issue, IssueType, Priority } from './types'

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
  date?: string | null
  startMin?: number | null
  durationMin?: number
}

export type IssuePatch = Partial<
  Omit<Issue, 'id' | 'projectId' | 'number' | 'rank' | 'createdAt' | 'updatedAt' | 'deletedAt'>
>

const DEFAULT_DURATION_MIN = 30

function activeInStatus(issues: Issue[], statusId: string): Issue[] {
  return issues.filter((i) => i.deletedAt === null && i.statusId === statusId)
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

export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  const title = input.title.trim()
  if (!title) throw new Error('タイトルを入力してください')

  return db.transaction('rw', db.projects, db.workflows, db.issues, db.sprints, async () => {
    const project = await getProject(input.projectId)
    if (!project) throw new Error('プロジェクトが見つかりません')
    const workflow = await getWorkflow(project.workflowId)
    if (!workflow) throw new Error('ワークフローが見つかりません')

    if (input.sprintId) {
      const sprint = await getSprint(input.sprintId)
      if (!sprint || sprint.projectId !== project.id) throw new Error('スプリントが見つかりません')
      if (sprint.state === 'closed') throw new Error('完了したスプリントには追加できません')
    }

    const statusId =
      input.statusId ??
      workflow.statuses.find((s) => s.category === 'todo')!.id
    const status = workflow.statuses.find((s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')

    if (input.parentId) {
      const parent = await getIssue(input.parentId)
      if (!parent || parent.projectId !== project.id) {
        throw new Error('親Issueが見つかりません')
      }
    }

    validateSchedule(input.date ?? null, input.startMin ?? null, input.durationMin ?? DEFAULT_DURATION_MIN)

    const t = now()
    const issue: Issue = {
      id: newId(),
      projectId: project.id,
      number: project.nextNumber,
      type: input.type ?? 'task',
      title,
      description: input.description,
      statusId,
      priority: input.priority ?? 'medium',
      parentId: input.parentId ?? null,
      labels: input.labels ?? [],
      dueDate: input.dueDate ?? null,
      estimateMin: input.estimateMin ?? null,
      sprintId: input.sprintId ?? null,
      rank: await nextRankInStatus(project.id, statusId),
      date: input.date ?? null,
      startMin: input.startMin ?? null,
      durationMin: input.durationMin ?? DEFAULT_DURATION_MIN,
      icon: '',
      color: project.color,
      reminderOffsetMin: null,
      recurrenceId: null,
      assigneeId: null,
      completedAt: status.category === 'done' ? t : null,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    }
    await db.issues.add(issue)
    await db.projects.update(project.id, {
      nextNumber: project.nextNumber + 1,
      updatedAt: t,
    })
    return issue
  })
}

export async function updateIssue(
  id: string,
  patch: IssuePatch,
): Promise<Issue> {
  const title = patch.title?.trim()
  if (patch.title !== undefined && !title) {
    throw new Error('タイトルを入力してください')
  }

  return db.transaction('rw', db.projects, db.workflows, db.issues, async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    if (patch.parentId === id) throw new Error('自分自身を親にはできません')

    const t = now()
    const next: Issue = {
      ...current,
      ...patch,
      ...(title !== undefined && { title }),
      updatedAt: t,
    }
    validateSchedule(next.date, next.startMin, next.durationMin)

    // ステータスとスケジュールは独立。ステータス変更時は完了日時と列内の並びだけ更新する
    if (patch.statusId !== undefined && patch.statusId !== current.statusId) {
      const project = await getProject(current.projectId)
      const workflow = project && (await getWorkflow(project.workflowId))
      const status = workflow?.statuses.find((s) => s.id === patch.statusId)
      if (!status) throw new Error('ステータスが見つかりません')
      next.completedAt = status.category === 'done' ? t : null
      next.rank = await nextRankInStatus(current.projectId, status.id)
    }

    await db.issues.put(next)
    return next
  })
}

// ステータス列 statusId の index 番目(自分自身を除く)へ移動する。スケジュール(date/startMin)には触れない。
// scopeSprintId を渡すと、そのスプリント(null はバックログ)のIssueだけを「見えている列」として index を解釈する
export async function moveIssue(
  id: string,
  statusId: string,
  index: number,
  scopeSprintId?: string | null,
): Promise<Issue> {
  return db.transaction('rw', db.projects, db.workflows, db.issues, async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    const project = await getProject(current.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    const status = workflow?.statuses.find((s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')

    const t = now()
    const others = activeInStatus(
      await db.issues.where('projectId').equals(current.projectId).toArray(),
      statusId,
    )
      .filter((i) => i.id !== id && (scopeSprintId === undefined || i.sprintId === scopeSprintId))
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
      rank: rankBetween(prev, next),
      completedAt:
        status.category === 'done' ? (keepCompletedAt ? current.completedAt : t) : null,
      updatedAt: t,
    }
    await db.issues.put(moved)
    return moved
  })
}

export async function deleteIssue(id: string): Promise<void> {
  await db.transaction('rw', db.issues, async () => {
    const t = now()
    const toDelete = new Set<string>([id])
    // サブタスク/Epic配下を再帰的に論理削除する
    let frontier = [id]
    while (frontier.length > 0) {
      const children = await db.issues
        .where('parentId')
        .anyOf(frontier)
        .filter((i) => i.deletedAt === null && !toDelete.has(i.id))
        .toArray()
      frontier = children.map((c) => c.id)
      frontier.forEach((c) => toDelete.add(c))
    }
    await db.issues
      .where('id')
      .anyOf([...toDelete])
      .filter((i) => i.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
  })
}
