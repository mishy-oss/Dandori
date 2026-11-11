import { db } from './db'
import { newId, now } from '../lib/id'
import type { Project, Workflow, WorkflowStatus } from './types'

export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

// UI にプロジェクトの概念は出さず、内部では常に1つの既定プロジェクトに全Issueを紐づける
export const DEFAULT_PROJECT = { key: 'TASK', name: 'Dandori' } as const

/** 初期ワークフロー用に通常の3列と定期タスクの列を新しいIDで作る。 */
export function createDefaultStatuses(): WorkflowStatus[] {
  return [
    { id: newId(), name: 'To Do', category: 'todo' },
    { id: newId(), name: 'In Progress', category: 'doing' },
    { id: newId(), name: 'Recurring', category: 'routine' },
    { id: newId(), name: 'Done', category: 'done' },
  ]
}

export interface CreateProjectInput {
  key: string
  name: string
  color?: string
}

/** 削除されていないプロジェクトを作成日時の古い順で取得する。 */
export async function listProjects(): Promise<Project[]> {
  const all = await db.projects.toArray()
  return all
    .filter(/* 未削除という条件を満たす要素だけを残す。 */ (p) => p.deletedAt === null)
    .sort(/* 作成日時を比較し、古いものから順に並べる。 */ (a, b) => a.createdAt - b.createdAt)
}

/** 指定IDのプロジェクトを取得し、論理削除済みならundefinedを返す。 */
export async function getProject(id: string): Promise<Project | undefined> {
  const p = await db.projects.get(id)
  return p && p.deletedAt === null ? p : undefined
}

/** 指定IDのワークフローを取得し、論理削除済みならundefinedを返す。 */
export async function getWorkflow(id: string): Promise<Workflow | undefined> {
  const w = await db.workflows.get(id)
  return w && w.deletedAt === null ? w : undefined
}

/** 名前とキーの形式・重複を検証し、初期ワークフローとプロジェクトを同じトランザクションで保存する。 */
export async function createProject(input: CreateProjectInput): Promise<Project> {
  const key = input.key.trim().toUpperCase()
  const name = input.name.trim()
  if (!name) throw new Error('プロジェクト名を入力してください')
  if (!PROJECT_KEY_PATTERN.test(key)) {
    throw new Error('キーは英大文字で始まる2〜10文字の英数字にしてください')
  }

  return db.transaction('rw', db.projects, db.workflows, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const dup = (await db.projects.where('key').equals(key).toArray()).some(
      /** 未削除という条件を満たす要素が1つでもあるかを判定する。 */
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

// 起動時に呼ぶ。プロジェクトが無ければ既定のものを作る(同時に2回呼ばれても1つしか作らない)
export async function ensureDefaultProject(): Promise<Project> {
  return db.transaction('rw', db.projects, db.workflows, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const existing = await listProjects()
    return existing[0] ?? createProject(DEFAULT_PROJECT)
  })
}

// キーは Issue 表示名の元になるため変更不可
export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'color'>>,
): Promise<Project> {
  const name = patch.name?.trim()
  if (patch.name !== undefined && !name) {
    throw new Error('プロジェクト名を入力してください')
  }
  return db.transaction('rw', db.projects, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
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

/** プロジェクトと関連するワークフロー・スプリント・Issueをまとめて論理削除する。 */
export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.workflows, db.issues, db.sprints, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const p = await getProject(id)
    if (!p) return
    const t = now()
    await db.projects.update(id, { deletedAt: t, updatedAt: t })
    await db.workflows.update(p.workflowId, { deletedAt: t, updatedAt: t })
    await db.sprints
      .where('projectId')
      .equals(id)
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (s) => s.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
    await db.issues
      .where('projectId')
      .equals(id)
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
  })
}

/** ステータス名・IDの重複・必須カテゴリを検証する。Issueが残る列の削除を防いだうえでワークフローを保存する。 */
export async function updateWorkflowStatuses(
  workflowId: string,
  statuses: WorkflowStatus[],
): Promise<Workflow> {
  const cleaned = statuses.map(/* ステータス名の前後の空白を取り除いた保存用データを作る。 */ (s) => ({ ...s, name: s.name.trim() }))
  if (cleaned.some(/* 空のステータス名という条件を満たす要素が1つでもあるかを判定する。 */ (s) => !s.name)) {
    throw new Error('ステータス名を入力してください')
  }
  if (new Set(cleaned.map(/* 各要素からIDだけを取り出す。 */ (s) => s.id)).size !== cleaned.length) {
    throw new Error('ステータスIDが重複しています')
  }
  for (const category of ['todo', 'done'] as const) {
    if (!cleaned.some(/* 指定した必須カテゴリのステータスが少なくとも1つ残っているかを確認する。 */ (s) => s.category === category)) {
      throw new Error(`カテゴリ「${category}」のステータスが最低1つ必要です`)
    }
  }

  return db.transaction('rw', db.workflows, db.projects, db.issues, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const w = await getWorkflow(workflowId)
    if (!w) throw new Error('ワークフローが見つかりません')

    const keep = new Set(cleaned.map(/* 各要素からIDだけを取り出す。 */ (s) => s.id))
    const projects = (await db.projects.toArray()).filter(
      /** 未削除という条件を満たす要素だけを残す。 */
      (p) => p.workflowId === workflowId && p.deletedAt === null,
    )
    for (const p of projects) {
      const inUse = await db.issues
        .where('projectId')
        .equals(p.id)
        .filter(/* 未削除・変更後のステータス一覧に存在しないという条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null && !keep.has(i.statusId))
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
