import { db } from './db'
import { newId, now } from '../lib/id'
import type { Project, Workflow, WorkflowStatus } from './types'

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

export function createDefaultStatuses(): WorkflowStatus[] {
  return [
    { id: newId(), name: 'To Do', category: 'todo' },
    { id: newId(), name: 'In Progress', category: 'doing', wipLimit: 3 },
    { id: newId(), name: 'Done', category: 'done' },
  ]
}

export interface CreateProjectInput {
  key: string
  name: string
  color?: string
}

export async function listProjects(): Promise<Project[]> {
  const all = await db.projects.toArray()
  return all
    .filter((p) => p.deletedAt === null)
    .sort((a, b) => a.createdAt - b.createdAt)
}

export async function getProject(id: string): Promise<Project | undefined> {
  const p = await db.projects.get(id)
  return p && p.deletedAt === null ? p : undefined
}

export async function getWorkflow(id: string): Promise<Workflow | undefined> {
  const w = await db.workflows.get(id)
  return w && w.deletedAt === null ? w : undefined
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const key = input.key.trim().toUpperCase()
  const name = input.name.trim()
  if (!name) throw new Error('プロジェクト名を入力してください')
  if (!PROJECT_KEY_PATTERN.test(key)) {
    throw new Error('キーは英大文字で始まる2〜10文字の英数字にしてください')
  }

  return db.transaction('rw', db.projects, db.workflows, async () => {
    const dup = (await db.projects.where('key').equals(key).toArray()).some(
      (p) => p.deletedAt === null,
    )
    if (dup) throw new Error(`キー「${key}」は既に使われています`)

    const t = now()
    const workflow: Workflow = {
      id: newId(),
      statuses: createDefaultStatuses(),
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    }
    const project: Project = {
      id: newId(),
      key,
      name,
      color: input.color ?? '#38bdf8',
      workflowId: workflow.id,
      nextNumber: 1,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    }
    await db.workflows.add(workflow)
    await db.projects.add(project)
    return project
  })
}

// キーは Issue 表示名(APP-12)の元になるため変更不可
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'color'>>,
): Promise<Project> {
  const name = patch.name?.trim()
  if (patch.name !== undefined && !name) {
    throw new Error('プロジェクト名を入力してください')
  }
  return db.transaction('rw', db.projects, async () => {
    const p = await getProject(id)
    if (!p) throw new Error('プロジェクトが見つかりません')
    const next: Project = {
      ...p,
      ...(name !== undefined && { name }),
      ...(patch.color !== undefined && { color: patch.color }),
      updatedAt: now(),
    }
    await db.projects.put(next)
    return next
  })
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.workflows, db.issues, async () => {
    const p = await getProject(id)
    if (!p) return
    const t = now()
    await db.projects.update(id, { deletedAt: t, updatedAt: t })
    await db.workflows.update(p.workflowId, { deletedAt: t, updatedAt: t })
    await db.issues
      .where('projectId')
      .equals(id)
      .filter((i) => i.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
  })
}

export async function updateWorkflowStatuses(
  workflowId: string,
  statuses: WorkflowStatus[],
): Promise<Workflow> {
  const cleaned = statuses.map((s) => ({ ...s, name: s.name.trim() }))
  if (cleaned.some((s) => !s.name)) {
    throw new Error('ステータス名を入力してください')
  }
  if (new Set(cleaned.map((s) => s.id)).size !== cleaned.length) {
    throw new Error('ステータスIDが重複しています')
  }
  for (const category of ['todo', 'done'] as const) {
    if (!cleaned.some((s) => s.category === category)) {
      throw new Error(`カテゴリ「${category}」のステータスが最低1つ必要です`)
    }
  }

  return db.transaction('rw', db.workflows, db.projects, db.issues, async () => {
    const w = await getWorkflow(workflowId)
    if (!w) throw new Error('ワークフローが見つかりません')

    const keep = new Set(cleaned.map((s) => s.id))
    const projects = (await db.projects.toArray()).filter(
      (p) => p.workflowId === workflowId && p.deletedAt === null,
    )
    for (const p of projects) {
      const inUse = await db.issues
        .where('projectId')
        .equals(p.id)
        .filter((i) => i.deletedAt === null && !keep.has(i.statusId))
        .count()
      if (inUse > 0) {
        throw new Error('Issueが残っているステータスは削除できません')
      }
    }

    const next: Workflow = { ...w, statuses: cleaned, updatedAt: now() }
    await db.workflows.put(next)
    return next
  })
}
