import Dexie, { type EntityTable } from 'dexie'
import type { Issue, Project, RecurrenceRule, Settings, Sprint, Workflow, MonthlySnapshot } from './types'

export class DandoriDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  workflows!: EntityTable<Workflow, 'id'>
  issues!: EntityTable<Issue, 'id'>
  recurrenceRules!: EntityTable<RecurrenceRule, 'id'>
  sprints!: EntityTable<Sprint, 'id'>
  settings!: EntityTable<Settings, 'id'>
  monthlySnapshots!: EntityTable<MonthlySnapshot, 'id'>

  /** IndexedDBのテーブルと検索インデックスを定義する。旧データを残し、バージョン6で月次実績の保存先を追加する。 */
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
    this.version(4).stores({
      recurrenceRules: 'id, projectId, active, startDate',
    })
    this.version(5).stores({
      issues:
        'id, projectId, statusId, sprintId, parentId, date, rank, updatedAt, deletedAt, recurrenceId, [projectId+number]',
    })
    this.version(6).stores({
      monthlySnapshots: 'id, projectId, month, date, [projectId+month]',
    })
  }
}

export const db = new DandoriDB()
