// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDataStore } from '../../store/data'
import { DomView, seedUi, task } from '../../test/dom'
import { IssueEditor } from './IssueEditor'

let view: DomView
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  seedUi()
  view = new DomView()
})
afterEach(async () => {
  await view.dispose()
  useDataStore.setState(useDataStore.getInitialState(), true)
  vi.unstubAllGlobals()
})

it('saves entered labels and linked start/end times to the selected month and status', async () => {
  const create = vi.fn(async () => task('created'))
  const close = vi.fn()
  useDataStore.setState({ createIssue: create, issues: [task('existing', { labels: ['API'] })] })
  await view.render(createElement(IssueEditor, { issue: null, defaultPlanningMonth: '2027-02', initialSchedule: { date: '2027-02-10', startMin: null }, onClose: close }))
  await view.input(view.field('タイトル'), '会議資料')
  await view.click(view.get('[aria-label="APIのラベルを追加"]'))
  await view.input(view.get<HTMLInputElement>('[aria-label="追加するラベル"]'), '仕事')
  await view.input(view.field('開始時刻'), '09:00')
  expect(view.field('終了時刻').value).toBe('09:30')
  await view.input(view.field('終了時刻'), '10:15')
  expect(view.field('所要(分)').value).toBe('75')
  await view.submit()
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '会議資料', labels: ['API', '仕事'], planningMonth: '2027-02', date: '2027-02-10', startMin: 540, durationMin: 75, statusId: 'doing' }))
  expect(close).toHaveBeenCalledOnce()
})

it('explains an invalid duration without blaming the end time or saving', async () => {
  const create = vi.fn(async () => task('created'))
  useDataStore.setState({ createIssue: create })
  await view.render(createElement(IssueEditor, { issue: null, onClose: vi.fn() }))
  await view.input(view.field('タイトル'), '所要時間の確認')
  await view.input(view.field('開始時刻'), '09:00')
  for (const [value, error] of [['', '所要時間を入力してください'], ['0', '所要時間は5分以上で指定してください'], ['30.5', '所要時間は分単位の整数で指定してください'], ['1441', '所要時間は1440分（24時間）以内で指定してください']]) {
    await view.input(view.field('所要(分)'), value)
    await view.submit()
    expect(view.get('[role="alert"]').textContent).toBe(error)
  }
  expect(create).not.toHaveBeenCalled()
})

it('switches recurring edit scope and submits future changes with the updated rule', async () => {
  const issue = task('daily', { recurrenceId: 'rule' })
  const update = vi.fn(async () => {})
  useDataStore.setState({ issues: [issue], updateIssue: update, recurrenceRules: [{ id: 'rule', projectId: 'project', frequency: 'daily', interval: 1, startDate: '2027-01-01', endDate: null, active: true, template: issue, createdAt: 0, updatedAt: 0 }] })
  await view.render(createElement(IssueEditor, { issue, onClose: vi.fn() }))
  const frequency = view.field('頻度')
  expect(frequency.matches(':disabled')).toBe(true)
  const future = [...view.container.querySelectorAll('label')].find(label => label.textContent?.trim() === 'この回以降')!.querySelector('input')!
  await view.click(future)
  expect(frequency.matches(':disabled')).toBe(false)
  await view.input(frequency, 'monthly')
  await view.input(view.field('タイトル'), '毎月の作業')
  await view.submit()
  expect(update).toHaveBeenCalledWith(issue.id, expect.objectContaining({ title: '毎月の作業', recurrence: { frequency: 'monthly', interval: 1, endDate: null } }), 'future')
})

it('detaches the parent immediately and preserves unsaved edits through store refresh and save', async () => {
  const parent = task('parent')
  const child = task('child', { parentId: parent.id })
  const update = vi.fn(async (id: string, patch: object) => {
    useDataStore.setState({ issues: useDataStore.getState().issues.map(issue => issue.id === id ? { ...issue, ...patch } : issue) })
  })
  useDataStore.setState({ issues: [parent, child], updateIssue: update })
  await view.render(createElement(IssueEditor, { issue: child, onClose: vi.fn() }))
  await view.input(view.field('タイトル'), '入力途中の子タスク')
  await view.click(view.button('親を外す'))
  expect(update).toHaveBeenNthCalledWith(1, child.id, { parentId: null })
  expect(view.field('タイトル').value).toBe('入力途中の子タスク')
  expect([...view.container.querySelectorAll('button')].some(button => button.textContent === '親を外す')).toBe(false)
  await view.submit()
  expect(update).toHaveBeenNthCalledWith(2, child.id, expect.objectContaining({ title: '入力途中の子タスク', parentId: null }), undefined)
})

it('prevents duplicate issue creation when submitted twice while saving', async () => {
  let resolveCreate!: (issue: ReturnType<typeof task>) => void
  const create = vi.fn(() => new Promise<ReturnType<typeof task>>(resolve => { resolveCreate = resolve }))
  const close = vi.fn()
  useDataStore.setState({ createIssue: create })
  await view.render(createElement(IssueEditor, { issue: null, onClose: close }))
  await view.input(view.field('タイトル'), '重複させないタスク')
  await view.submit()
  expect(view.button('保存中…').disabled).toBe(true)
  await view.submit()
  expect(create).toHaveBeenCalledTimes(1)
  await act(async () => { resolveCreate(task('created')) })
  expect(close).toHaveBeenCalledOnce()
})

it('ignores Enter key while composing Japanese input in the child task field', async () => {
  const parent = task('parent')
  const create = vi.fn(async () => task('child'))
  useDataStore.setState({ issues: [parent], createIssue: create })
  await view.render(createElement(IssueEditor, { issue: parent, onClose: vi.fn() }))
  const input = view.get<HTMLInputElement>('[aria-label="子Issueのタイトル"]')
  await view.input(input, '変換中の子タスク')
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }))
  })
  expect(create).not.toHaveBeenCalled()
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: false, bubbles: true }))
  })
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: '変換中の子タスク', parentId: parent.id }))
})
