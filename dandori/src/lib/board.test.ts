import { describe, expect, it } from 'vitest'
import type { Issue } from '../db/types'
import { computeDropIndex, swipeTargetIndex, wipStatus } from '../features/board/boardLogic'
import { applyMove } from './issueOrder'

/** 並べ替えテストで必要なIDとステータスを持つ最小限のIssueデータを作る。 */
function issue(id: string, statusId: string): Issue {
  return { id, statusId } as Issue
}

describe('computeDropIndex', /* 「computeDropIndex」に関するテストをまとめて定義する。 */ () => {
  it('counts cards whose midpoint is above the pointer', /* ポインターより上に中央位置があるカード数から、ドロップ挿入位置を求めることを検証する。 */ () => {
    const mids = [50, 150, 250]
    expect(computeDropIndex(mids, 10)).toBe(0)
    expect(computeDropIndex(mids, 100)).toBe(1)
    expect(computeDropIndex(mids, 200)).toBe(2)
    expect(computeDropIndex(mids, 999)).toBe(3)
    expect(computeDropIndex([], 100)).toBe(0)
  })
})

describe('swipeTargetIndex', /* 「swipeTargetIndex」に関するテストをまとめて定義する。 */ () => {
  it('ignores short swipes', /* 移動のしきい値に満たない短いスワイプでは列を切り替えないことを検証する。 */ () => {
    expect(swipeTargetIndex(1, -79, 3)).toBeNull()
    expect(swipeTargetIndex(1, 79, 3)).toBeNull()
  })
  it('left = next, right = previous', /* 左スワイプで次の列、右スワイプで前の列を選ぶことを検証する。 */ () => {
    expect(swipeTargetIndex(1, -100, 3)).toBe(2)
    expect(swipeTargetIndex(1, 100, 3)).toBe(0)
  })
  it('stops at both ends', /* 先頭列より前、末尾列より後へのスワイプ移動を行わないことを検証する。 */ () => {
    expect(swipeTargetIndex(2, -100, 3)).toBeNull()
    expect(swipeTargetIndex(0, 100, 3)).toBeNull()
  })
})

describe('wipStatus', /* 「wipStatus」に関するテストをまとめて定義する。 */ () => {
  it('warns only when strictly above the limit', /* 作業数が上限と同じなら許容し、上限を超えたときだけ警告対象になることを検証する。 */ () => {
    expect(wipStatus(3, 3)).toEqual({ over: false, label: '3/3' })
    expect(wipStatus(4, 3)).toEqual({ over: true, label: '4/3' })
    expect(wipStatus(9, undefined)).toEqual({ over: false, label: null })
  })
})

describe('applyMove', /* 「applyMove」に関するテストをまとめて定義する。 */ () => {
  const base = [issue('a', 'todo'), issue('b', 'doing'), issue('c', 'todo'), issue('d', 'todo')]
  /** Issue配列からIDだけを順番に抜き出し、移動結果の並びを比較しやすくする。 */
  const ids = (l: Issue[]) => l.map(/* IssueのIDとステータスを1つの文字列にし、列をまたぐ移動の順番と所属を比較する。 */ (i) => `${i.id}:${i.statusId}`)

  it('reorders within a column', /* 同じ列の先頭・途中・末尾へIssueを正しく並べ替えられることを検証する。 */ () => {
    expect(ids(applyMove(base, 'd', 'todo', 0))).toEqual(['d:todo', 'a:todo', 'b:doing', 'c:todo'])
    expect(ids(applyMove(base, 'a', 'todo', 1))).toEqual(['b:doing', 'c:todo', 'a:todo', 'd:todo'])
    expect(ids(applyMove(base, 'a', 'todo', 99))).toEqual(['b:doing', 'c:todo', 'd:todo', 'a:todo'])
  })

  it('moves across columns, including into an empty column', /* 空の列を含む別ステータスへの移動で、所属と配列内の順序が正しく更新されることを検証する。 */ () => {
    const r = applyMove(base, 'a', 'doing', 0)
    expect(r.filter(/* 指定ステータスと一致という条件を満たす要素だけを残す。 */ (i) => i.statusId === 'doing').map(/* 各要素からIDだけを取り出す。 */ (i) => i.id)).toEqual(['a', 'b'])
    const e = applyMove(base, 'a', 'done', 0)
    expect(e.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (i) => i.id === 'a')?.statusId).toBe('done')
    expect(e).toHaveLength(4)
  })

  it('returns the same list for unknown ids', /* 移動対象のIDが見つからなければ、元の配列をそのまま返すことを検証する。 */ () => {
    expect(applyMove(base, 'zzz', 'todo', 0)).toBe(base)
  })
})
