import { beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { useDataStore } from '../../store/data'
import { BoardScreen } from '../board/BoardScreen'
import { BacklogScreen } from '../backlog/BacklogScreen'
import { IssueEditor } from '../issue-editor/IssueEditor'

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
