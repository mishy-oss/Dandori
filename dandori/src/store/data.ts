import { create } from 'zustand'
import * as issueRepo from '../db/issueRepo'
import * as projectRepo from '../db/projectRepo'
import * as settingsRepo from '../db/settingsRepo'
import { prepareMonthlyProject, listMonthlySnapshots } from '../db/monthlyRepo'
import { currentMonth, isValidMonth } from '../lib/month'
import type { MonthlySnapshot } from '../db/types'
import { DEFAULT_SETTINGS, type Issue, type Project, type RecurrenceRule, type Settings, type Workflow } from '../db/types'

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
  selectedMonth: string
  monthlySnapshots: MonthlySnapshot[]
  selectMonth: (month: string) => Promise<void>
  refreshPlanning: () => Promise<void>
  assignIssueToMonth: (issueId: string, month: string) => Promise<void>

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
    scopeMonth?: string,
  ) => Promise<void>
  deleteIssue: (id: string) => Promise<void>
  stopRecurrence: (id: string) => Promise<void>

}

export const useDataStore = create<DataState>(/* データ一覧と保存操作を持つZustandストアを構築し、DB更新後に最新データへ同期できるようにする。 */ (set, get) => {
  /** 月別予定の準備・繰り越し・実績記録を行い、現在のプロジェクトの保存済みデータを画面へ反映する。 */
  async function reload() {
    const projects = await projectRepo.listProjects()
    const current = projects[0] ?? null
    if (current) await prepareMonthlyProject(current.id, get().selectedMonth)
    const workflows: Record<string, Workflow> = {}
    for (const p of projects) {
      const w = await projectRepo.getWorkflow(p.workflowId)
      if (w) workflows[w.id] = w
    }
    const issues = current ? await issueRepo.listIssues(current.id) : []
    const recurrenceRules = current ? await issueRepo.listRecurrenceRules(current.id) : []
    const monthlySnapshots = current ? await listMonthlySnapshots(current.id) : []
    const settings = await settingsRepo.getSettings()
    set({
      ready: true,
      settings,
      projects,
      workflows,
      currentProjectId: current?.id ?? null,
      issues,
      recurrenceRules,
      monthlySnapshots,
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
    selectedMonth: currentMonth(),
    monthlySnapshots: [],
    /** 選択月を切り替え、その月の繰り返し予定を準備して一覧を再取得する。 */
    selectMonth: async (month) => {
      if (!isValidMonth(month)) throw new Error('対象月を正しく指定してください')
      set({ selectedMonth: month })
      await reload()
    },
    /** 日付変更や画面復帰時に繰り越しと日次実績を更新する。 */
    refreshPlanning: reload,
    /** 対象月を変更する。別の月の時刻配置は解除し、旧スプリントの所属は使わない。 */
    assignIssueToMonth: async (id, month) => {
      const issue = await issueRepo.getIssue(id)
      if (!issue) throw new Error('Issueが見つかりません')
      await issueRepo.updateIssue(id, { planningMonth: month, sprintId: null, ...(issue.date && issue.date.slice(0, 7) !== month ? { date: null, startMin: null } : {}) })
      await reload()
    },

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
      const target = workflow.statuses.find(/* 定期タスクの完了解除は専用列へ戻し、それ以外は未着手へ戻す。 */ (s) => s.category === (isDone ? (issue.isRoutine ? 'routine' : 'todo') : 'done'))
      if (!target) return
      await issueRepo.updateIssue(id, { statusId: target.id })
      await reload()
    },
    /** 対象月を補ってタスクを作成し、月内の繰り返し予定と最新の月次実績を画面へ反映する。 */
    createIssue: async (input) => {
      const issue = await issueRepo.createIssue({ ...input, planningMonth: input.planningMonth ?? input.date?.slice(0, 7) ?? input.dueDate?.slice(0, 7) ?? get().selectedMonth, projectId: requireProjectId() })
      await reload()
      return issue
    },
    /** Issueの変更内容を検証して保存する。完了日時・列内順位・繰り返しルールを更新し、必要なら次回分を生成する。 保存後にデータを読み直して画面へ反映する。 */
    updateIssue: async (id, patch) => {
      await issueRepo.updateIssue(id, patch)
      await reload()
    },
    /** 指定月のステータス列内で並び順を保存し、保存後のタスクと月次実績を読み直す。 */
    moveIssue: async (id, statusId, index, scopeMonth) => {
      try {
        await issueRepo.moveIssue(id, statusId, index, undefined, scopeMonth ?? get().selectedMonth)
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

  }
})

/** 現在のプロジェクトIDに一致するプロジェクトを返し、なければnullを返す。 */
export function selectCurrentProject(s: DataState): Project | null {
  return s.projects.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (p) => p.id === s.currentProjectId) ?? null
}

