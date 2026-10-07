import { describe, expect, it } from 'vitest'
import type { Issue } from '../../db/types'
import { EMPTY_FILTER, isFilterActive, matchesFilter } from './filters'

const issue = (over: Partial<Issue>): Issue =>
  ({ number: 12, title: 'ログイン画面を作る', labels: ['ui', 'Auth'], priority: 'medium', type: 'task', ...over }) as Issue

describe('matchesFilter', () => {
  it('matches everything with the empty filter', () => {
    expect(matchesFilter(issue({}), EMPTY_FILTER)).toBe(true)
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })

  it('searches title, number and labels case-insensitively', () => {
    const f = (query: string) => ({ ...EMPTY_FILTER, query })
    expect(matchesFilter(issue({}), f('ログイン'))).toBe(true)
    expect(matchesFilter(issue({}), f('#12'))).toBe(true)
    expect(matchesFilter(issue({}), f('#13'))).toBe(false)
    expect(matchesFilter(issue({}), f('auth'))).toBe(true)
    expect(matchesFilter(issue({}), f('  '))).toBe(true)
    expect(matchesFilter(issue({}), f('なし'))).toBe(false)
  })

  it('combines priority and type filters with the query', () => {
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'high' })).toBe(false)
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'medium', type: 'task' })).toBe(true)
    expect(matchesFilter(issue({}), { query: 'ログイン', priority: 'all', type: 'bug' })).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, type: 'bug' })).toBe(true)
  })
})
