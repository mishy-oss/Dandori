import Dexie, { type EntityTable } from 'dexie'
import type { Issue, Project, Sprint, Workflow } from './types'

export class DandoriDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  workflows!: EntityTable<Workflow, 'id'>
  issues!: EntityTable<Issue, 'id'>
  sprints!: EntityTable<Sprint, 'id'>

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
  }
}

export const db = new DandoriDB()
