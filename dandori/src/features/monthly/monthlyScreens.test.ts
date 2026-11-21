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
    expect(settings).toContain('JSONから復元')
    expect(settings).toContain('aria-label="バックアップJSONを選択"')
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

it('shows explicit Japanese weekdays for both date fields in the issue editor', () => {
  const issue = recurringTask('date-fields', { recurrenceId: null, dueDate: '2026-11-17', date: '2026-11-20' })
  useDataStore.setState({ issues: [issue] })
  const html = renderToStaticMarkup(createElement(IssueEditor, { issue, onClose: () => {} }))
  expect(html).toContain('value="2026/11/17 (火)"')
  expect(html).toContain('value="2026/11/20 (金)"')
  expect(html).toContain('aria-label="期限をカレンダーから選択"')
  expect(html).toContain('aria-label="日付をカレンダーから選択"')
  expect(html).not.toContain('()')
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

it('offers existing labels in new and edit forms without suggesting selected or deleted labels', () => {
  const existing = recurringTask('first', { recurrenceId: null, labels: ['API', '仕事'], createdAt: 1 })
  const editing = recurringTask('second', { recurrenceId: null, labels: [' ａｐｉ '], createdAt: 2 })
  const deleted = recurringTask('deleted', { labels: ['削除済みラベル'], deletedAt: 1 })
  useDataStore.setState({ issues: [existing, editing, deleted] })
  const newForm = renderToStaticMarkup(createElement(IssueEditor, { issue: null, onClose: () => {} }))
  expect(newForm).toContain('既存のラベルから選択')
  expect(newForm).toContain('aria-label="APIのラベルを追加"')
  expect(newForm).toContain('aria-label="仕事のラベルを追加"')
  expect(newForm).not.toContain('削除済みラベルのラベルを追加')
  const editForm = renderToStaticMarkup(createElement(IssueEditor, { issue: editing, onClose: () => {} }))
  expect(editForm).toContain('aria-label="APIのラベルを削除"')
  expect(editForm).not.toContain('aria-label="APIのラベルを追加"')
  expect(editForm).toContain('aria-label="仕事のラベルを追加"')
})

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
  expect(childEditor).toContain('aria-label="親タスクを検索"')
  expect(childEditor).toContain('aria-label="親タスクを変更"')
  expect(childEditor).toContain('親の設定・変更はタスク保存時に反映します')
  expect(childEditor).not.toContain('<option value="parent"')
  expect(childEditor).toContain('親タスクを編集')
  expect(childEditor).toContain('親を外す</button>')
  expect(childEditor).toContain('解除はすぐに保存されます')
  useDataStore.setState({ issues: [parent, { ...child, parentId: null }, completed] })
  const detached = renderToStaticMarkup(createElement(IssueEditor, { issue: { ...child, parentId: null }, onClose: () => {} }))
  expect(detached).not.toContain('親を外す</button>')
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
