// @vitest-environment jsdom
import { createElement, useRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DomView } from '../../test/dom'
import { useTimelineGestures } from '../timeline/useTimelineGestures'
import { useBoardGestures } from '../board/useBoardGestures'

let view: DomView
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  view = new DomView()
})
afterEach(async () => {
  await view.dispose()
  vi.unstubAllGlobals()
})

it('attaches touchmove scroll prevention after initial null render in useTimelineGestures', async () => {
  const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  function Harness({ ready }: { ready: boolean }) {
    const rootRef = useRef<HTMLDivElement>(null)
    const gridRef = useRef<HTMLDivElement>(null)
    const scrollerRef = useRef<HTMLDivElement>(null)
    useTimelineGestures({
      rootRef,
      gridRef,
      scrollerRef,
      range: { startMin: 360, endMin: 1440 },
      getBlock: () => undefined,
      getTrayDuration: () => 30,
      onMove: () => {},
      onResize: () => {},
      onResizeTop: () => {},
      onPlace: () => {},
    })
    if (!ready) return null
    return createElement('div', { ref: rootRef, 'data-testid': 'timeline-root' })
  }

  await view.render(createElement(Harness, { ready: false }))
  expect(addSpy.mock.calls.some(([type]) => type === 'touchmove')).toBe(false)
  await view.render(createElement(Harness, { ready: true }))
  expect(addSpy.mock.calls.some(([type, , opts]) => type === 'touchmove' && typeof opts === 'object' && opts?.passive === false)).toBe(true)
  addSpy.mockRestore()
})

it('attaches touchmove scroll prevention after initial null render in useBoardGestures', async () => {
  const addSpy = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  function Harness({ ready }: { ready: boolean }) {
    const listRef = useRef<HTMLUListElement>(null)
    useBoardGestures({
      listRef,
      activeIndex: 0,
      columnCount: 4,
      onSwitchColumn: () => {},
      onSwipeMove: () => {},
      onDrop: () => {},
    })
    if (!ready) return null
    return createElement('ul', { ref: listRef, 'data-testid': 'board-list' })
  }

  await view.render(createElement(Harness, { ready: false }))
  expect(addSpy.mock.calls.some(([type]) => type === 'touchmove')).toBe(false)
  await view.render(createElement(Harness, { ready: true }))
  expect(addSpy.mock.calls.some(([type, , opts]) => type === 'touchmove' && typeof opts === 'object' && opts?.passive === false)).toBe(true)
  addSpy.mockRestore()
})
