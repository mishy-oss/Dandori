import { create } from 'zustand'
import * as issueRepo from '../db/issueRepo'
import * as projectRepo from '../db/projectRepo'
import * as settingsRepo from '../db/settingsRepo'
import * as sprintRepo from '../db/sprintRepo'
import { DEFAULT_SETTINGS, type Issue, type Project, type Settings, type Sprint, type Workflow } from '../db/types'
import { applyMove } from '../lib/issueOrder'

const CURRENT_PROJECT_KEY = 'dandori:currentProject'

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
  sprints: Sprint[]

  init: () => Promise<void>
  updateSettings: (patch: Partial<Omit<Settings, 'id'>>) => Promise<void>
  scheduleIssue: (id: string, change: ScheduleChange) => Promise<void>
  toggleIssueDone: (id: string) => Promise<void>
  selectProject: (id: string) => Promise<void>
  createProject: (input: projectRepo.CreateProjectInput) => Promise<void>
  updateProject: (
    id: string,
    patch: Parameters<typeof projectRepo.updateProject>[1],
  ) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  createIssue: (input: Omit<issueRepo.CreateIssueInput, 'projectId'>) => Promise<Issue>
  updateIssue: (id: string, patch: issueRepo.IssuePatch) => Promise<void>
  moveIssue: (
    id: string,
    statusId: string,
    index: number,
    scopeSprintId?: string | null,
  ) => Promise<void>
  deleteIssue: (id: string) => Promise<void>
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

function readCurrent(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY)
  } catch {
    return null
  }
}

function writeCurrent(id: string | null) {
  try {
    if (id) localStorage.setItem(CURRENT_PROJECT_KEY, id)
    else localStorage.removeItem(CURRENT_PROJECT_KEY)
  } catch {
    // 保存できなくても動作は継続する
  }
}

export const useDataStore = create<DataState>((set, get) => {
  async function reload(preferredProjectId?: string | null) {
    const projects = await projectRepo.listProjects()
    const wanted = preferredProjectId ?? get().currentProjectId
    const current = projects.find((p) => p.id === wanted) ?? projects[0] ?? null
    const workflows: Record<string, Workflow> = {}
    for (const p of projects) {
      const w = await projectRepo.getWorkflow(p.workflowId)
      if (w) workflows[w.id] = w
    }
    const issues = current ? await issueRepo.listIssues(current.id) : []
    const sprints = current ? await sprintRepo.listSprints(current.id) : []
    const settings = await settingsRepo.getSettings()
    writeCurrent(current?.id ?? null)
    set({
      ready: true,
      settings,
      projects,
      workflows,
      currentProjectId: current?.id ?? null,
      issues,
      sprints,
    })
  }

  function requireProjectId(): string {
    const id = get().currentProjectId
    if (!id) throw new Error('プロジェクトを作成してください')
    return id
  }

  return {
    ready: false,
    settings: DEFAULT_SETTINGS,
    projects: [],
    workflows: {},
    currentProjectId: null,
    issues: [],
    sprints: [],

    init: async () => {
      // 端末のストレージ削除対策。拒否されても動作に影響はない
      void navigator.storage?.persist?.()
      await reload(readCurrent())
    },
    selectProject: (id) => reload(id),
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
    // タイムライン上で完了にしたら done カテゴリへ、戻したら最初の todo カテゴリへ移す
    toggleIssueDone: async (id) => {
      const { issues, projects, workflows } = get()
      const issue = issues.find((i) => i.id === id)
      const project = issue && projects.find((p) => p.id === issue.projectId)
      const workflow = project && workflows[project.workflowId]
      if (!issue || !workflow) return
      const isDone =
        workflow.statuses.find((s) => s.id === issue.statusId)?.category === 'done'
      const target = workflow.statuses.find((s) => s.category === (isDone ? 'todo' : 'done'))
      if (!target) return
      await issueRepo.updateIssue(id, { statusId: target.id })
      await reload()
    },
    createProject: async (input) => {
      const p = await projectRepo.createProject(input)
      await reload(p.id)
    },
    updateProject: async (id, patch) => {
      await projectRepo.updateProject(id, patch)
      await reload()
    },
    deleteProject: async (id) => {
      await projectRepo.deleteProject(id)
      await reload()
    },
    createIssue: async (input) => {
      const issue = await issueRepo.createIssue({ ...input, projectId: requireProjectId() })
      await reload()
      return issue
    },
    updateIssue: async (id, patch) => {
      await issueRepo.updateIssue(id, patch)
      await reload()
    },
    moveIssue: async (id, statusId, index, scopeSprintId) => {
      // ドロップ直後に元の位置へ戻って見えないよう、保存前に画面だけ先に更新する
      set({ issues: applyMove(get().issues, id, statusId, index, scopeSprintId) })
      try {
        await issueRepo.moveIssue(id, statusId, index, scopeSprintId)
      } finally {
        await reload()
      }
    },
    deleteIssue: async (id) => {
      await issueRepo.deleteIssue(id)
      await reload()
    },
    createSprint: async (input) => {
      const s = await sprintRepo.createSprint(requireProjectId(), input)
      await reload()
      return s
    },
    updateSprint: async (id, patch) => {
      await sprintRepo.updateSprint(id, patch)
      await reload()
    },
    deleteSprint: async (id) => {
      await sprintRepo.deleteSprint(id)
      await reload()
    },
    startSprint: async (id) => {
      await sprintRepo.startSprint(id)
      await reload()
    },
    completeSprint: async (id, incomplete) => {
      const result = await sprintRepo.completeSprint(id, incomplete)
      await reload()
      return result
    },
    assignIssueToSprint: async (issueId, sprintId) => {
      await sprintRepo.assignIssueToSprint(issueId, sprintId)
      await reload()
    },
  }
})

export function selectCurrentProject(s: DataState): Project | null {
  return s.projects.find((p) => p.id === s.currentProjectId) ?? null
}

export function selectActiveSprint(s: DataState): Sprint | null {
  return s.sprints.find((sp) => sp.state === 'active') ?? null
}
