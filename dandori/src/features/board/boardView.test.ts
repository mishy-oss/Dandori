import { expect, it } from 'vitest'
import type { Issue } from '../../db/types'
import { EMPTY_FILTER } from '../backlog/filters'
import { selectBoardGroups, statusMoveScope } from './boardView'
import { groupedDropIndex } from './recurringGroups'

const doneIds = new Set(['done'])
function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, title: id, type: 'task', priority: 'medium', statusId: 'todo',
    parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: '2027-01', rank: id,
    date: '2027-01-01', startMin: null, durationMin: 30, icon: '', color: '#38bdf8', reminderOffsetMin: null,
    recurrenceId: null, assigneeId: null, completedAt: null, createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

it('searches later and completed occurrences without losing the full monthly progress or representative', () => {
  const issues = [
    task('a', { recurrenceId: 'daily', title: '完了した確認', statusId: 'done' }),
    task('b', { recurrenceId: 'daily', title: '次の確認', date: '2027-01-02', statusId: 'doing' }),
    task('c', { recurrenceId: 'daily', number: 12, title: '後の確認', labels: ['Auth'], date: '2027-01-03' }),
    task('single'),
  ]
  for (const query of ['#12', 'AUTH', '完了した確認']) {
    const groups = selectBoardGroups(issues, doneIds, '2027-01', false, { ...EMPTY_FILTER, query })
    expect(groups).toHaveLength(1)
    expect(groups[0].issue.id).toBe('b')
    expect(groups[0].occurrences.map(issue => issue.id)).toEqual(['a', 'b', 'c'])
    expect(groups[0].occurrences.filter(issue => doneIds.has(issue.statusId))).toHaveLength(1)
  }
})

it('combines search, priority and type on the same occurrence', () => {
  const issues = [task('a', { recurrenceId: 'daily', title: '検索語', priority: 'high' }), task('b', { recurrenceId: 'daily', type: 'bug', priority: 'urgent' })]
  expect(selectBoardGroups(issues, doneIds, '2027-01', false, { query: '検索語', priority: 'urgent', type: 'bug' })).toEqual([])
  expect(selectBoardGroups(issues, doneIds, '2027-01', false, { query: '検索語', priority: 'high', type: 'task' })[0].occurrences).toHaveLength(2)
  expect(selectBoardGroups(issues, doneIds, '2027-01', false, EMPTY_FILTER)).toHaveLength(1)
})

it('shows all saved months without merging months or showing deleted and carried history records', () => {
  const issues = [
    task('jan', { recurrenceId: 'daily' }),
    task('feb', { recurrenceId: 'daily', planningMonth: '2027-02', date: '2027-02-01' }),
    task('deleted', { deletedAt: 10 }), task('history', { carryoverToId: 'current' }),
    task('current', { carryoverFromId: 'history' }),
  ]
  expect(selectBoardGroups(issues, doneIds, '2027-01', false, EMPTY_FILTER).map(group => group.issue.id)).toEqual(['current', 'jan'])
  const groups = selectBoardGroups(issues, doneIds, '2027-01', true, EMPTY_FILTER)
  expect(groups.map(group => group.issue.id)).toEqual(['current', 'feb', 'jan'])
  expect(new Set(groups.map(group => group.key)).size).toBe(3)
  expect(selectBoardGroups(issues, doneIds, '2027-01', true, { ...EMPTY_FILTER, query: 'feb' })).toHaveLength(1)
  expect(selectBoardGroups(issues, doneIds, '2027-01', false, { ...EMPTY_FILTER, query: 'feb' })).toHaveLength(0)
})

it('converts filtered drop anchors to positions including hidden tasks and recurrence instances', () => {
  const issues = [task('a'), task('b', { recurrenceId: 'daily' }), task('c', { recurrenceId: 'daily', date: '2027-01-02' }), task('d'), task('e')]
  const visible = new Set(selectBoardGroups(issues, doneIds, '2027-01', false, { ...EMPTY_FILTER, query: 'd' }).map(group => group.key))
  expect(groupedDropIndex(issues, doneIds, 'e', 'todo', 0, visible)).toBe(3)
  expect(groupedDropIndex(issues, doneIds, 'e', 'todo', 1, visible)).toBe(4)
  const recurring = new Set(selectBoardGroups(issues, doneIds, '2027-01', false, { ...EMPTY_FILTER, query: 'c' }).map(group => group.key))
  expect(groupedDropIndex(issues, doneIds, 'e', 'todo', 0, recurring)).toBe(1)
})

it('changes status in the task own month while excluding archived, deleted and other-project positions', () => {
  const issues = [
    task('moving', { planningMonth: '2027-02', date: '2027-02-03', startMin: 600 }),
    task('jan', { statusId: 'doing' }),
    task('feb', { planningMonth: '2027-02', statusId: 'doing' }),
    task('deleted', { planningMonth: '2027-02', statusId: 'doing', deletedAt: 10 }),
    task('history', { planningMonth: '2027-02', statusId: 'doing', carryoverToId: 'feb' }),
    task('other', { projectId: 'other', planningMonth: '2027-02', statusId: 'doing' }),
  ]
  expect(statusMoveScope(issues, 'moving', 'doing')).toEqual({ month: '2027-02', index: 1 })
  expect(statusMoveScope(issues, 'feb', 'doing')).toEqual({ month: '2027-02', index: 0 })
  expect(statusMoveScope(issues, 'missing', 'doing')).toBeNull()
  expect(issues[0]).toMatchObject({ planningMonth: '2027-02', date: '2027-02-03', startMin: 600 })
})
