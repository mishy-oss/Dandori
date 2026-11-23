import { expect, it } from 'vitest'
import { buildPushSchedules, MAX_PUSH_TITLE_LENGTH } from './pushClient'

it('filters out tasks outside Worker limits and trims long titles', () => {
  const now = new Date(2026, 4, 1, 9, 0, 0).getTime()
  const doneIds = new Set(['done'])
  const base = { statusId: 'todo', reminderOffsetMin: 0, carryoverToId: undefined }
  const result = buildPushSchedules([
    { ...base, id: 'ok', title: '定例会議', date: '2026-05-01', startMin: 600 },
    { ...base, id: 'long', title: `  ${'あ'.repeat(150)}  `, date: '2026-05-02', startMin: 600 },
    { ...base, id: 'blank', title: '   ', date: '2026-05-02', startMin: 660 },
    { ...base, id: 'too-far', title: '2年後の予定', date: '2028-05-02', startMin: 600 },
    { ...base, id: 'past', title: '過去の予定', date: '2026-05-01', startMin: 480 },
    { ...base, id: 'done-item', title: '完了済み', statusId: 'done', date: '2026-05-02', startMin: 720 },
    { ...base, id: 'carried', title: '持ち越し済み', carryoverToId: 'next', date: '2026-05-02', startMin: 780 },
  ], doneIds, now)

  expect(result.map((item) => item.id)).toEqual(['ok', 'long'])
  expect(result[1].title).toHaveLength(MAX_PUSH_TITLE_LENGTH)
})
