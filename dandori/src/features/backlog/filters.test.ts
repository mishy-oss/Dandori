import { describe, expect, it } from 'vitest'
import type { Issue } from '../../db/types'
import { EMPTY_FILTER, isFilterActive, matchesFilter } from './filters'

const issue = (over: Partial<Issue>): Issue =>
  ({ number: 12, title: 'ログイン画面を作る', labels: ['ui', 'Auth'], priority: 'medium', type: 'task', ...over }) as Issue

describe('matchesFilter', () => {
  it('matches everything with the empty filter', () => {
    expect(matchesFilter(issue({}), EMPTY_FILTER, 'APP')).toBe(true)
    expect(isFilterActive(EMPTY_FILTER)).toBe(false)
  })

  it('searches title, key and labels case-insensitively', () => {
    const f = (query: string) => ({ ...EMPTY_FILTER, query })
    expect(matchesFilter(issue({}), f('ログイン'), 'APP')).toBe(true)
    expect(matchesFilter(issue({}), f('app-12'), 'APP')).toBe(true)
    expect(matchesFilter(issue({}), f('auth'), 'APP')).toBe(true)
    expect(matchesFilter(issue({}), f('  '), 'APP')).toBe(true)
    expect(matchesFilter(issue({}), f('なし'), 'APP')).toBe(false)
  })

  it('combines priority and type filters with the query', () => {
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'high' }, 'APP')).toBe(false)
    expect(matchesFilter(issue({}), { ...EMPTY_FILTER, priority: 'medium', type: 'task' }, 'APP')).toBe(true)
    expect(matchesFilter(issue({}), { query: 'ログイン', priority: 'all', type: 'bug' }, 'APP')).toBe(false)
    expect(isFilterActive({ ...EMPTY_FILTER, type: 'bug' })).toBe(true)
  })
})
