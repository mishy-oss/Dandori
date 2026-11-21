import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import type { Issue } from '../../db/types'
import { TimelineGrid } from './TimelineGrid'
import type { TimelineDrag } from './useTimelineGestures'

function task(id: string, patch: Partial<Issue> = {}): Issue {
  return { id, title: `予定${id}`, startMin: 600, durationMin: 465, statusId: 'todo', color: '#38bdf8', icon: '', recurrenceId: null, ...patch } as Issue
}
function render(blocks: Issue[], drag: TimelineDrag | null = null) {
  return renderToStaticMarkup(createElement(TimelineGrid, {
    blocks, drag, gridRef: createRef<HTMLDivElement>(), range: { startMin: 360, endMin: 1440 }, trayDurationMin: 30,
    nowMin: null, doneIds: new Set(['done']), onCreateAt: () => {}, onOpen: () => {}, onToggleDone: () => {}, shouldSuppressClick: () => false,
  }))
}

it('gives two fully overlapping long tasks readable top content and independent edit and completion targets', () => {
  const html = render([task('a'), task('b')])
  expect(html.match(/sticky top-2/g)).toHaveLength(2)
  expect(html.match(/font-semibold leading-snug/g)).toHaveLength(2)
  expect(html.match(/10:00–<wbr\/>17:45/g)).toHaveLength(2)
  for (const id of ['a', 'b']) {
    expect(html).toContain(`data-block-id="${id}"`)
    expect(html).toContain(`aria-label="予定${id} を完了にする"`)
    expect(html).toContain(`data-resize-id="${id}"`)
    expect(html).toContain(`data-resize-top-id="${id}"`)
  }
  expect(html).not.toContain('left:38px')
  expect(html).toContain('min-width:280px')
})

it('keeps lanes wide enough for three tasks and handles short overlaps and completed history', () => {
  const html = render([task('a'), task('b', { statusId: 'done' }), task('history', { carryoverToId: 'next', durationMin: 5 })])
  expect(html).toContain('min-width:420px')
  expect(html).toContain('予定b を未完了に戻す')
  expect(html).toContain('予定history は持ち越し済み')
  expect(html).not.toContain('data-block-id="history"')
  expect(html).not.toContain('data-resize-id="history"')
})

it('shares the card design in single lanes and recalculates overlap widths during drag', () => {
  const first = task('a', { durationMin: 30 })
  const next = task('b', { startMin: 660, durationMin: 30 })
  const separate = render([first, next])
  expect(separate.match(/sticky top-2/g)).toHaveLength(2)
  expect(separate.match(/background:color-mix/g)).toHaveLength(2)
  expect(separate).toContain('width:calc(100% - 3px)')
  expect(separate).not.toContain('min-width:280px')
  const moved = render([first, next], { kind: 'move', id: 'b', startMin: 600 })
  expect(moved).toContain('min-width:280px')
  expect(moved).toContain('aria-label="予定b 10:00から30分"')
  expect(moved.match(/sticky top-2/g)).toHaveLength(2)
  expect(moved.match(/background:color-mix/g)).toHaveLength(2)
  expect(moved).toContain('width:calc(50% - 3px)')
})
