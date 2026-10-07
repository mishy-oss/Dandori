import { describe, expect, it } from 'vitest'
import {
  clampMove,
  clampResize,
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
const b = (id: string, startMin: number, durationMin: number): Placed => ({ id, startMin, durationMin })
const byId = (l: ReturnType<typeof layoutBlocks>) => Object.fromEntries(l.map((x) => [x.id, [x.column, x.columns]]))

describe('coordinates', () => {
  it('converts minutes to y and back with 15-minute snapping', () => {
    expect(minToY(360, range)).toBe(0)
    expect(minToY(420, range)).toBeCloseTo(72)
    expect(yToMin(0, range)).toBe(360)
    expect(yToMin(72, range)).toBe(420)
    expect(yToMin(72 + 5, range)).toBe(420)
    expect(yToMin(72 + 12, range)).toBe(435)
  })

  it('snaps and clamps moves and resizes', () => {
    expect(snap(7)).toBe(0)
    expect(snap(8)).toBe(15)
    expect(clampMove(100, 60, range)).toBe(360)
    expect(clampMove(1430, 60, range)).toBe(1380)
    expect(clampMove(610, 60, range)).toBe(615)
    expect(clampResize(5, 600, range)).toBe(15)
    expect(clampResize(9999, 600, range)).toBe(840)
    expect(clampResize(50, 600, range)).toBe(45)
  })

  it('formats and parses times', () => {
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

describe('visibleRange', () => {
  it('uses the settings range and widens for blocks outside it', () => {
    expect(visibleRange(6, 24, [])).toEqual({ startMin: 360, endMin: 1440 })
    expect(visibleRange(9, 18, [b('a', 300, 30), b('b', 1100, 100)])).toEqual({ startMin: 300, endMin: 1200 })
    expect(visibleRange(9, 18, [b('a', 600, 30)])).toEqual({ startMin: 540, endMin: 1080 })
  })
})

describe('layoutBlocks', () => {
  it('gives non-overlapping blocks the full width', () => {
    const l = byId(layoutBlocks([b('a', 600, 30), b('b', 630, 30), b('c', 700, 30)]))
    expect(l).toEqual({ a: [0, 1], b: [0, 1], c: [0, 1] })
  })

  it('splits overlapping blocks into columns', () => {
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 630, 60)]))
    expect(l).toEqual({ a: [0, 2], b: [1, 2] })
  })

  it('reuses a free column inside a cluster and sizes by the widest point', () => {
    // a(10:00-11:00) b(10:15-10:45) c(10:50-11:30): c fits under b's column
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 615, 30), b('c', 650, 40)]))
    expect(l).toEqual({ a: [0, 2], b: [1, 2], c: [1, 2] })
  })

  it('separates clusters', () => {
    const l = byId(layoutBlocks([b('a', 600, 60), b('b', 610, 30), b('c', 660, 30), b('d', 665, 30)]))
    expect(l.a).toEqual([0, 2])
    expect(l.c).toEqual([0, 2])
    expect(l.d).toEqual([1, 2])
  })

  it('is stable for identical start times and handles empty input', () => {
    expect(layoutBlocks([])).toEqual([])
    const l = layoutBlocks([b('b', 600, 30), b('a', 600, 30)])
    expect(l.map((x) => x.id)).toEqual(['a', 'b'])
    expect(l.every((x) => x.columns === 2)).toBe(true)
  })
})

describe('weekDays', () => {
  it('returns seven days from the configured week start', () => {
    expect(weekDays('2026-10-07', 1)).toEqual([
      '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11',
    ])
    expect(weekDays('2026-10-07', 0)[0]).toBe('2026-10-04')
    expect(weekDays('2026-10-04', 0)[0]).toBe('2026-10-04')
  })
})
