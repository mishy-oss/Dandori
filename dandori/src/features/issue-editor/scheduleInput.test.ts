import { expect, it } from 'vitest'
import { db } from '../../db/db'
import { createIssue, getIssue, updateIssue } from '../../db/issueRepo'
import { createProject } from '../../db/projectRepo'
import { createScheduleInput, parseEndTime, scheduleInputError, updateScheduleInput } from './scheduleInput'

it('calculates the requested 10:00–17:45 placement and persists it on creation and editing', async () => {
  await Promise.all([db.projects.clear(), db.workflows.clear(), db.issues.clear(), db.recurrenceRules.clear()])
  const project = await createProject({ key: 'APP', name: 'App' })
  const schedule = updateScheduleInput(createScheduleInput('10:00', '30'), 'endTime', '17:45')
  expect(schedule.duration).toBe('465')
  expect(scheduleInputError(schedule)).toBeNull()
  const issue = await createIssue({ projectId: project.id, title: '予定', date: '2026-11-19', startMin: 600, durationMin: Number(schedule.duration) })
  expect(await getIssue(issue.id)).toMatchObject({ startMin: 600, durationMin: 465 })
  const edited = updateScheduleInput(createScheduleInput('10:00', String(issue.durationMin)), 'endTime', '18:00')
  await updateIssue(issue.id, { durationMin: Number(edited.duration) })
  expect(await getIssue(issue.id)).toMatchObject({ startMin: 600, durationMin: 480 })
})

it('recalculates the end when duration is entered, including minute precision', () => {
  const initial = createScheduleInput('10:00', '465')
  expect(initial.endTime).toBe('17:45')
  const changed = updateScheduleInput(initial, 'duration', '37')
  expect(changed.endTime).toBe('10:37')
  expect(scheduleInputError(changed)).toBeNull()
  expect(updateScheduleInput(changed, 'startTime', '11:00').endTime).toBe('11:37')
})

it('retains an explicitly entered end when the start is entered or changed', () => {
  const endFirst = updateScheduleInput(createScheduleInput('', '30'), 'endTime', '17:45')
  expect(scheduleInputError(endFirst)).toContain('開始時刻')
  const placed = updateScheduleInput(endFirst, 'startTime', '10:00')
  expect(placed.duration).toBe('465')
  expect(updateScheduleInput(placed, 'startTime', '11:00')).toMatchObject({ endTime: '17:45', duration: '405' })
})

it('supports midnight as the same-day boundary without wrapping to the next day', () => {
  expect(parseEndTime('24:00')).toBe(1440)
  const schedule = createScheduleInput('23:30', '30')
  expect(schedule.endTime).toBe('24:00')
  expect(scheduleInputError(schedule)).toBeNull()
  expect(updateScheduleInput(schedule, 'endTime', '24:00').duration).toBe('30')
  expect(scheduleInputError(updateScheduleInput(schedule, 'duration', '60'))).toContain('日付をまたぐ')
})

it('rejects invalid, earlier, equal, cleared and too-short end times', () => {
  const schedule = createScheduleInput('10:00', '30')
  for (const end of ['oops', '24:01', '25:00', '10:60', '']) {
    const changed = updateScheduleInput(schedule, 'endTime', end)
    expect(changed.duration).toBe('')
    expect(scheduleInputError(changed)).not.toBeNull()
  }
  for (const end of ['09:00', '10:00']) {
    expect(scheduleInputError(updateScheduleInput(schedule, 'endTime', end))).toContain('開始時刻より後')
  }
  expect(scheduleInputError(updateScheduleInput(schedule, 'endTime', '10:04'))).toContain('5分以上')
  expect(scheduleInputError(updateScheduleInput(schedule, 'endTime', '10:05'))).toBeNull()
})

it('clears both times when unplacing and preserves duration for the next placement', () => {
  const cleared = updateScheduleInput(createScheduleInput('10:00', '465'), 'startTime', '')
  expect(cleared).toMatchObject({ startTime: '', endTime: '', duration: '465', basis: 'duration' })
  expect(scheduleInputError(cleared)).toBeNull()
  expect(updateScheduleInput(cleared, 'startTime', '09:00').endTime).toBe('16:45')
})

it('reports invalid duration causes instead of blaming a missing end time or day boundary', () => {
  const initial = createScheduleInput('10:00', '30')
  for (const [value, message] of [['', '所要時間を入力'], ['oops', '整数'], ['30.5', '整数'], ['Infinity', '整数'], ['0', '5分以上'], ['4', '5分以上'], ['1441', '1440分']] as const) {
    const error = scheduleInputError(updateScheduleInput(initial, 'duration', value))
    expect(error).toContain(message)
    expect(error).not.toContain('終了時刻')
  }
  expect(scheduleInputError(createScheduleInput('', '0'))).toContain('5分以上')
  expect(scheduleInputError(updateScheduleInput(initial, 'endTime', ''))).toBe('終了時刻を正しく入力してください')
})

it('preserves and validates duration when end time is entered and cleared without a start time', () => {
  const entered = updateScheduleInput(createScheduleInput('', '45'), 'endTime', '12:00')
  const cleared = updateScheduleInput(entered, 'endTime', '')
  expect(cleared).toMatchObject({ startTime: '', endTime: '', duration: '45', basis: 'duration' })
  expect(scheduleInputError(cleared)).toBeNull()
  expect(scheduleInputError({ startTime: '', endTime: '', duration: '', basis: 'endTime' })).toBe('所要時間を入力してください')
})
