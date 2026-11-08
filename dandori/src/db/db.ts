import Dexie, { type EntityTable } from 'dexie'
import { newId } from '../lib/id'
import type { Issue, Project, RecurrenceRule, Settings, Sprint, Workflow, MonthlySnapshot } from './types'

export class DandoriDB extends Dexie {
  projects!: EntityTable<Project, 'id'>
  workflows!: EntityTable<Workflow, 'id'>
  issues!: EntityTable<Issue, 'id'>
  recurrenceRules!: EntityTable<RecurrenceRule, 'id'>
  sprints!: EntityTable<Sprint, 'id'>
  settings!: EntityTable<Settings, 'id'>
  monthlySnapshots!: EntityTable<MonthlySnapshot, 'id'>

  /** IndexedDBを定義する。旧データを残し、月次実績の保存先と定期タスクの列を順次追加する。 */
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
    // 既存の列やタスクのIDを保ったまま、定期タスク用の列を一度だけ追加する。
    this.version(7).stores({}).upgrade(async (transaction) => {
      await transaction.table<Workflow>('workflows').toCollection().modify((workflow) => {
        if (workflow.deletedAt !== null || workflow.statuses.some((status) => status.category === 'routine')) return
        workflow.statuses.push({ id: newId(), name: '定期タスク', category: 'routine' })
        workflow.updatedAt = Date.now()
      })
    })
    // 追加済みの既定名を変更する。列のIDやユーザーが変更した名前は保つ。
    this.version(8).stores({}).upgrade(async (transaction) => {
      await transaction.table<Workflow>('workflows').toCollection().modify((workflow) => {
        let renamed = false
        for (const status of workflow.statuses) {
          if (status.category === 'routine' && status.name === '定期タスク') {
            status.name = 'recurring'
            renamed = true
          }
        }
        if (renamed) workflow.updatedAt = Date.now()
      })
    })
    // 保存済みの順序を統一し、ボードと編集画面の両方に同じ並びを反映する。
    this.version(9).stores({}).upgrade(async (transaction) => {
      await transaction.table<Workflow>('workflows').toCollection().modify((workflow) => {
        for (const status of workflow.statuses) {
          if (status.category === 'routine' && status.name === 'recurring') status.name = 'Recurring'
        }
        const order = { todo: 0, doing: 1, routine: 2, done: 3 }
        workflow.statuses.sort((a, b) => order[a.category] - order[b.category])
        workflow.updatedAt = Date.now()
      })
    })
  }
}

export const db = new DandoriDB()
