import { create } from 'zustand'
import * as issueRepo from '../db/issueRepo'
import * as projectRepo from '../db/projectRepo'
import * as settingsRepo from '../db/settingsRepo'
import * as sprintRepo from '../db/sprintRepo'
import { DEFAULT_SETTINGS, type Issue, type Project, type RecurrenceRule, type Settings, type Sprint, type Workflow } from '../db/types'
import { applyMove } from '../lib/issueOrder'

export interface ScheduleChange {
  date: string | null
  startMin: number | null
  durationMin?: number
}

interface DataState {
  ready: boolean
  settings: Settings
  projects: Project[]
  workflows: Record<string, Workflow>
  currentProjectId: string | null
  issues: Issue[]
  recurrenceRules: RecurrenceRule[]
  sprints: Sprint[]

  init: () => Promise<void>
  updateSettings: (patch: Partial<Omit<Settings, 'id'>>) => Promise<void>
  scheduleIssue: (id: string, change: ScheduleChange) => Promise<void>
  toggleIssueDone: (id: string) => Promise<void>
  createIssue: (input: Omit<issueRepo.CreateIssueInput, 'projectId'>) => Promise<Issue>
  updateIssue: (id: string, patch: issueRepo.IssuePatch) => Promise<void>
  moveIssue: (
    id: string,
    statusId: string,
    index: number,
    scopeSprintId?: string | null,
  ) => Promise<void>
  deleteIssue: (id: string) => Promise<void>
  stopRecurrence: (id: string) => Promise<void>
  createSprint: (input?: sprintRepo.SprintInput) => Promise<Sprint>
  updateSprint: (id: string, patch: Parameters<typeof sprintRepo.updateSprint>[1]) => Promise<void>
  deleteSprint: (id: string) => Promise<void>
  startSprint: (id: string) => Promise<void>
  completeSprint: (
    id: string,
    incomplete: sprintRepo.IncompleteIssuesAction,
  ) => Promise<sprintRepo.CompleteSprintResult>
  assignIssueToSprint: (issueId: string, sprintId: string | null) => Promise<void>
}

export const useDataStore = create<DataState>(/* データ一覧と保存操作を持つZustandストアを構築し、DB更新後に最新データへ同期できるようにする。 */ (set, get) => {
  // プロジェクトは内部的に1つだけ(UIには出さない)。複数ある旧データは最初の1つを使う
  async function reload() {
    const projects = await projectRepo.listProjects()
    const current = projects[0] ?? null
    const workflows: Record<string, Workflow> = {}
    for (const p of projects) {
      const w = await projectRepo.getWorkflow(p.workflowId)
      if (w) workflows[w.id] = w
    }
    const issues = current ? await issueRepo.listIssues(current.id) : []
    const recurrenceRules = current ? await issueRepo.listRecurrenceRules(current.id) : []
    let sprints = current ? await sprintRepo.listSprints(current.id) : []
    const activeSprint = sprints.find(/* アクティブ状態という条件を最初に満たす要素を探す。 */ (s) => s.state === 'active')
    if (activeSprint) {
      await sprintRepo.recordSprintSnapshot(activeSprint.id)
      sprints = await sprintRepo.listSprints(activeSprint.projectId)
    }
    const settings = await settingsRepo.getSettings()
    set({
      ready: true,
      settings,
      projects,
      workflows,
      currentProjectId: current?.id ?? null,
      issues,
      recurrenceRules,
      sprints,
    })
  }

  /** ストアから現在のプロジェクトIDを取得し、初期化前なら処理を続けずエラーにする。 */
  function requireProjectId(): string {
    const id = get().currentProjectId
    if (!id) throw new Error('データの初期化が完了していません')
    return id
  }

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    projects: [],
    workflows: {},
    currentProjectId: null,
    issues: [],
    recurrenceRules: [],
    sprints: [],

    /** 端末への永続保存を要求し、既定プロジェクトを準備して全データを読み込む。 */
    init: async () => {
      // 端末のストレージ削除対策。拒否されても動作に影響はない
      void navigator.storage?.persist?.()
      await projectRepo.ensureDefaultProject()
      await reload()
    },
    /** 表示時間帯・既定の所要時間・週の開始曜日を検証し、設定を保存して返す。 保存後にデータを読み直して画面へ反映する。 */
    updateSettings: async (patch) => {
      await settingsRepo.updateSettings(patch)
      await reload()
    },
    /** 配置や所要時間を先に画面へ反映してからDBに保存し、成功・失敗のどちらでも保存済みデータを読み直す。 */
    scheduleIssue: async (id, change) => {
      // ドロップ直後に元の位置へ戻って見えないよう、保存前に画面だけ先に更新する
      set({
        issues: get().issues.map(/* 対象Issueだけ日付・開始時刻・所要時間を先に更新し、他のIssueはそのまま返す。 */ (i) =>
          i.id === id
            ? {
                ...i,
                date: change.date,
                startMin: change.startMin,
                durationMin: change.durationMin ?? i.durationMin,
              }
            : i,
        ),
      })
      try {
        await issueRepo.updateIssue(id, {
          date: change.date,
          startMin: change.startMin,
          ...(change.durationMin !== undefined && { durationMin: change.durationMin }),
        })
      } finally {
        await reload()
      }
    },
    // タイムライン上で完了にしたら done カテゴリへ、戻したら最初の todo カテゴリへ移す
    toggleIssueDone: async (id) => {
      const { issues, projects, workflows } = get()
      const issue = issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (i) => i.id === id)
      const project = issue && projects.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (p) => p.id === issue.projectId)
      const workflow = project && workflows[project.workflowId]
      if (!issue || !workflow) return
      const isDone =
        workflow.statuses.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (s) => s.id === issue.statusId)?.category === 'done'
      const target = workflow.statuses.find(/* 現在が完了なら未着手、未完了なら完了カテゴリのステータスを探す。 */ (s) => s.category === (isDone ? 'todo' : 'done'))
      if (!target) return
      await issueRepo.updateIssue(id, { statusId: target.id })
      await reload()
    },
    /** 入力と所属先を検証してIssueを採番・保存する。繰り返し設定がありスプリントに所属する場合は期間内の予定も生成する。 保存後にデータを読み直して画面へ反映する。 */
    createIssue: async (input) => {
      const issue = await issueRepo.createIssue({ ...input, projectId: requireProjectId() })
      await reload()
      return issue
    },
    /** Issueの変更内容を検証して保存する。完了日時・列内順位・繰り返しルールを更新し、必要なら次回分を生成する。 保存後にデータを読み直して画面へ反映する。 */
    updateIssue: async (id, patch) => {
      await issueRepo.updateIssue(id, patch)
      await reload()
    },
    /** 指定した列内の位置にIssueを移し、隣接Issueの間に入る並び順キーを保存する。完了状態への移動時は次回分の生成も行う。 保存後にデータを読み直して画面へ反映する。 */
    moveIssue: async (id, statusId, index, scopeSprintId) => {
      // ドロップ直後に元の位置へ戻って見えないよう、保存前に画面だけ先に更新する
      set({ issues: applyMove(get().issues, id, statusId, index, scopeSprintId) })
      try {
        await issueRepo.moveIssue(id, statusId, index, scopeSprintId)
      } finally {
        await reload()
      }
    },
    /** 次回分の生成を確認したうえで、対象Issueとその子孫すべてに削除日時を設定して一覧から除外する。 保存後にデータを読み直して画面へ反映する。 */
    deleteIssue: async (id) => {
      await issueRepo.deleteIssue(id)
      await reload()
    },
    /** 指定した繰り返しルールを無効化し、以後の自動生成を止める。 保存後にデータを読み直して画面へ反映する。 */
    stopRecurrence: async (id) => {
      await issueRepo.stopRecurrence(id)
      await reload()
    },
    /** 所属プロジェクトの存在を確認し、入力内容に基づくスプリントをトランザクション内で作成する。 保存後にデータを読み直して画面へ反映する。 */
    createSprint: async (input) => {
      const s = await sprintRepo.createSprint(requireProjectId(), input)
      await reload()
      return s
    },
    /** 完了済みスプリントの編集を防ぎ、名前と期間を検証して指定された項目を保存する。 保存後にデータを読み直して画面へ反映する。 */
    updateSprint: async (id, patch) => {
      await sprintRepo.updateSprint(id, patch)
      await reload()
    },
    /** 計画中のスプリントにあるIssueをバックログへ戻し、スプリントを論理削除する。 保存後にデータを読み直して画面へ反映する。 */
    deleteSprint: async (id) => {
      await sprintRepo.deleteSprint(id)
      await reload()
    },
    /** 計画中でIssueがあり、別のアクティブスプリントがないことを確認して開始する。 保存後にデータを読み直して画面へ反映する。 */
    startSprint: async (id) => {
      await sprintRepo.startSprint(id)
      await reload()
    },
    /** 最終の集計を保存してスプリントを完了し、未完了Issueを指定先へ移す。新規スプリントが選ばれた場合は同じ長さの期間で作成する。 保存後にデータを読み直して画面へ反映する。 */
    completeSprint: async (id, incomplete) => {
      const result = await sprintRepo.completeSprint(id, incomplete)
      await reload()
      return result
    },
    /** 移動先の所属と状態を確認してIssueをスプリントまたはバックログに移す。繰り返しIssueなら移動先期間内の予定も展開する。 保存後にデータを読み直して画面へ反映する。 */
    assignIssueToSprint: async (issueId, sprintId) => {
      await sprintRepo.assignIssueToSprint(issueId, sprintId)
      await reload()
    },
  }
})

/** 現在のプロジェクトIDに一致するプロジェクトを返し、なければnullを返す。 */
export function selectCurrentProject(s: DataState): Project | null {
  return s.projects.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (p) => p.id === s.currentProjectId) ?? null
}

/** アクティブ状態のスプリントを1つ取り出し、見つからなければnullを返す。 */
export function selectActiveSprint(s: DataState): Sprint | null {
  return s.sprints.find(/* アクティブ状態という条件を最初に満たす要素を探す。 */ (sp) => sp.state === 'active') ?? null
}
