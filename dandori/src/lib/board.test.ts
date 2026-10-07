import { describe, expect, it } from 'vitest'
import type { Issue } from '../db/types'
import { computeDropIndex, swipeTargetIndex, wipStatus } from '../features/board/boardLogic'
import { applyMove } from './issueOrder'

function issue(id: string, statusId: string): Issue {
  return { id, statusId } as Issue
}

describe('computeDropIndex', () => {
  it('counts cards whose midpoint is above the pointer', () => {
    const mids = [50, 150, 250]
    expect(computeDropIndex(mids, 10)).toBe(0)
    expect(computeDropIndex(mids, 100)).toBe(1)
    expect(computeDropIndex(mids, 200)).toBe(2)
    expect(computeDropIndex(mids, 999)).toBe(3)
    expect(computeDropIndex([], 100)).toBe(0)
  })
})

describe('swipeTargetIndex', () => {
  it('ignores short swipes', () => {
    expect(swipeTargetIndex(1, -79, 3)).toBeNull()
    expect(swipeTargetIndex(1, 79, 3)).toBeNull()
  })
  it('left = next, right = previous', () => {
    expect(swipeTargetIndex(1, -100, 3)).toBe(2)
    expect(swipeTargetIndex(1, 100, 3)).toBe(0)
  })
  it('stops at both ends', () => {
    expect(swipeTargetIndex(2, -100, 3)).toBeNull()
    expect(swipeTargetIndex(0, 100, 3)).toBeNull()
  })
})

describe('wipStatus', () => {
  it('warns only when strictly above the limit', () => {
    expect(wipStatus(3, 3)).toEqual({ over: false, label: '3/3' })
    expect(wipStatus(4, 3)).toEqual({ over: true, label: '4/3' })
    expect(wipStatus(9, undefined)).toEqual({ over: false, label: null })
  })
})

describe('applyMove', () => {
  const base = [issue('a', 'todo'), issue('b', 'doing'), issue('c', 'todo'), issue('d', 'todo')]
  const ids = (l: Issue[]) => l.map((i) => `${i.id}:${i.statusId}`)

  it('reorders within a column', () => {
    expect(ids(applyMove(base, 'd', 'todo', 0))).toEqual(['d:todo', 'a:todo', 'b:doing', 'c:todo'])
    expect(ids(applyMove(base, 'a', 'todo', 1))).toEqual(['b:doing', 'c:todo', 'a:todo', 'd:todo'])
    expect(ids(applyMove(base, 'a', 'todo', 99))).toEqual(['b:doing', 'c:todo', 'd:todo', 'a:todo'])
  })

  it('moves across columns, including into an empty column', () => {
    const r = applyMove(base, 'a', 'doing', 0)
    expect(r.filter((i) => i.statusId === 'doing').map((i) => i.id)).toEqual(['a', 'b'])
    const e = applyMove(base, 'a', 'done', 0)
    expect(e.find((i) => i.id === 'a')?.statusId).toBe('done')
    expect(e).toHaveLength(4)
  })

  it('returns the same list for unknown ids', () => {
    expect(applyMove(base, 'zzz', 'todo', 0)).toBe(base)
  })
})
