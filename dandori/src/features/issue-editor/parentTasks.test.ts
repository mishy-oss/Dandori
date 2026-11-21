import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import type { Issue, WorkflowStatus } from '../../db/types'
import { descendantTaskIds, parentTaskOptions, searchParentTasks } from './parentTasks'
import { ParentTaskPicker } from './ParentTaskPicker'

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, title: id, parentId: null, type: 'task', statusId: 'todo', planningMonth: '2026-11',
    date: null, startMin: null, updatedAt: 0, deletedAt: null, ...patch,
  } as Issue
}
const statuses: WorkflowStatus[] = [{ id: 'todo', name: 'To Do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }]

it('excludes self, all descendants, deleted records, archived placements and other projects', () => {
  const issues = [
    task('parent'), task('editing', { parentId: 'parent' }), task('child', { parentId: 'editing' }), task('grandchild', { parentId: 'child' }),
    task('deleted', { deletedAt: 1 }), task('history', { carryoverToId: 'current' }), task('other', { projectId: 'other' }),
    task('done', { statusId: 'done', planningMonth: '2026-10' }),
  ]
  expect(parentTaskOptions(issues, 'project', 'editing').map(issue => issue.id)).toEqual(['parent', 'done'])
  expect([...descendantTaskIds(issues, 'editing')]).toEqual(['child', 'grandchild'])
  expect(parentTaskOptions(issues, 'project').map(issue => issue.id)).toEqual(['parent', 'editing', 'child', 'grandchild', 'done'])
})

it('can find one parent by number or normalized title among 320 candidates without changing the source list', () => {
  const issues = Array.from({ length: 320 }, (_, index) => task(`task-${index + 1}`, { number: index + 1, title: `作業${index + 1}`, updatedAt: index }))
  issues[122] = { ...issues[122], title: 'API 会議 準備' }
  expect(searchParentTasks(issues, '＃１２３')[0].id).toBe('task-123')
  expect(searchParentTasks(issues, 'ａｐｉ　準備 #123').map(issue => issue.id)).toEqual(['task-123'])
  expect(searchParentTasks(issues, '見つからない')).toEqual([])
  expect(searchParentTasks(issues, '').map(issue => issue.id)[0]).toBe('task-320')
  expect(issues[0].id).toBe('task-1')
})

it('prioritizes exact numbers and exact titles over newer substring matches', () => {
  const issues = [task('long', { number: 123, title: '定例会議・準備', updatedAt: 100 }), task('exact-number', { number: 12 }), task('exact-title', { title: '定例会議' })]
  expect(searchParentTasks(issues, '#12')[0].id).toBe('exact-number')
  expect(searchParentTasks(issues, '定例会議')[0].id).toBe('exact-title')
  expect(searchParentTasks(issues, '定例会議 #123').map(issue => issue.id)).toEqual(['long'])
})

it('shows a search and the first 20 candidates instead of rendering a 320-item select', () => {
  const options = Array.from({ length: 320 }, (_, index) => task(`task-${index}`, { number: index + 1, title: `候補${index + 1}`, updatedAt: index }))
  const onChange = vi.fn()
  const html = renderToStaticMarkup(createElement(ParentTaskPicker, { options, value: null, statuses, onChange }))
  expect(html).toContain('aria-label="親タスクを選ぶ"')
  expect(html).toContain('aria-label="親タスクを検索"')
  expect(html).toContain('候補 320件 · 20件表示')
  expect(html.match(/を親タスクに設定"/g)).toHaveLength(20)
  expect(html).toContain('さらに20件表示')
  expect(html).not.toContain('<select')
  expect(onChange).not.toHaveBeenCalled()
})

it('keeps the selected parent visible even when it is outside the current page or archived', () => {
  const parent = task('selected', { number: 50, title: '選択済みの親', date: '2026-11-20', startMin: 540, carryoverToId: 'next' })
  const html = renderToStaticMarkup(createElement(ParentTaskPicker, { options: [], value: parent.id, selectedParent: parent, statuses, onChange: () => {} }))
  const summary = html.match(/<summary[\s\S]*?<\/summary>/)?.[0]
  expect(summary).toContain('#50 · 選択済みの親')
  expect(summary).toContain('2026/11/20 (金) 09:00')
  expect(summary).toContain('aria-label="親タスクを変更"')
  expect(summary).not.toContain('親タスクなし')
})

it('distinguishes same-title candidates with number, type, status and date', () => {
  const options = [task('one', { number: 1, title: '定例', date: '2026-11-20', startMin: 540 }), task('two', { number: 2, title: '定例', type: 'epic', statusId: 'done', date: '2026-11-21', startMin: 600 })]
  const html = renderToStaticMarkup(createElement(ParentTaskPicker, { options, value: null, statuses, onChange: () => {} }))
  expect(html).toContain('#1 · 定例')
  expect(html).toContain('#2 · 定例')
  expect(html).toContain('task · To Do · 2026/11/20 (金) 09:00')
  expect(html).toContain('epic · Done · 2026/11/21 (土) 10:00')
})
