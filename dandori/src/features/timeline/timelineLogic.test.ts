import { describe, expect, it } from 'vitest'
import {
  clampMove,
  clampResize,
  clampResizeTop,
  formatMin,
  layoutBlocks,
  minToY,
  nowMin,
  parseTime,
  snap,
  visibleRange,
  weekDays,
  yToMin,
  type Placed,
} from './timelineLogic'

const range = { startMin: 360, endMin: 1440 }
/** 重なり配置のテストで使う、ID・開始時刻・所要時間を持つ予定データを作る。 */
const b = (id: string, startMin: number, durationMin: number): Placed => ({ id, startMin, durationMin })
/** 配置計算の結果を、IssueのIDから列番号と列数を参照できるオブジェクトへ変換する。 */
const byId = (l: ReturnType<typeof layoutBlocks>) => Object.fromEntries(l.map(/* 配置結果のIDと列番号・列数の組を作り、テストで期待する配置と比較できるようにする。 */ (x) => [x.id, [x.column, x.columns]]))

describe('coordinates', /* 「coordinates」に関するテストをまとめて定義する。 */ () => {
  it('converts minutes to y and back with 15-minute snapping', /* 時刻とY座標を相互変換でき、座標から求めた時刻が15分刻みになることを検証する。 */ () => {
    expect(minToY(360, range)).toBe(0)
    expect(minToY(420, range)).toBeCloseTo(168)
    expect(yToMin(0, range)).toBe(360)
    expect(yToMin(168, range)).toBe(420)
    expect(yToMin(168 + 14, range)).toBe(420)
    expect(yToMin(168 + 28, range)).toBe(435)
  })

  it('snaps and clamps moves and resizes', /* 移動やリサイズが15分刻みと表示範囲・最短時間の制約に従うことを検証する。 */ () => {
    expect(snap(7)).toBe(0)
    expect(snap(8)).toBe(15)
    expect(clampMove(100, 60, range)).toBe(360)
    expect(clampMove(1430, 60, range)).toBe(1380)
    expect(clampMove(610, 60, range)).toBe(615)
    expect(clampResize(5, 600, range)).toBe(15)
    expect(clampResize(9999, 600, range)).toBe(840)
    expect(clampResize(50, 600, range)).toBe(45)
  })

  it('resizes from the top edge keeping the end fixed', /* 上端リサイズで終了時刻を維持し、開始時刻と所要時間だけが制約内で変わることを検証する。 */ () => {
    const base = { startMin: 600, durationMin: 60 } // 10:00-11:00
    // 上へ30分 -> 09:30-11:00
    expect(clampResizeTop(570, base, range)).toEqual({ startMin: 570, durationMin: 90 })
    // 下へ縮める
    expect(clampResizeTop(630, base, range)).toEqual({ startMin: 630, durationMin: 30 })
    // 動かさなければそのまま
    expect(clampResizeTop(600, base, range)).toEqual({ startMin: 600, durationMin: 60 })
    // 15分スナップ
    expect(clampResizeTop(607, base, range)).toEqual({ startMin: 600, durationMin: 60 })
    expect(clampResizeTop(608, base, range)).toEqual({ startMin: 615, durationMin: 45 })
    // 最短15分: 終了の15分前まで
    expect(clampResizeTop(900, base, range)).toEqual({ startMin: 645, durationMin: 15 })
    // 表示範囲の上端(06:00)まで
    expect(clampResizeTop(100, base, range)).toEqual({ startMin: 360, durationMin: 300 })
    // 終了は常に不変
    for (const s of [360, 420, 599, 640, 700]) {
      const r = clampResizeTop(s, base, range)
      expect(r.startMin + r.durationMin).toBe(660)
    }
  })

  it('formats and parses times', /* 時刻の表示・解析・分数への変換が正しく、不正な時刻を拒否することを検証する。 */ () => {
    expect(formatMin(0)).toBe('00:00')
    expect(formatMin(545)).toBe('09:05')
    expect(parseTime('09:05')).toBe(545)
    expect(parseTime('9:05')).toBe(545)
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('09:60')).toBeNull()
    expect(parseTime('')).toBeNull()
    expect(nowMin(new Date(2026, 9, 7, 13, 45))).toBe(825)
  })
})

describe('visibleRange', /* 「visibleRange」に関するテストをまとめて定義する。 */ () => {
  it('uses the settings range and widens for blocks outside it', /* 既定では設定の時間帯を使い、範囲外の予定があると必要な分だけ時間軸を広げることを検証する。 */ () => {
    expect(visibleRange(6, 24, [])).toEqual({ startMin: 360, endMin: 1440 })
    expect(visibleRange(9, 18, [b('a', 300, 30), b('b', 1100, 100)])).toEqual({ startMin: 300, endMin: 1200 })
    expect(visibleRange(9, 18, [b('a', 600, 30)])).toEqual({ startMin: 540, endMin: 1080 })
  })
})

describe('layoutBlocks', /* 「layoutBlocks」に関するテストをまとめて定義する。 */ () => {
  it('gives non-overlapping blocks the full width', /* 時間が重ならない予定を、それぞれ1列の全幅で表示できることを検証する。 */ () => {
    const l = byId(layoutBlocks([b('a', 600, 30), b('b', 630, 30), b('c', 700, 30)]))
    expect(l).toEqual({ a: [0, 1], b: [0, 1], c: [0, 1] })
  })

  it('splits overlapping blocks into columns', /* 時間が重なる予定に別々の列を割り当てることを検証する。 */ () => {
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 630, 60)]))
    expect(l).toEqual({ a: [0, 2], b: [1, 2] })
  })

  it('reuses a free column inside a cluster and sizes by the widest point', /* 重なりグループ内の空いた列を再利用し、最大同時列数を幅計算に使うことを検証する。 */ () => {
    // a(10:00-11:00) b(10:15-10:45) c(10:50-11:30): c fits under b's column
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 615, 30), b('c', 650, 40)]))
    expect(l).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] })
  })

  it('separates clusters', /* 時間がつながらない重なりグループを分け、それぞれで列配置を計算することを検証する。 */ () => {
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 610, 30), b('c', 660, 30), b('d', 665, 30)]))
    expect(l.a).toEqual([0, 2])
    expect(l.c).toEqual([0, 2])
    expect(l.d).toEqual([1, 2])
  })

  it('is stable for identical start times and handles empty input', /* 空の予定配列を扱え、開始時刻が同じでもIDに従って安定した列配置になることを検証する。 */ () => {
    expect(layoutBlocks([])).toEqual([])
    const l = layoutBlocks([b('b', 600, 30), b('a', 600, 30)])
    expect(l.map(/* 各要素からIDだけを取り出す。 */ (x) => x.id)).toEqual(['a', 'b'])
    expect(l.every(/* 同時刻に始まる2つの予定が、両方とも2列構成で配置されているかを判定する。 */ (x) => x.columns === 2)).toBe(true)
  })
})

describe('weekDays', /* 「weekDays」に関するテストをまとめて定義する。 */ () => {
  it('returns seven days from the configured week start', /* 月曜始まり・日曜始まりの設定に従って、週の先頭から7日分を返すことを検証する。 */ () => {
    expect(weekDays('2026-10-07', 1)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ])
    expect(weekDays('2026-10-07', 0)[0]).toBe('2026-10-04')
    expect(weekDays('2026-10-04', 0)[0]).toBe('2026-10-04')
  })
})
