import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import type { Issue } from '../../db/types'
import { groupBoardIssues, groupedDropIndex } from './recurringGroups'
import { RecurringBoardCard } from './RecurringBoardCard'

/** グループ化テストに必要なIssueを作る。保存済みデータと同じ既定値を補う。 */
function issue(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, type: 'task', title: '毎日の確認', statusId: 'todo', priority: 'medium', parentId: null,
    labels: [], dueDate: null, estimateMin: null, sprintId: 'sprint', rank: id, date: '2027-01-01', startMin: null, durationMin: 30,
    icon: '', color: '#38bdf8', reminderOffsetMin: null, recurrenceId: null, assigneeId: null, completedAt: null,
    createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

const doneIds = new Set(['done'])

describe('groupBoardIssues', /* 同じ繰り返しの回だけが、1枚のカードへまとまることを検証する。 */ () => {
  it('collects all occurrences across statuses into one card', /* 14回分をまとめ、日付の早い未完了回を代表にする。 */ () => {
    const occurrences = Array.from({ length: 14 }, /* 日付順とは逆の順番で入力データを用意する。 */ (_, index) => issue(`r${index}`, {
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

  it('does not combine identical titles without the same rule and scope', /* タイトルが同じでも通常Issueや別ルール・別所属のタスクを混ぜない。 */ () => {
    const issues = [
      issue('a'), issue('b'),
      issue('c', { recurrenceId: 'one' }), issue('d', { recurrenceId: 'two' }),
      issue('e', { recurrenceId: 'one', sprintId: 'other' }),
      issue('f', { recurrenceId: 'one', projectId: 'other' }),
    ]
    expect(groupBoardIssues(issues, doneIds)).toHaveLength(6)
  })

  it('keeps a stable group key when the representative completes', /* 代表が変わっても同じカードとして扱い、全完了後は完了列に置く。 */ () => {
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

  it('ignores deleted occurrences and places undated ones last', /* 削除済みの回は除き、日付なしの回は日付ありの後に並べる。 */ () => {
    const [group] = groupBoardIssues([
      issue('a', { recurrenceId: 'daily', date: null }),
      issue('b', { recurrenceId: 'daily', date: '2027-01-03' }),
      issue('c', { recurrenceId: 'daily', deletedAt: 1 }),
    ], doneIds)
    expect(group.occurrences.map(/* 残った回の順序を確認する。 */ (item) => item.id)).toEqual(['b', 'a'])
    expect(group.issue.id).toBe('b')
  })
})

describe('groupedDropIndex', /* 表示が1枚にまとまっても通常カードの挿入先がずれないことを検証する。 */ () => {
  const issues = [issue('a', { recurrenceId: 'daily' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' }), issue('c'), issue('d')]

  it('converts visible positions into underlying issue positions', /* 非表示の2回目も数え、通常カードをグループの後へ正しく置く。 */ () => {
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 0)).toBe(0)
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 1)).toBe(2)
    expect(groupedDropIndex(issues, doneIds, 'd', 'todo', 2)).toBe(3)
    expect(groupedDropIndex(issues, doneIds, 'd', 'doing', 0)).toBe(0)
  })

  it('counts hidden occurrences belonging to a group shown in another column', /* 別の列に代表がある場合も、保存先列の実Issue数を使う。 */ () => {
    const mixed = [issue('a', { recurrenceId: 'daily', statusId: 'doing' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' }), issue('c'), issue('d')]
    expect(groupedDropIndex(mixed, doneIds, 'd', 'todo', 0)).toBe(1)
    expect(groupedDropIndex(mixed, doneIds, 'd', 'todo', 1)).toBe(2)
  })
})

it('renders one collapsed summary with progress and occurrence controls', /* 初期状態が折りたたみで、各回の編集・完了・ステータス変更が提供されることを確認する。 */ () => {
  const group = groupBoardIssues([issue('a', { recurrenceId: 'daily', statusId: 'done' }), issue('b', { recurrenceId: 'daily', date: '2027-01-02' })], doneIds)[0]
  const html = renderToStaticMarkup(createElement(RecurringBoardCard, {
    group, doneIds, statuses: [{ id: 'todo', name: 'To Do', category: 'todo' }, { id: 'done', name: 'Done', category: 'done' }], pulse: false,
    /** 描画だけを検証するため、編集処理は実行しない。 */
    onOpen: () => {},
    /** 描画テストではデータ更新を行わない。 */
    onToggleDone: async () => {},
    /** 描画テストではステータスを保存しない。 */
    onChangeStatus: async () => {},
  }))
  expect(html).toContain('aria-expanded="false"')
  expect(html).toContain('aria-label="毎日の確認を編集"')
  expect(html).toContain('aria-label="毎日の確認の繰り返し一覧を開く"')
  expect(html).toContain('完了 1/2')
  expect(html).toContain('次の1件を完了')
  expect(html).toContain('hidden=""')
  expect(html).toContain('のステータス')
  expect(html).toContain('data-no-drag="true"')
})
