import { beforeEach, describe, expect, it } from 'vitest'
import { db } from './db'
import { createIssue, updateIssue } from './issueRepo'
import { createProject } from './projectRepo'
import { getSettings, updateSettings } from './settingsRepo'
import { DEFAULT_SETTINGS } from './types'

beforeEach(/* 各テストの前に使用するDBテーブルを空にし、以前のテストの保存データが結果へ影響しないようにする。 */ async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.settings.clear()])
})

describe('issue schedule', /* 「issue schedule」に関するテストをまとめて定義する。 */ () => {
  it('stores date, start and duration and allows clearing them', /* 日付・開始時刻・所要時間を保存でき、日時だけを未配置へ戻せることを検証する。 */ async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const i = await createIssue({
      projectId: p.id,
      title: 't',
      date: '2026-10-07',
      startMin: 540,
      durationMin: 45,
    })
    expect(i).toMatchObject({ date: '2026-10-07', startMin: 540, durationMin: 45 })

    const moved = await updateIssue(i.id, { startMin: 600, durationMin: 60 })
    expect(moved).toMatchObject({ startMin: 600, durationMin: 60 })

    const cleared = await updateIssue(i.id, { date: null, startMin: null })
    expect(cleared).toMatchObject({ date: null, startMin: null, durationMin: 60 })
  })

  it('rejects invalid schedules', /* 日付なしの開始時刻、不正な日付、範囲外の時刻や所要時間を拒否することを検証する。 */ async () => {
    const p = await createProject({ key: 'APP', name: 'App' })
    const i = await createIssue({ projectId: p.id, title: 't' })
    await expect(updateIssue(i.id, { startMin: 600 })).rejects.toThrow() // 日付なし
    await expect(updateIssue(i.id, { date: 'bad' })).rejects.toThrow()
    await expect(updateIssue(i.id, { date: '2026-10-07', startMin: 1440 })).rejects.toThrow()
    await expect(updateIssue(i.id, { date: '2026-10-07', startMin: -5 })).rejects.toThrow()
    await expect(updateIssue(i.id, { date: '2026-10-07', startMin: 1400, durationMin: 60 })).rejects.toThrow()
    await expect(updateIssue(i.id, { durationMin: 0 })).rejects.toThrow()
    await expect(
      createIssue({ projectId: p.id, title: 'x', startMin: 600 }),
    ).rejects.toThrow()
  })
})

describe('settings', /* 「settings」に関するテストをまとめて定義する。 */ () => {
  it('returns defaults and persists updates', /* 未保存なら既定設定を返し、変更した設定が永続化されることを検証する。 */ async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
    await updateSettings({ dayStartHour: 8, weekStartsOn: 0 })
    expect(await getSettings()).toMatchObject({ dayStartHour: 8, dayEndHour: 24, weekStartsOn: 0 })
  })

  it('validates values', /* 設定値が許容範囲外ならエラーとなり、既存設定が書き換わらないことを検証する。 */ async () => {
    await expect(updateSettings({ dayStartHour: 24 })).rejects.toThrow()
    await expect(updateSettings({ dayEndHour: 0 })).rejects.toThrow()
    await expect(updateSettings({ dayStartHour: 10, dayEndHour: 10 })).rejects.toThrow()
    await expect(updateSettings({ defaultDuration: 3 })).rejects.toThrow()
    await expect(updateSettings({ weekStartsOn: 3 as 0 })).rejects.toThrow()
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })
})
