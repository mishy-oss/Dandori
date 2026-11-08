import { describe, expect, it } from 'vitest'
import type { Issue } from '../../db/types'
import { EMPTY_FILTER, isFilterActive, matchesFilter } from './filters'

/** 検索条件のテスト用に、指定した項目で上書きできるIssueデータを作る。 */
const issue = (over: Partial<Issue>): Issue =>
  ({ number: 12, title: 'ログイン画面を作る', labels: ['ui', 'Auth'], priority: 'medium', type: 'task', ...over }) as Issue

describe('matchesFilter', /* 「matchesFilter」に関するテストをまとめて定義する。 */ () => {
  it('matches everything with the empty filter', /* 検索条件が空ならすべてのIssueに一致し、絞り込みなしと判定されることを検証する。 */ () => {
    expect(matchesFilter(issue({}), EMPTY_FILTER)).toBe(true)
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })

  it('searches title, number and labels case-insensitively', /* タイトル・番号・ラベルを検索でき、英字の大小文字や空白だけの検索語を適切に扱うことを検証する。 */ () => {
    /** 指定された検索語を既定の検索条件へ設定し、検索テスト用のフィルターを作る。 */
    const f = (query: string) => ({ ...EMPTY_FILTER, query })
    expect(matchesFilter(issue({}), f('ログイン'))).toBe(true)
    expect(matchesFilter(issue({}), f('#12'))).toBe(true)
    expect(matchesFilter(issue({}), f('#13'))).toBe(false)
    expect(matchesFilter(issue({}), f('auth'))).toBe(true)
    expect(matchesFilter(issue({}), f('  '))).toBe(true)
    expect(matchesFilter(issue({}), f('なし'))).toBe(false)
  })

  it('combines priority and type filters with the query', /* 検索語と優先度・種別の条件を組み合わせて絞り込めることを検証する。 */ () => {
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'high' })).toBe(false)
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'medium', type: 'task' })).toBe(true)
    expect(matchesFilter(issue({}), { query: 'ログイン', priority: 'all', type: 'bug' })).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, type: 'bug' })).toBe(true)
  })
})
