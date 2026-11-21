// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDataStore } from '../../store/data'
import { DomView, seedUi, task } from '../../test/dom'
import { BoardScreen } from '../board/BoardScreen'
import { MonthNavigator } from './MonthNavigator'
import { currentMonth } from '../../lib/month'

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

it('changes month with arrows, direct input and the current-month button', async () => {
  const selectMonth = vi.fn(async (selectedMonth: string) => { useDataStore.setState({ selectedMonth }) })
  useDataStore.setState({ selectMonth })
  await view.render(createElement(MonthNavigator))
  const input = view.get<HTMLInputElement>('[aria-label="対象月"]')
  await view.click(view.get('[aria-label="前の月"]'))
  expect(input.value).toBe('2026-12')
  await view.click(view.get('[aria-label="次の月"]'))
  expect(input.value).toBe('2027-01')
  await view.input(input, '2028-02')
  expect(input.value).toBe('2028-02')
  await view.click(view.button('今月'))
  expect(input.value).toBe(currentMonth())
  expect(view.button('今月').disabled).toBe(true)
  expect(selectMonth.mock.calls.map(([month]) => month)).toEqual(['2026-12', '2027-01', '2028-02', currentMonth()])
})

it('blocks repeated month changes while loading and displays failures before retrying', async () => {
  let reject!: (cause: Error) => void
  const selectMonth = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
  useDataStore.setState({ selectMonth })
  await view.render(createElement(MonthNavigator))
  await view.click(view.get('[aria-label="次の月"]'))
  expect(view.get<HTMLInputElement>('[aria-label="対象月"]').disabled).toBe(true)
  await view.click(view.get('[aria-label="次の月"]'))
  expect(selectMonth).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('月の読み込みに失敗')) })
  expect(view.get('[role="alert"]').textContent).toBe('月の読み込みに失敗')
  expect(view.get<HTMLInputElement>('[aria-label="対象月"]').disabled).toBe(false)
  selectMonth.mockImplementation(async () => { useDataStore.setState({ selectedMonth: '2027-02' }) })
  await view.click(view.get('[aria-label="次の月"]'))
  expect(view.container.querySelector('[role="alert"]')).toBeNull()
  expect(view.get<HTMLInputElement>('[aria-label="対象月"]').value).toBe('2027-02')
})

it('filters real board cards by query, priority, type and month, and clears filters', async () => {
  useDataStore.setState({ issues: [
    task('資料作成', { number: 23, rank: 'a', labels: ['仕事'], priority: 'high' }),
    task('不具合', { number: 24, rank: 'b', type: 'bug' }),
    task('翌月の資料', { number: 25, rank: 'c', planningMonth: '2027-02', date: '2027-02-01' }),
    task('完了済み', { number: 26, rank: 'd', statusId: 'done' }),
  ] })
  await view.render(createElement(BoardScreen))
  expect([...view.container.querySelectorAll('[role="tab"]')].map(tab => tab.textContent)).toEqual(['To Do2', 'In Progress0', 'Recurring0', 'Done1'])
  const cards = () => [...view.get('ul[aria-label="To Do"]').querySelectorAll('[data-card-id]')].map(card => card.getAttribute('data-card-id'))
  expect(cards()).toEqual(['資料作成', '不具合'])
  const query = view.get<HTMLInputElement>('[aria-label="タスクを検索"]')
  await view.input(query, '仕事')
  expect(cards()).toEqual(['資料作成'])
  await view.input(query, '#24')
  expect(cards()).toEqual(['不具合'])
  await view.input(query, '')
  await view.input(view.get<HTMLSelectElement>('[aria-label="優先度で絞り込み"]'), 'high')
  expect(cards()).toEqual(['資料作成'])
  await view.input(view.get<HTMLSelectElement>('[aria-label="種別で絞り込み"]'), 'bug')
  expect(cards()).toEqual([])
  await view.click(view.button('クリア'))
  expect(cards()).toEqual(['資料作成', '不具合'])
  expect(query.value).toBe('')
  expect(view.button('クリア').disabled).toBe(true)
  await view.click(view.get('input[type="checkbox"]'))
  expect(cards()).toEqual(['資料作成', '不具合', '翌月の資料'])
  await view.click(view.get('[role="tab"]:last-child'))
  expect(view.get('ul[aria-label="Done"] [data-card-id]').getAttribute('data-card-id')).toBe('完了済み')
})

it('expands recurring occurrences and opens the selected occurrence for editing', async () => {
  useDataStore.setState({ issues: [
    task('a', { title: '日課', recurrenceId: 'daily', statusId: 'done' }),
    task('b', { title: '日課', recurrenceId: 'daily', number: 2, date: '2027-01-02' }),
  ] })
  await view.render(createElement(BoardScreen))
  const card = view.get('[aria-label="日課の繰り返し"]')
  expect(card.textContent).toContain('完了 1/2')
  const expand = view.get<HTMLButtonElement>('[aria-label="日課の繰り返し一覧を開く"]')
  const details = view.get<HTMLElement>(`[id="${expand.getAttribute('aria-controls')}"]`)
  expect(details.hidden).toBe(true)
  await view.click(expand)
  expect(expand.getAttribute('aria-expanded')).toBe('true')
  expect(details.hidden).toBe(false)
  expect(details.querySelectorAll('li')).toHaveLength(2)
  const occurrence = [...details.querySelectorAll('button')].find(button => button.textContent?.includes('#2'))!
  await view.click(occurrence)
  expect(view.get('[role="dialog"]').getAttribute('aria-label')).toBe('Issueを編集')
  expect(view.field('タイトル').value).toBe('日課')
  expect(view.get('[role="dialog"] h2').textContent).toBe('#2')
  await view.click(view.button('キャンセル'))
  expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  await view.click(view.get('[aria-label="日課を編集"]'))
  expect(view.get('[role="dialog"] h2').textContent).toBe('#2')
})

it('changes a task month from its card and removes it from the selected-month list', async () => {
  useDataStore.setState({ issues: [task('資料作成')] })
  const assign = vi.fn(async (id: string, planningMonth: string) => {
    useDataStore.setState({ issues: useDataStore.getState().issues.map(issue => issue.id === id ? { ...issue, planningMonth, date: null, startMin: null } : issue) })
  })
  useDataStore.setState({ assignIssueToMonth: assign })
  await view.render(createElement(BoardScreen))
  await view.click(view.get('[aria-label="資料作成の対象月を変更"]'))
  await view.input(view.get<HTMLInputElement>('[aria-label="変更先の対象月"]'), '2027-02')
  await view.click(view.button('変更する'))
  expect(assign).toHaveBeenCalledWith('資料作成', '2027-02')
  expect(view.container.querySelector('[role="dialog"]')).toBeNull()
  expect(view.container.querySelector('[data-card-id="資料作成"]')).toBeNull()
})
