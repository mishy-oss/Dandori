import { beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDataStore } from '../../store/data'
import { BoardScreen } from '../board/BoardScreen'
import { BacklogScreen } from '../backlog/BacklogScreen'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { SettingsScreen } from '../settings/SettingsScreen'
import { TimelineScreen } from '../timeline/TimelineScreen'
import { ReleaseNotesDialog } from '../settings/ReleaseNotesDialog'
import { DeleteIssueDialog } from '../issue-editor/DeleteIssueDialog'
import type { Issue } from '../../db/types'

vi.mock('../../store/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/data')>()
  function useTestState<T>(selector: (state: ReturnType<typeof actual.useDataStore.getState>) => T): T {
    return selector(actual.useDataStore.getState())
  }
  return { ...actual, useDataStore: Object.assign(useTestState, actual.useDataStore) }
})

beforeEach(() => {
  useDataStore.setState({
    ...useDataStore.getInitialState(), ready: true, selectedMonth: '2027-01', currentProjectId: 'project',
    projects: [{ id: 'project', key: 'APP', name: 'App', color: '#38bdf8', workflowId: 'workflow', nextNumber: 1, createdAt: 0, updatedAt: 0, deletedAt: null }],
    workflows: { workflow: { id: 'workflow', statuses: [{ id: 'todo', name: 'To Do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }], createdAt: 0, updatedAt: 0, deletedAt: null } },
  }, true)
})

it('shows monthly planning without any sprint controls', () => {
  for (const Screen of [BoardScreen, BacklogScreen]) {
    const html = renderToStaticMarkup(createElement(Screen))
    expect(html).toContain('対象月')
    expect(html).toContain('月次バーンダウン')
    expect(html).not.toContain('スプリント')
  }
})

it('uses Japanese headings while preserving English option values', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  try {
    for (const [Screen, title] of [[BoardScreen, 'ボード'], [BacklogScreen, 'ボード'], [SettingsScreen, '設定']] as const) {
      const html = renderToStaticMarkup(createElement(Screen))
      expect(html).toContain(`>${title}</h1>`)
      expect(html).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
    }
    const settings = renderToStaticMarkup(createElement(SettingsScreen))
    expect(settings).toContain('テーマ</h2>')
    expect(settings).toContain('システム')
    expect(settings).toContain('迷ったらtaskで大丈夫です。')
    expect(settings).toContain('JSONを準備')
    expect(settings).toContain('Googleアカウントと同期')
    expect(settings).toContain('Googleでログイン')
    const timeline = renderToStaticMarkup(createElement(TimelineScreen))
    expect(timeline).toContain('今日へ')
    const editor = renderToStaticMarkup(createElement(IssueEditor, { issue: null, onClose: () => {} }))
    expect(editor).toContain('新規タスク')
    expect(editor).toContain('保存')
    expect(editor).toContain('タイトル')
    expect(editor).toContain('キャンセル')
    expect(editor).toContain('aria-label="追加するラベル"')
    expect(editor).toContain('終日予定')
    for (const value of ['task', 'bug', 'story', 'epic', 'urgent', 'highest', 'high', 'medium', 'low', 'To Do', 'Done']) {
      expect(editor).toContain(`>${value}</option>`)
    }
    for (const html of [editor, renderToStaticMarkup(createElement(BacklogScreen))]) {
      const labels = ['urgent', 'highest', 'high', 'medium', 'low']
      const positions = labels.map((label) => html.indexOf(`>${label}</option>`))
      expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBe(true)
      expect(html).toMatch(/value="medium"[^>]*>medium<\/option>/)
    }
  } finally {
    vi.unstubAllGlobals()
  }
})

it('renders accessible release status and deletion confirmation', () => {
  const release = renderToStaticMarkup(createElement(ReleaseNotesDialog, { onClose: () => {} }))
  expect(release).toContain('role="status"')
  expect(release).not.toContain('role="のステータス"')
  const confirmation = renderToStaticMarkup(createElement(DeleteIssueDialog, {
    title: '親タスク', descendantCount: 3, onDelete: async () => {}, onClose: () => {}, onDeleted: () => {},
  }))
  expect(confirmation).toContain('role="alertdialog"')
  expect(confirmation).toContain('子タスク3件も一緒に削除されます。')
  expect(confirmation).toContain('キャンセル')
  expect(confirmation).toContain('削除する')
})

it('creates tasks for a month instead of a sprint', () => {
  const html = renderToStaticMarkup(createElement(IssueEditor, {
    issue: null, defaultPlanningMonth: '2027-01',
    onClose: () => {},
  }))
  expect(html).toContain('type="month"')
  expect(html).toContain('2027-01')
  expect(html).not.toContain('スプリント')
})

it('offers the routine status in board tabs and the issue editor', () => {
  const workflow = useDataStore.getState().workflows.workflow
  useDataStore.setState({ workflows: { workflow: { ...workflow, statuses: [workflow.statuses[0], { id: 'doing', name: 'In Progress', category: 'doing' }, { id: 'routine', name: 'Recurring', category: 'routine' }, workflow.statuses[1]] } } })
  const board = renderToStaticMarkup(createElement(BoardScreen))
  expect(board.indexOf('To Do')).toBeLessThan(board.indexOf('In Progress'))
  expect(board.indexOf('In Progress')).toBeLessThan(board.indexOf('Recurring'))
  expect(board.indexOf('Recurring')).toBeLessThan(board.indexOf('Done'))
  const editor = renderToStaticMarkup(createElement(IssueEditor, { issue: null, defaultStatusId: 'routine', onClose: () => {} }))
  expect(editor).toContain('value="routine" selected=""')
  expect(editor.indexOf('value="todo"')).toBeLessThan(editor.indexOf('value="doing"'))
  expect(editor.indexOf('value="doing"')).toBeLessThan(editor.indexOf('value="routine"'))
  expect(editor.indexOf('value="routine"')).toBeLessThan(editor.indexOf('value="done"'))
  expect(editor).toContain('会議など決まった時間の予定に使います')
})

function recurringTask(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, title: '日課', type: 'task', priority: 'medium', statusId: 'todo',
    parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: '2027-01', rank: id,
    date: '2027-01-01', startMin: null, durationMin: 30, icon: '', color: '#38bdf8', reminderOffsetMin: null,
    recurrenceId: 'daily', assigneeId: null, completedAt: null, createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

it('shows parent links, child progress and related editing controls', () => {
  const parent = recurringTask('parent', { recurrenceId: null, title: '親の作業' })
  const child = recurringTask('child', { recurrenceId: null, parentId: parent.id, title: '子の作業' })
  const completed = recurringTask('completed', { recurrenceId: null, parentId: parent.id, title: '完了した子', statusId: 'done', planningMonth: '2026-12' })
  useDataStore.setState({ issues: [parent, child, completed] })
  const board = renderToStaticMarkup(createElement(BoardScreen))
  expect(board).toContain('子タスク 1/2 完了')
  expect(board).toContain('親: ')
  expect(board).toContain('親の作業')
  const parentEditor = renderToStaticMarkup(createElement(IssueEditor, { issue: parent, onClose: () => {} }))
  expect(parentEditor).toContain('aria-label="子の作業を編集"')
  expect(parentEditor).toContain('aria-label="完了した子を編集"')
  expect(parentEditor).toContain('親のステータスは子タスクの進捗に連動します')
  expect(parentEditor).toContain('aria-label="子の作業を親タスクから外す"')
  expect(parentEditor).toContain('aria-label="完了した子を親タスクから外す"')
  const childEditor = renderToStaticMarkup(createElement(IssueEditor, { issue: child, onClose: () => {} }))
  expect(childEditor).toContain('親タスクを編集')
  expect(childEditor).toContain('親を外す</button>')
  expect(childEditor).toContain('解除はすぐに保存されます')
  useDataStore.setState({ issues: [parent, { ...child, parentId: null }, completed] })
  const detached = renderToStaticMarkup(createElement(IssueEditor, { issue: { ...child, parentId: null }, onClose: () => {} }))
  expect(detached).not.toContain('親を外す</button>')
})

it('keeps recurring progress and month controls in the unified board and legacy entry', () => {
  useDataStore.setState({ issues: [
    recurringTask('a', { statusId: 'done' }),
    recurringTask('b', { number: 2, date: '2027-01-02' }),
    recurringTask('c', { number: 3, recurrenceId: 'another', date: '2027-01-03' }),
    recurringTask('d', { number: 4, recurrenceId: null, title: '通常タスク' }),
    recurringTask('e', { number: 5, planningMonth: '2027-02', date: '2027-02-01', title: '翌月だけのタスク' }),
  ] })
  for (const Screen of [BoardScreen, BacklogScreen]) {
    const html = renderToStaticMarkup(createElement(Screen))
    expect(html.match(/aria-label="日課の繰り返し"/g)).toHaveLength(2)
    expect(html.match(/aria-label="日課を編集"/g)).toHaveLength(2)
    expect(html.match(/aria-label="日課の繰り返し一覧を開く"/g)).toHaveLength(2)
    expect(html).toContain('完了 1/2')
    expect(html).toContain('通常タスク')
    expect(html).not.toContain('翌月だけのタスク')
  }
  const tasks = renderToStaticMarkup(createElement(BacklogScreen))
  expect(tasks).toContain('To Do：3件表示 / 全ステータス：3件')
  expect(tasks).toContain('繰り返し各回を含む4タスク')
  expect(tasks).toContain('aria-label="通常タスクの対象月を変更"')
  expect(tasks).toContain('日課の対象月を変更')
  expect(tasks.match(/aria-label="月次バーンダウン"/g)).toHaveLength(1)
  expect(tasks).toContain('親タスク・epic・持ち越し済みの履歴を除いて数えます')
  for (const label of ['タスクを検索', '優先度で絞り込み', '種別で絞り込み', 'すべての月のタスクを表示']) expect(tasks).toContain(label)
})

it('shows one current carryover with an expandable history in board and task views', () => {
  const previous = recurringTask('previous', { recurrenceId: null, title: '過去の配置', carryoverToId: 'current' })
  const current = recurringTask('current', { recurrenceId: null, title: '現在の作業', number: 2, carryoverFromId: previous.id, carryoverRootId: previous.id, carryoverSequence: 1 })
  useDataStore.setState({ issues: [previous, current] })
  for (const Screen of [BoardScreen, BacklogScreen]) {
    const html = renderToStaticMarkup(createElement(Screen))
    expect(html).toContain('現在の作業')
    expect(html).not.toContain('過去の配置')
    expect(html).toContain('持ち越し履歴（1件）')
  }
  const history = renderToStaticMarkup(createElement(IssueEditor, { issue: previous, onClose: () => {} }))
  expect(history).toContain('配置履歴')
  expect(history).toContain('持ち越し先を開く')
  expect(history).not.toContain('type="submit"')
  expect(history).not.toContain('未配置に戻す')
})

it('offers a carryover entry point only for scheduled unfinished work', () => {
  const issue = recurringTask('one', { recurrenceId: null })
  useDataStore.setState({ issues: [issue] })
  expect(renderToStaticMarkup(createElement(IssueEditor, { issue, onClose: () => {} }))).toContain('翌日以降へ持ち越す')
  const completed = { ...issue, statusId: 'done' }
  useDataStore.setState({ issues: [completed] })
  expect(renderToStaticMarkup(createElement(IssueEditor, { issue: completed, onClose: () => {} }))).not.toContain('翌日以降へ持ち越す')
})

it('defaults recurring edits to one occurrence and offers the future scope', () => {
  const issue = recurringTask('scope')
  useDataStore.setState({ issues: [issue] })
  const html = renderToStaticMarkup(createElement(IssueEditor, { issue, onClose: () => {} }))
  expect(html).toContain('変更する範囲')
  expect(html).toContain('この回のみ')
  expect(html).toContain('この回以降')
  expect(html).toMatch(/type="radio"[^>]*checked=""/)
  expect(html).toMatch(/<fieldset disabled=""[^>]*>[\s\S]*?繰り返し/)
  const single = { ...issue, recurrenceId: null }
  useDataStore.setState({ issues: [single] })
  expect(renderToStaticMarkup(createElement(IssueEditor, { issue: single, onClose: () => {} }))).not.toContain('変更する範囲')
})
