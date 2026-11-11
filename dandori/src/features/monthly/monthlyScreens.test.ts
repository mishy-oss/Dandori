import { beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDataStore } from '../../store/data'
import { BoardScreen } from '../board/BoardScreen'
import { BacklogScreen } from '../backlog/BacklogScreen'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { SettingsScreen } from '../settings/SettingsScreen'
import { TimelineScreen } from '../timeline/TimelineScreen'
import type { Issue } from '../../db/types'

vi.mock('../../store/data', /* サーバー描画では初期状態が使われるため、フックの読み取りだけをテストの現在状態へ差し替える。 */ async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/data')>()
  /** 購読を行わず、準備したテスト用データから画面が選択する値を返す。 */
  function useTestState<T>(selector: (state: ReturnType<typeof actual.useDataStore.getState>) => T): T {
    return selector(actual.useDataStore.getState())
  }
  return { ...actual, useDataStore: Object.assign(useTestState, actual.useDataStore) }
})

beforeEach(/* スプリントが存在しない状態でも月次画面を表示できるよう、最小の画面データを用意する。 */ () => {
  useDataStore.setState({
    ...useDataStore.getInitialState(), ready: true, selectedMonth: '2027-01', currentProjectId: 'project',
    projects: [{ id: 'project', key: 'APP', name: 'App', color: '#38bdf8', workflowId: 'workflow', nextNumber: 1, createdAt: 0, updatedAt: 0, deletedAt: null }],
    workflows: { workflow: { id: 'workflow', statuses: [{ id: 'todo', name: 'To Do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }], createdAt: 0, updatedAt: 0, deletedAt: null } },
  }, true)
})

it('shows monthly planning without any sprint controls', /* ボードとタスク一覧に月次機能があり、スプリントの開始・作成操作が残っていないことを確認する。 */ () => {
  for (const Screen of [BoardScreen, BacklogScreen]) {
    const html = renderToStaticMarkup(createElement(Screen))
    expect(html).toContain('対象月')
    expect(html).toContain('月次バーンダウン')
    expect(html).not.toContain('スプリント')
  }
})

/** 見出しと操作項目は日本語、種別・優先度・ステータスの選択肢は英語で表示することを確認する。 */
it('uses Japanese headings while preserving English option values', () => {
  vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
  try {
    for (const [Screen, title] of [[BoardScreen, 'ボード'], [BacklogScreen, 'タスク'], [SettingsScreen, '設定']] as const) {
      const html = renderToStaticMarkup(createElement(Screen))
      expect(html).toContain(`>${title}</h1>`)
      expect(html).toMatch(/[\u3040-\u30ff\u4e00-\u9fff]/)
    }
    const settings = renderToStaticMarkup(createElement(SettingsScreen))
    expect(settings).toContain('テーマ</h2>')
    expect(settings).toContain('システム')
    expect(settings).toContain('迷ったらtaskで大丈夫です。')
    const timeline = renderToStaticMarkup(createElement(TimelineScreen))
    expect(timeline).toContain('今日へ')
    const editor = renderToStaticMarkup(createElement(IssueEditor, { issue: null, onClose: () => {} }))
    expect(editor).toContain('新規タスク')
    expect(editor).toContain('保存')
    expect(editor).toContain('タイトル')
    expect(editor).toContain('キャンセル')
    for (const value of ['task', 'bug', 'story', 'epic', 'urgent', 'highest', 'high', 'midium', 'low', 'To Do', 'Done']) {
      expect(editor).toContain(`>${value}</option>`)
    }
    for (const html of [editor, renderToStaticMarkup(createElement(BacklogScreen))]) {
      const labels = ['urgent', 'highest', 'high', 'midium', 'low']
      const positions = labels.map((label) => html.indexOf(`>${label}</option>`))
      expect(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]))).toBe(true)
      expect(html).toMatch(/value="medium"[^>]*>midium<\/option>/)
    }
  } finally {
    vi.unstubAllGlobals()
  }
})

it('creates tasks for a month instead of a sprint', /* 新規タスク作成画面に対象月入力があることを確認する。 */ () => {
  const html = renderToStaticMarkup(createElement(IssueEditor, {
    issue: null, defaultPlanningMonth: '2027-01',
    /** 描画の確認では閉じる操作を実行しない。 */
    onClose: () => {},
  }))
  expect(html).toContain('type="month"')
  expect(html).toContain('2027-01')
  expect(html).not.toContain('スプリント')
})

/** 新しい列がボードに表示され、作成画面で定期タスクを選択・説明できることを確認する。 */
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

/** 両画面で同じ繰り返しを表示するための、月付きタスクを用意する。 */
function recurringTask(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, title: '日課', type: 'task', priority: 'medium', statusId: 'todo',
    parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: '2027-01', rank: id,
    date: '2027-01-01', startMin: null, durationMin: 30, icon: '', color: '#38bdf8', reminderOffsetMin: null,
    recurrenceId: 'daily', assigneeId: null, completedAt: null, createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

/** 月をまたぐ親の名前と子の進捗をボードへ表示し、編集画面に関連タスクを開く操作を用意する。 */
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
  const childEditor = renderToStaticMarkup(createElement(IssueEditor, { issue: child, onClose: () => {} }))
  expect(childEditor).toContain('親タスクを編集')
})

it('uses the same recurring cards in the task tab and board', /* タスク側も同じルールの回だけをまとめ、編集・展開ボタンと完了数を表示することを確認する。 */ () => {
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
  expect(tasks).toContain('3件表示 / 4タスク')
})
