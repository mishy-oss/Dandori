import { differenceInCalendarDays, parseISO } from 'date-fns'
import { db } from './db'
import { addDaysStr, isValidDateStr, todayStr } from '../lib/date'
import { newId, now } from '../lib/id'
import { getProject, getWorkflow } from './projectRepo'
import { expandRecurrenceInSprint } from './recurrenceRepo'
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

/** 指定プロジェクトの未削除スプリントを、開始日と作成日時の順に並べて返す。 */
export async function listSprints(projectId: string): Promise<Sprint[]> {
  const all = await db.sprints.where('projectId').equals(projectId).toArray()
  return all
    .filter(/* 未削除という条件を満たす要素だけを残す。 */ (s) => s.deletedAt === null)
    .sort(/* 開始日の早い順に比較し、同日なら作成日時で順序を決める。 */ (a, b) => (a.startDate === b.startDate ? a.createdAt - b.createdAt : a.startDate < b.startDate ? -1 : 1))
}

/** IDでスプリントを取得し、存在しない場合や論理削除済みの場合はundefinedを返す。 */
export async function getSprint(id: string): Promise<Sprint | undefined> {
  const s = await db.sprints.get(id)
  return s && s.deletedAt === null ? s : undefined
}

/** 開始日と終了日が有効な日付で、終了日が開始日以降であることを確認する。 */
function validatePeriod(startDate: string, endDate: string) {
  if (!isValidDateStr(startDate) || !isValidDateStr(endDate)) {
    throw new Error('日付を正しく入力してください')
  }
  if (endDate < startDate) throw new Error('終了日は開始日以降にしてください')
}

/** 省略された期間や名前を補い、計画中のスプリントを保存する。期間の既定値は開始日を含めて14日間。 */
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

/** 所属プロジェクトの存在を確認し、入力内容に基づくスプリントをトランザクション内で作成する。 */
export async function createSprint(
  projectId: string,
  input: SprintInput = {},
  today: string = todayStr(),
): Promise<Sprint> {
  return db.transaction('rw', db.projects, db.sprints, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    if (!(await getProject(projectId))) throw new Error('プロジェクトが見つかりません')
    return insertSprint(projectId, input, today)
  })
}

/** 完了済みスプリントの編集を防ぎ、名前と期間を検証して指定された項目を保存する。 */
export async function updateSprint(
  id: string,
  patch: Pick<SprintInput, 'name' | 'goal' | 'startDate' | 'endDate'>,
): Promise<Sprint> {
  return db.transaction('rw', db.sprints, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
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
  await db.transaction('rw', db.sprints, db.issues, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const s = await getSprint(id)
    if (!s) return
    if (s.state !== 'planned') throw new Error('計画中のスプリントのみ削除できます')
    const t = now()
    await db.issues
      .where('sprintId')
      .equals(id)
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
      .modify({ sprintId: null, updatedAt: t })
    await db.sprints.update(id, { deletedAt: t, updatedAt: t })
  })
}

/** 計画中でIssueがあり、別のアクティブスプリントがないことを確認して開始する。 */
export async function startSprint(id: string): Promise<Sprint> {
  return db.transaction('rw', db.sprints, db.issues, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const s = await getSprint(id)
    if (!s) throw new Error('スプリントが見つかりません')
    if (s.state !== 'planned') throw new Error('計画中のスプリントのみ開始できます')

    const others = await listSprints(s.projectId)
    if (others.some(/* アクティブ状態という条件を満たす要素が1つでもあるかを判定する。 */ (o) => o.state === 'active')) {
      throw new Error('アクティブなスプリントが既にあります。先に完了してください')
    }
    const count = await db.issues
      .where('sprintId')
      .equals(id)
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
      .count()
    if (count === 0) throw new Error('バックログからIssueを追加してから開始してください')

    const next: Sprint = { ...s, state: 'active', updatedAt: now() }
    await db.sprints.put(next)
    return next
  })
}

/** スプリント内の末端の作業Issueから、全体と未完了分の見積時間・件数を集計する。Epicや子を持つ親は二重計上しない。 */
function makeSnapshot(sprint: Sprint, issues: Issue[], doneIds: Set<string>, date: string): SprintSnapshot {
  const sprintIssues = issues.filter(/* 未削除・指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === sprint.id && i.deletedAt === null)
  const parentsWithChildren = new Set(sprintIssues.flatMap(/* 子を持つ親IssueのIDを抜き出し、集計で親と子を二重に数えないようにする。 */ (i) => (i.parentId ? [i.parentId] : [])))
  // Epic and parent estimates are represented by their leaf work items to avoid double-counting.
  const workItems = sprintIssues.filter(/* Epic以外・子を持たない作業単位という条件を満たす要素だけを残す。 */ (i) => i.type !== 'epic' && !parentsWithChildren.has(i.id))
  const openItems = workItems.filter(/* 未完了という条件を満たす要素だけを残す。 */ (i) => !doneIds.has(i.statusId))
  return {
    date,
    totalMin: workItems.reduce(/* 見積時間を加算し、未設定の見積は0分として合計する。 */ (sum, i) => sum + (i.estimateMin ?? 0), 0),
    totalCount: workItems.length,
    remainingMin: openItems.reduce(/* 見積時間を加算し、未設定の見積は0分として合計する。 */ (sum, i) => sum + (i.estimateMin ?? 0), 0),
    remainingCount: openItems.length,
  }
}

/** 同じ日付の集計値を置き換え、スナップショットを日付順にしたスプリントを返す。 */
function withSnapshot(sprint: Sprint, snapshot: SprintSnapshot): Sprint {
  return {
    ...sprint,
    snapshots: [...sprint.snapshots.filter(/* 上書きするスナップショットと同じ日付の古い記録を除外する。 */ (s) => s.date !== snapshot.date), snapshot].sort(/* スナップショットの日付を比較し、古い日付から順に並べる。 */ (a, b) => a.date.localeCompare(b.date)),
    updatedAt: now(),
  }
}

/** Record or refresh today's actual remaining sprint scope. */
/** アクティブスプリントの指定日分の残作業を集計し、その日のスナップショットを保存または更新する。 */
export async function recordSprintSnapshot(id: string, date: string = todayStr()): Promise<Sprint | undefined> {
  return db.transaction('rw', db.projects, db.workflows, db.sprints, db.issues, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const sprint = await getSprint(id)
    if (!sprint || sprint.state !== 'active') return sprint
    const project = await getProject(sprint.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    if (!workflow) throw new Error('ワークフローが見つかりません')
    const issues = await db.issues.where('sprintId').equals(id).toArray()
    const doneIds = new Set(workflow.statuses.filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (status) => status.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (status) => status.id))
    const updated = withSnapshot(sprint, makeSnapshot(sprint, issues, doneIds, date))
    await db.sprints.put(updated)
    return updated
  })
}

/** 最終の集計を保存してスプリントを完了し、未完了Issueを指定先へ移す。新規スプリントが選ばれた場合は同じ長さの期間で作成する。 */
export async function completeSprint(
  id: string,
  incomplete: IncompleteIssuesAction,
  today: string = todayStr(),
): Promise<CompleteSprintResult> {
  return db.transaction('rw', db.projects, db.workflows, db.sprints, db.issues, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const s = await getSprint(id)
    if (!s) throw new Error('スプリントが見つかりません')
    if (s.state !== 'active') throw new Error('アクティブなスプリントのみ完了できます')

    const project = await getProject(s.projectId)
    const workflow = project && (await getWorkflow(project.workflowId))
    if (!workflow) throw new Error('ワークフローが見つかりません')
    const doneIds = new Set(workflow.statuses.filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (st) => st.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (st) => st.id))

    const issues = await db.issues
      .where('sprintId')
      .equals(id)
      .filter(/* 未削除という条件を満たす要素だけを残す。 */ (i) => i.deletedAt === null)
      .toArray()
    await db.sprints.put(withSnapshot(s, makeSnapshot(s, issues, doneIds, today)))
    const open: Issue[] = issues.filter(/* 未完了という条件を満たす要素だけを残す。 */ (i) => !doneIds.has(i.statusId))

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
        open.map(/* 一括更新するIssueのIDと変更項目を組み合わせる。 */ (i) => ({ key: i.id, changes: { sprintId: nextSprintId, updatedAt: t } })),
      )
    }

    await db.sprints.update(id, { state: 'closed', updatedAt: now() })
    return { doneCount: issues.length - open.length, movedCount: open.length, nextSprintId }
  })
}

// 完了済みスプリントへは移せない。null でバックログへ戻す
export async function assignIssueToSprint(issueId: string, sprintId: string | null): Promise<Issue> {
  return db.transaction('rw', db.projects, db.workflows, db.sprints, db.issues, db.recurrenceRules, /* 関連テーブルの確認と更新を一括で実行し、途中で失敗した場合は変更を巻き戻す。 */ async () => {
    const issue = await db.issues.get(issueId)
    if (!issue || issue.deletedAt !== null) throw new Error('Issueが見つかりません')
    if (sprintId !== null) {
      const s = await getSprint(sprintId)
      if (!s || s.projectId !== issue.projectId) throw new Error('スプリントが見つかりません')
      if (s.state === 'closed') throw new Error('完了したスプリントには追加できません')
    }
    const next: Issue = { ...issue, sprintId, updatedAt: now() }
    await db.issues.put(next)
    if (sprintId && next.recurrenceId) {
      const sprint = await getSprint(sprintId)
      if (sprint) await expandRecurrenceInSprint(next, sprint, next.updatedAt)
    }
    return next
  })
}
