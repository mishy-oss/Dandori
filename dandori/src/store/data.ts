import { create } from 'zustand'
import * as issueRepo from '../db/issueRepo'
import * as projectRepo from '../db/projectRepo'
import * as settingsRepo from '../db/settingsRepo'
import { carryoverIssue, type CarryoverInput } from '../db/carryoverRepo'
import { editRecurringIssue, type RecurringEditScope } from '../db/recurringEditRepo'
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
  updateIssue: (id: string, patch: issueRepo.IssuePatch, scope?: RecurringEditScope) => Promise<void>
  moveIssue: (
    id: string,
    statusId: string,
    index: number,
    scopeMonth?: string,
  ) => Promise<void>
  deleteIssue: (id: string) => Promise<void>
  stopRecurrence: (id: string) => Promise<void>
  carryoverIssue: (id: string, input: CarryoverInput) => Promise<Issue>

}

export const useDataStore = create<DataState>((set, get) => {
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
    selectMonth: async (month) => {
      if (!isValidMonth(month)) throw new Error('対象月を正しく指定してください')
      set({ selectedMonth: month })
      await reload()
    },
    refreshPlanning: reload,
    assignIssueToMonth: async (id, month) => {
      const issue = await issueRepo.getIssue(id)
      if (!issue) throw new Error('Issueが見つかりません')
      await issueRepo.updateIssue(id, { planningMonth: month, sprintId: null, ...(issue.date && issue.date.slice(0, 7) !== month ? { date: null, startMin: null } : {}) })
      await reload()
    },

    init: async () => {
      // 端末のストレージ削除対策。拒否されても動作に影響はない
      void navigator.storage?.persist?.()
      await projectRepo.ensureDefaultProject()
      await reload()
    },
    updateSettings: async (patch) => {
      await settingsRepo.updateSettings(patch)
      await reload()
    },
    scheduleIssue: async (id, change) => {
      // ドロップ直後に元の位置へ戻って見えないよう、保存前に画面だけ先に更新する
      set({
        issues: get().issues.map((i) =>
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
    toggleIssueDone: async (id) => {
      const { issues, projects, workflows } = get()
      const issue = issues.find((i) => i.id === id)
      const project = issue && projects.find((p) => p.id === issue.projectId)
      const workflow = project && workflows[project.workflowId]
      if (!issue || !workflow) return
      const isDone =
        workflow.statuses.find((s) => s.id === issue.statusId)?.category === 'done'
      const target = workflow.statuses.find((s) => s.category === (isDone ? (issue.isRoutine ? 'routine' : 'todo') : 'done'))
      if (!target) return
      await issueRepo.updateIssue(id, { statusId: target.id })
      await reload()
    },
    createIssue: async (input) => {
      const issue = await issueRepo.createIssue({ ...input, planningMonth: input.planningMonth ?? input.date?.slice(0, 7) ?? input.dueDate?.slice(0, 7) ?? get().selectedMonth, projectId: requireProjectId() })
      await reload()
      return issue
    },
    updateIssue: async (id, patch, scope) => {
      if (scope) await editRecurringIssue(id, patch, scope)
      else await issueRepo.updateIssue(id, patch)
      await reload()
    },
    moveIssue: async (id, statusId, index, scopeMonth) => {
      try {
        await issueRepo.moveIssue(id, statusId, index, undefined, scopeMonth ?? get().selectedMonth)
      } finally {
        await reload()
      }
    },
    deleteIssue: async (id) => {
      await issueRepo.deleteIssue(id)
      await reload()
    },
    stopRecurrence: async (id) => {
      await issueRepo.stopRecurrence(id)
      await reload()
    },
    carryoverIssue: async (id, input) => {
      const result = await carryoverIssue(id, input)
      await reload()
      return result
    },

  }
})

export function selectCurrentProject(s: DataState): Project | null {
  return s.projects.find((p) => p.id === s.currentProjectId) ?? null
}

