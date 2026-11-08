import { describe, expect, it } from 'vitest'
import { nextRecurrenceDate } from './date'

describe('nextRecurrenceDate', /* 繰り返しの種類と暦の境界をまたぐ日付計算を検証する。 */ () => {
  it('keeps daily and weekly intervals', /* 既存の日・週の間隔が維持されることを確認する。 */ () => {
    expect(nextRecurrenceDate('2027-01-31', 'daily', 2)).toBe('2027-02-02')
    expect(nextRecurrenceDate('2027-01-31', 'weekly', 2)).toBe('2027-02-14')
  })

  it('uses calendar months including multi-month intervals and year changes', /* 日数固定ではなく暦の月で進み、指定した月数と年越しを扱う。 */ () => {
    expect(nextRecurrenceDate('2027-01-15', 'monthly', 1)).toBe('2027-02-15')
    expect(nextRecurrenceDate('2027-01-31', 'monthly', 2)).toBe('2027-03-31')
    expect(nextRecurrenceDate('2027-12-31', 'monthly', 1)).toBe('2028-01-31')
  })

  it('uses the last available day without losing the original day', /* 31日や30日がない月だけ月末へ補正し、その後は元の日にちへ戻す。 */ () => {
    expect(nextRecurrenceDate('2027-01-31', 'monthly', 1)).toBe('2027-02-28')
    expect(nextRecurrenceDate('2027-02-28', 'monthly', 1, '2027-01-31')).toBe('2027-03-31')
    expect(nextRecurrenceDate('2027-02-28', 'monthly', 1, '2027-01-30')).toBe('2027-03-30')
  })

  it('handles leap years and two-month intervals after a short month', /* うるう日と、短い月を通過した後の複数月間隔を確認する。 */ () => {
    expect(nextRecurrenceDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29')
    expect(nextRecurrenceDate('2028-02-29', 'monthly', 1, '2028-01-31')).toBe('2028-03-31')
    expect(nextRecurrenceDate('2027-02-28', 'monthly', 2, '2026-12-31')).toBe('2027-04-30')
    expect(nextRecurrenceDate('2027-04-30', 'monthly', 2, '2026-12-31')).toBe('2027-06-30')
  })
})
