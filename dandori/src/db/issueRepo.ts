import { db } from './db'
import { newId, now } from '../lib/id'
import { compareRank, rankAfter, rankBetween, ranksForCount } from '../lib/rank'
import { validateSchedule } from '../lib/schedule'
import { isValidDateStr, nextRecurrenceDate, nextWeeklyRecurrenceDate, todayStr } from '../lib/date'
import { getProject, getWorkflow } from './projectRepo'
import { getSprint } from './sprintRepo'
import { expandRecurrenceInSprint } from './recurrenceRepo'
import type { Issue, IssueType, Priority, RecurrenceFrequency, RecurrenceRule } from './types'

export interface RecurrenceInput {
  frequency: RecurrenceFrequency
  interval: number
  weekdays?: number[]
  endDate?: string | null
}

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
  reminderOffsetMin?: number | null
  recurrence?: RecurrenceInput
}

export type IssuePatch = Partial<
  Omit<Issue, 'id' | 'projectId' | 'number' | 'rank' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'recurrenceId'>
> & { recurrence?: RecurrenceInput | null }

const DEFAULT_DURATION_MIN = 30

/** 削除されていないIssueのうち、指定したステータスに属するものを取り出す。 */
function activeInStatus(issues: Issue[], statusId: string): Issue[] {
  return issues.filter(/* 未削除・指定ステータスと一致という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null && i.statusId === statusId)
}

/** 繰り返し間隔・終了日・曜日を検証し、保存用の有効な繰り返しルールを組み立てる。不正な入力はエラーにする。 */
function normalizeRecurrence(input: RecurrenceInput, startDate: string): Omit<RecurrenceRule, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> {
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
      weekdays.some(/* 曜日に整数以外または0〜6の範囲外の値が含まれていないかを確認する。 */ (weekday) => !Number.isInteger(weekday) || weekday < 0 || weekday > 6) ||
      new Set(weekdays).size !== weekdays.length
    ) {
      throw new Error('繰り返す曜日を1つ以上選択してください')
    }
    weekdays = [...weekdays].sort(/* 数値を比較し、小さい値から順に並べる。 */ (a, b) => a - b)
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

/** 指定したステータスの既存Issueを調べ、列の末尾に追加するための並び順キーを作る。 */
async function nextRankInStatus(
  projectId: string,
  statusId: string,
): Promise<string> {
  const siblings = activeInStatus(
    await db.issues.where('projectId').equals(projectId).toArray(),
    statusId,
  )
  const last = siblings.reduce<string | null>(
    /** 並び順キーを比較し、これまでの最大値を次の要素へ引き継ぐ。 */
    (max, i) => (max === null || i.rank > max ? i.rank : max),
    null,
  )
  return rankAfter(last)
}

/** プロジェクトの未削除Issueを読み込み、並び順キーの昇順で返す。 */
export async function listIssues(projectId: string): Promise<Issue[]> {
  const all = await db.issues.where('projectId').equals(projectId).toArray()
  return all
    .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
    .sort(compareRank)
}

/** IDでIssueを取得する。存在しない場合や論理削除済みの場合はundefinedを返す。 */
export async function getIssue(id: string): Promise<Issue | undefined> {
  const i = await db.issues.get(id)
  return i && i.deletedAt === null ? i : undefined
}

/** 指定したプロジェクトに保存されている繰り返しルールを取得する。 */
export async function listRecurrenceRules(projectId: string): Promise<RecurrenceRule[]> {
  return db.recurrenceRules.where('projectId').equals(projectId).toArray()
}

/** 入力と所属先を検証してIssueを採番・保存する。繰り返し設定がありスプリントに所属する場合は期間内の予定も生成する。 */
export async function createIssue(input: CreateIssueInput): Promise<Issue> {
  const title = input.title.trim()
  if (!title) throw new Error('タイトルを入力してください')

  return db.transaction(
    'rw', db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules,
    /** 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */
    async () => {
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
      workflow.statuses.find(/* 未着手カテゴリという条件を最初に満たす要素を探す。 */ (s) => s.category === 'todo')!.id
    const status = workflow.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')

    if (input.parentId) await validateParent(project.id, input.parentId)

    const recurrenceStartDate = input.date ?? todayStr()
    const recurrenceValues = input.recurrence
      ? normalizeRecurrence(input.recurrence, recurrenceStartDate)
      : null

    validateSchedule(input.date ?? null, input.startMin ?? null, input.durationMin ?? DEFAULT_DURATION_MIN)

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
      priority: input.priority ?? 'medium',
      parentId: input.parentId ?? null,
      labels: input.labels ?? [],
      dueDate: input.dueDate ?? null,
      estimateMin: input.estimateMin ?? null,
      sprintId: input.sprintId ?? null,
      rank: await nextRankInStatus(project.id, statusId),
      date: input.date ?? (recurrenceRule ? recurrenceStartDate : null),
      startMin: input.startMin ?? null,
      durationMin: input.durationMin ?? DEFAULT_DURATION_MIN,
      icon: '',
      color: project.color,
      reminderOffsetMin: input.reminderOffsetMin ?? null,
      recurrenceId: recurrenceRule?.id ?? null,
      assigneeId: null,
      completedAt: status.category === 'done' ? t : null,
      createdAt: t,
      updatedAt: t,
      deletedAt: null,
    }
    if (recurrenceRule) await db.recurrenceRules.add(recurrenceRule)
    await db.issues.add(issue)
    await db.projects.update(project.id, {
      nextNumber: project.nextNumber + 1,
      updatedAt: t,
    })
    if (recurrenceRule && issue.sprintId) {
      const sprint = await getSprint(issue.sprintId)
      if (sprint) await expandRecurrenceInSprint(issue, sprint, t)
    }
    return issue
    },
  )
}

/** Issueの変更内容を検証して保存する。完了日時・列内順位・繰り返しルールを更新し、必要なら次回分を生成する。 */
export async function updateIssue(
  id: string,
  patch: IssuePatch,
): Promise<Issue> {
  const { recurrence: recurrencePatch, ...issuePatch } = patch
  const title = issuePatch.title?.trim()
  if (issuePatch.title !== undefined && !title) {
    throw new Error('タイトルを入力してください')
  }

  return db.transaction('rw', db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    if (issuePatch.parentId) await validateParent(current.projectId, issuePatch.parentId, id)

    const t = now()
    const next: Issue = {
      ...current,
      ...issuePatch,
      ...(title !== undefined && { title }),
      updatedAt: t,
    }
    validateSchedule(next.date, next.startMin, next.durationMin)

    if (recurrencePatch !== undefined) {
      const existingRule = current.recurrenceId
        ? await db.recurrenceRules.get(current.recurrenceId)
        : undefined
      if (recurrencePatch === null) {
        if (existingRule) {
          await db.recurrenceRules.update(existingRule.id, { active: false, updatedAt: t })
          await db.issues.where('recurrenceId').equals(existingRule.id).modify({ recurrenceId: null, updatedAt: t })
        }
        next.recurrenceId = null
      } else {
        const recurrenceStartDate = next.date ?? existingRule?.startDate ?? todayStr()
        const recurrenceValues = normalizeRecurrence(recurrencePatch, recurrenceStartDate)
        if (existingRule) {
          await db.recurrenceRules.put({ ...existingRule, ...recurrenceValues, updatedAt: t })
          next.recurrenceId = existingRule.id
        } else {
          const newRule: RecurrenceRule = {
            id: newId(),
            projectId: current.projectId,
            ...recurrenceValues,
            createdAt: t,
            updatedAt: t,
          }
          await db.recurrenceRules.add(newRule)
          next.recurrenceId = newRule.id
        }
      }
    }

    // ステータスとスケジュールは独立。ステータス変更時は完了日時と列内の並びだけ更新する
    let transitionedToDone = false
    if (issuePatch.statusId !== undefined && issuePatch.statusId !== current.statusId) {
      const project = await getProject(current.projectId)
      const workflow = project && (await getWorkflow(project.workflowId))
      const status = workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === issuePatch.statusId)
      if (!status) throw new Error('ステータスが見つかりません')
      const previousStatus = workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === current.statusId)
      transitionedToDone = status.category === 'done' && previousStatus?.category !== 'done'
      next.completedAt = status.category === 'done' ? t : null
      next.rank = await nextRankInStatus(current.projectId, status.id)
    }

    await db.issues.put(next)
    if (recurrencePatch !== undefined && next.sprintId && next.recurrenceId) {
      const sprint = await getSprint(next.sprintId)
      if (sprint) await expandRecurrenceInSprint(next, sprint, t)
    }
    if (transitionedToDone) await createNextOccurrence(next, t)
    return next
  })
}

/** 有効な繰り返しルールから次回の日付を計算し、同じ日のIssueがなければ未完了の次回分をバックログに作る。 */
async function createNextOccurrence(completed: Issue, timestamp: number): Promise<void> {
  if (!completed.recurrenceId) return
  const rule = await db.recurrenceRules.get(completed.recurrenceId)
  if (!rule?.active) return
  if (completed.sprintId) {
    const sprint = await getSprint(completed.sprintId)
    if (sprint) await expandRecurrenceInSprint(completed, sprint, timestamp)
  }
  const refreshed = completed.sprintId ? await db.issues.get(completed.id) : undefined
  const currentDate = refreshed?.date ?? completed.date ?? rule.startDate
  const nextDate =
    rule.frequency === 'weekly' && rule.weekdays?.length
      ? nextWeeklyRecurrenceDate(currentDate, rule.weekdays, rule.interval, rule.startDate)
      : nextRecurrenceDate(currentDate, rule.frequency, rule.interval)
  if (rule.endDate && nextDate > rule.endDate) return

  const alreadyExists = await db.issues
    .where('recurrenceId')
    .equals(rule.id)
    .filter(/* 未削除・指定日と一致という条件を満たす要素だけを残す。 */ (issue) => issue.deletedAt === null && issue.date === nextDate)
    .first()
  if (alreadyExists) return

  const project = await getProject(completed.projectId)
  const workflow = project && await getWorkflow(project.workflowId)
  const todoStatus = workflow?.statuses.find(/* 未着手カテゴリという条件を最初に満たす要素を探す。 */ (status) => status.category === 'todo')
  if (!project || !todoStatus) return

  const nextIssue: Issue = {
    ...completed,
    id: newId(),
    number: project.nextNumber,
    statusId: todoStatus.id,
    sprintId: null,
    rank: await nextRankInStatus(project.id, todoStatus.id),
    date: nextDate,
    dueDate: completed.dueDate === currentDate ? nextDate : completed.dueDate,
    completedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  }
  await db.issues.add(nextIssue)
  await db.projects.update(project.id, { nextNumber: project.nextNumber + 1, updatedAt: timestamp })
}

/** 指定した繰り返しルールを無効化し、以後の自動生成を止める。 */
export async function stopRecurrence(id: string): Promise<void> {
  await db.recurrenceRules.update(id, { active: false, updatedAt: now() })
}

/** 親Issueを上へたどり、同じプロジェクト内に存在していることと親子関係が循環しないことを確認する。 */
async function validateParent(projectId: string, parentId: string, issueId?: string): Promise<void> {
  const seen = new Set(issueId ? [issueId] : [])
  let parent = await getIssue(parentId)
  while (parent) {
    if (parent.projectId !== projectId) throw new Error('別のプロジェクトのIssueは親にできません')
    if (seen.has(parent.id)) throw new Error('親子関係が循環しています')
    seen.add(parent.id)
    if (!parent.parentId) return
    parent = await getIssue(parent.parentId)
  }
  throw new Error('親Issueが見つかりません')
}

// ステータス列 statusId の index 番目(自分自身を除く)へ移動する。スケジュール(date/startMin)には触れない。
// scopeSprintId を渡すと、そのスプリント(null はバックログ)のIssueだけを「見えている列」として index を解釈する
export async function moveIssue(
  id: string,
  statusId: string,
  index: number,
  scopeSprintId?: string | null,
): Promise<Issue> {
  return db.transaction('rw', db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const current = await getIssue(id)
    if (!current) throw new Error('Issueが見つかりません')
    const project = await getProject(current.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    const status = workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === statusId)
    if (!status) throw new Error('ステータスが見つかりません')
    const previousStatus = workflow?.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === current.statusId)

    const t = now()
    const others = activeInStatus(
      await db.issues.where('projectId').equals(current.projectId).toArray(),
      statusId,
    )
      .filter(/* 移動対象自身を除外し、スプリントの指定がある場合は同じ所属のIssueだけに絞る。 */ (i) => i.id !== id && (scopeSprintId === undefined || i.sprintId === scopeSprintId))
      .sort(compareRank)
    const at = Math.max(0, Math.min(index, others.length))

    let prev = at > 0 ? others[at - 1].rank : null
    let next = at < others.length ? others[at].rank : null
    if (prev !== null && next !== null && prev >= next) {
      const ranks = ranksForCount(others.length)
      await Promise.all(
        others.map(/* 衝突を解消するため、各Issueへ新しい並び順キーと更新日時を保存する。 */ (o, i) => db.issues.update(o.id, { rank: ranks[i], updatedAt: t })),
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
    if (status.category === 'done' && previousStatus?.category !== 'done') await createNextOccurrence(moved, t)
    return moved
  })
}

/** 次回分の生成を確認したうえで、対象Issueとその子孫すべてに削除日時を設定して一覧から除外する。 */
export async function deleteIssue(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.workflows, db.issues, db.sprints, db.recurrenceRules, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const t = now()
    const current = await getIssue(id)
    if (current) await createNextOccurrence(current, t)
    const toDelete = new Set<string>([id])
    // サブタスク/Epic配下を再帰的に論理削除する
    let frontier = [id]
    while (frontier.length > 0) {
      const children = await db.issues
        .where('parentId')
        .anyOf(frontier)
        .filter(/* 未削除かつまだ削除対象へ追加していない子Issueだけを取り出す。 */ (i) => i.deletedAt === null && !toDelete.has(i.id))
        .toArray()
      frontier = children.map(/* 各要素からIDだけを取り出す。 */ (c) => c.id)
      frontier.forEach(/* 削除対象の子IssueのIDを集合へ追加し、子孫の削除対象を広げる。 */ (c) => toDelete.add(c))
    }
    await db.issues
      .where('id')
      .anyOf([...toDelete])
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
      .modify({ deletedAt: t, updatedAt: t })
  })
}
