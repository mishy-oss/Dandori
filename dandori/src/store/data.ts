import { create } from 'zustand'
import * as issueRepo from '../db/issueRepo'
import * as projectRepo from '../db/projectRepo'
import type { Issue, Project, Workflow } from '../db/types'
import { applyMove } from '../lib/issueOrder'

const CURRENT_PROJECT_KEY = 'dandori:currentProject'

interface DataState {
  ready: boolean
  projects: Project[]
  workflows: Record<string, Workflow>
  currentProjectId: string | null
  issues: Issue[]

  init: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  createProject: (input: projectRepo.CreateProjectInput) => Promise<void>
  updateProject: (
    id: string,
    patch: Parameters<typeof projectRepo.updateProject>[1],
  ) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  createIssue: (input: Omit<issueRepo.CreateIssueInput, 'projectId'>) => Promise<Issue>
  updateIssue: (id: string, patch: issueRepo.IssuePatch) => Promise<void>
  moveIssue: (id: string, statusId: string, index: number) => Promise<void>
  deleteIssue: (id: string) => Promise<void>
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
    writeCurrent(current?.id ?? null)
    set({ ready: true, projects, workflows, currentProjectId: current?.id ?? null, issues })
  }

  function requireProjectId(): string {
    const id = get().currentProjectId
    if (!id) throw new Error('プロジェクトを作成してください')
    return id
  }

  return {
    ready: false,
    projects: [],
    workflows: {},
    currentProjectId: null,
    issues: [],

    init: async () => {
      // 端末のストレージ削除対策。拒否されても動作に影響はない
      void navigator.storage?.persist?.()
      await reload(readCurrent())
    },
    selectProject: (id) => reload(id),
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
    moveIssue: async (id, statusId, index) => {
      // ドロップ直後に元の位置へ戻って見えないよう、保存前に画面だけ先に更新する
      set({ issues: applyMove(get().issues, id, statusId, index) })
      try {
        await issueRepo.moveIssue(id, statusId, index)
      } finally {
        await reload()
      }
    },
    deleteIssue: async (id) => {
      await issueRepo.deleteIssue(id)
      await reload()
    },
  }
})

export function selectCurrentProject(s: DataState): Project | null {
  return s.projects.find((p) => p.id === s.currentProjectId) ?? null
}
