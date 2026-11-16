import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { Issue } from '../../db/types'
import { groupBoardIssues, groupedDropIndex } from './recurringGroups'
import { RecurringBoardCard } from './RecurringBoardCard'

function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, type: 'task', title: '毎日の確認', statusId: 'todo', priority: 'medium', parentId: null,
    labels: [], dueDate: null, estimateMin: null, sprintId: 'sprint', rank: id, date: '2027-01-01', startMin: null, durationMin: 30,
    icon: '', color: '#38bdf8', reminderOffsetMin: null, recurrenceId: null, assigneeId: null, completedAt: null,
    createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

const doneIds = new Set(['done'])

describe('groupBoardIssues', () => {
  it('collects all occurrences across statuses into one card', () => {
    const occurrences = Array.from({ length: 14 }, (_, index) => issue(`r${index}`, {
      recurrenceId: 'daily', number: index + 1, date: `2027-01-${String(14 - index).padStart(2, '0')}`,
      statusId: index === 13 ? 'done' : index === 12 ? 'doing' : 'todo',
    }))
    const [group] = groupBoardIssues(occurrences, doneIds)
    expect(groupBoardIssues(occurrences, doneIds)).toHaveLength(1)
    expect(group.occurrences).toHaveLength(14)
    expect(group.issue).toMatchObject({ date: '2027-01-02', statusId: 'doing' })
    expect(group.occurrences[0].date).toBe('2027-01-01')
    expect(occurrences[0].date).toBe('2027-01-14')
  })

  it('does not combine identical titles without the same rule and scope', () => {
    const issues = [
      issue('a'), issue('b'),
      issue('c', { recurrenceId: 'one' }), issue('d', { recurrenceId: 'two' }),
      issue('e', { recurrenceId: 'one', sprintId: 'other' }),
      issue('f', { recurrenceId: 'one', projectId: 'other' }),
    ]
    expect(groupBoardIssues(issues, doneIds)).toHaveLength(6)
  })

  it('keeps a stable group key when the representative completes', () => {
    const first = issue('a', { recurrenceId: 'daily', date: '2027-01-01' })
    const next = issue('b', { recurrenceId: 'daily', date: '2027-01-02' })
    const before = groupBoardIssues([first, next], doneIds)[0]
    const after = groupBoardIssues([{ ...first, statusId: 'done' }, next], doneIds)[0]
    expect(after.key).toBe(before.key)
    expect(after.issue.id).toBe('b')
    const complete = groupBoardIssues([{ ...first, statusId: 'done' }, { ...next, statusId: 'done' }], doneIds)[0]
    expect(complete.issue.statusId).toBe('done')
    expect(complete.key).toBe(before.key)
  })

  it('ignores deleted occurrences and places undated ones last', () => {
    const [group] = groupBoardIssues([
      issue('a', { recurrenceId: 'daily', date: null }),
      issue('b', { recurrenceId: 'daily', date: '2027-01-03' }),
      issue('c', { recurrenceId: 'daily', deletedAt: 1 }),
    ], doneIds)
    expect(group.occurrences.map((item) => item.id)).toEqual(['b', 'a'])
    expect(group.issue.id).toBe('b')
  })
})

describe('groupedDropIndex', () => {
  const issues = [issue('a', { recurrenceId: 'daily' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' }), issue('c'), issue('d')]

  it('converts visible positions into underlying issue positions', () => {
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 0)).toBe(0)
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 1)).toBe(2)
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 2)).toBe(3)
    expect(groupedDropIndex(issues, doneIds, 'd', 'doing', 0)).toBe(0)
  })

  it('counts hidden occurrences belonging to a group shown in another column', () => {
    const mixed = [issue('a', { recurrenceId: 'daily', statusId: 'doing' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' }), issue('c'), issue('d')]
    expect(groupedDropIndex(mixed, doneIds, 'd', 'todo', 0)).toBe(1)
    expect(groupedDropIndex(mixed, doneIds, 'd', 'todo', 1)).toBe(2)
  })
})

it('renders one collapsed summary with progress and occurrence controls', () => {
  const group = groupBoardIssues([issue('a', { recurrenceId: 'daily', statusId: 'done' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' })], doneIds)[0]
  const html = renderToStaticMarkup(createElement(RecurringBoardCard, {
    group, doneIds, statuses: [{ id: 'todo', name: 'To Do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }], pulse: false,
    onOpen: () => {},
    onToggleDone: async () => {},
    onChangeStatus: async () => {},
  }))
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-label="毎日の確認を編集"')
  expect(html).toContain('aria-label="毎日の確認の繰り返し一覧を開く"')
  expect(html).toContain('完了 1/2')
  expect(html).toContain('次の1件を完了')
  expect(html).toContain('hidden=""')
  expect(html).toContain(' のステータス')
  expect(html).toContain('data-no-drag="true"')
})
