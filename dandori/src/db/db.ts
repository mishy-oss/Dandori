import Dexie, { type EntityTable } from 'dexie'
import type { Issue, Project, Settings, Sprint, Workflow } from './types'

export class DandoriDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  workflows!: EntityTable<Workflow, 'id'>
  issues!: EntityTable<Issue, 'id'>
  sprints!: EntityTable<Sprint, 'id'>
  settings!: EntityTable<Settings, 'id'>

  constructor(name = 'dandori') {
    super(name)
    this.version(1).stores({
      projects: 'id, key, updatedAt, deletedAt',
      workflows: 'id, updatedAt, deletedAt',
      issues:
        'id, projectId, statusId, sprintId, parentId, date, rank, updatedAt, deletedAt, [projectId+number]',
    })
    this.version(2).stores({
      sprints: 'id, projectId, state, updatedAt, deletedAt',
    })
    this.version(3).stores({
      settings: 'id',
    })
  }
}

export const db = new DandoriDB()
